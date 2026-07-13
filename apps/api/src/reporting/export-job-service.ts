/**
 * REP-003 — Service de cycle de vie des jobs d'export (`export_jobs`, DB-006).
 *
 * Couture DB ↔ machine d'export, testable via harnais DDL. Responsabilités :
 *  1. **Création** (`createExportJob`) : insère une ligne `PENDING` et renvoie le jobId.
 *  2. **Transitions** (`markProcessing`/`markReady`/`markFailed`) : PENDING→PROCESSING→
 *     READY|FAILED, avec `file_url` signé + `expires_at` sur READY.
 *  3. **Lecture avec ownership** (`loadOwnedJob`) : un job d'un AUTRE tenant OU d'un
 *     AUTRE demandeur (hors AUDITOR) → introuvable (404 OPAQUE, aucun oracle).
 *
 * Toute I/O passe par une `QueryFn` paramétrée (DB-009). Aucune horloge cachée :
 * l'instant est injecté par l'appelant (déterminisme fake-timers).
 *
 * @module
 */

import type { QueryFn } from "src/reporting/aggregate-service.js";
import type { ExportFormat } from "src/reporting/export-storage.js";

/** Statut d'un job d'export (LA LOI `ExportJobStatus` DB-006). */
export type ExportJobStatus = "PENDING" | "PROCESSING" | "READY" | "FAILED";

/** Portée d'un export (agency|network). */
export type ExportJobScope = "agency" | "network";

/** Ligne `export_jobs` telle que lue (colonnes utiles). */
export interface ExportJobRow {
  /** Identifiant du job (= jobId exposé). */
  id: string;
  /** Tenant propriétaire. */
  bankId: string;
  /** Demandeur (userId). */
  requestedBy: string;
  /** Périmètre encodé (`agency:<uuid>` ou `network`). */
  scope: string;
  /** Période (periodKey). */
  period: string;
  /** Format. */
  format: string;
  /** Statut courant. */
  status: ExportJobStatus;
  /** URL signée (null tant que non READY). */
  fileUrl: string | null;
  /** Expiration de l'URL signée (null tant que non READY). */
  expiresAt: Date | null;
  /** Création. */
  createdAt: Date;
  /** Dernière mise à jour. */
  updatedAt: Date;
}

/** Paramètres de création d'un job d'export. */
export interface CreateExportJobParams {
  /** Tenant propriétaire. */
  bankId: string;
  /** Demandeur (userId). */
  requestedBy: string;
  /** Portée. */
  scope: ExportJobScope;
  /** Agence ciblée (requis si scope=agency). */
  agencyId?: string | null;
  /** Clé de période normalisée. */
  periodKey: string;
  /** Format demandé. */
  format: ExportFormat;
}

/** Encode le périmètre d'un export en une chaîne stable (`agency:<uuid>` / `network`). */
export function encodeScope(scope: ExportJobScope, agencyId?: string | null): string {
  return scope === "agency" && agencyId ? `agency:${agencyId}` : "network";
}

/** Décode un périmètre encodé en `{ scope, agencyId }`. */
export function decodeScope(encoded: string): {
  scope: ExportJobScope;
  agencyId: string | null;
} {
  if (encoded.startsWith("agency:")) {
    return { scope: "agency", agencyId: encoded.slice("agency:".length) };
  }
  return { scope: "network", agencyId: null };
}

/** Mappe une ligne SQL brute vers `ExportJobRow` (colonnes snake_case → camelCase). */
function mapRow(row: Record<string, unknown>): ExportJobRow {
  return {
    id: String(row["id"]),
    bankId: String(row["bank_id"]),
    requestedBy: String(row["requested_by"]),
    scope: String(row["scope"]),
    period: String(row["period"]),
    format: String(row["format"]),
    status: String(row["status"]) as ExportJobStatus,
    fileUrl: row["file_url"] === null || row["file_url"] === undefined ? null : String(row["file_url"]),
    expiresAt: toDateOrNull(row["expires_at"]),
    createdAt: new Date(String(row["created_at"])),
    updatedAt: new Date(String(row["updated_at"])),
  };
}

/** Convertit une valeur SQL en `Date | null`. */
function toDateOrNull(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value : new Date(String(value));
}

/**
 * Crée un job d'export `PENDING` et renvoie la ligne créée (jobId = `id`).
 *
 * @param query  - Requête paramétrée (tenant appliqué en amont)
 * @param params - Tenant, demandeur, portée, période, format
 * @returns Ligne `export_jobs` créée
 */
export async function createExportJob(
  query: QueryFn,
  params: CreateExportJobParams
): Promise<ExportJobRow> {
  const scope = encodeScope(params.scope, params.agencyId);
  const res = await query(
    `INSERT INTO export_jobs (bank_id, requested_by, scope, period, format, status)
     VALUES ($1, $2, $3, $4, $5, 'PENDING')
     RETURNING id, bank_id, requested_by, scope, period, format, status,
               file_url, expires_at, created_at, updated_at`,
    [params.bankId, params.requestedBy, scope, params.periodKey, params.format]
  );
  return mapRow(res.rows[0] as Record<string, unknown>);
}

/**
 * Charge un job d'export avec contrôle d'OWNERSHIP OPAQUE : le job doit appartenir
 * au tenant, ET (le demandeur == requérant OU le requérant est AUDITOR). Sinon
 * `null` (le routeur répond 404 opaque — aucun oracle d'existence cross-tenant).
 *
 * @param query         - Requête paramétrée (tenant appliqué en amont)
 * @param jobId         - Identifiant du job
 * @param bankId        - Tenant du requérant
 * @param requesterId   - userId du requérant
 * @param requesterRole - Rôle du requérant (AUDITOR voit tous les jobs de son tenant)
 * @returns Ligne du job si accessible, sinon `null`
 */
export async function loadOwnedJob(
  query: QueryFn,
  jobId: string,
  bankId: string,
  requesterId: string,
  requesterRole: string
): Promise<ExportJobRow | null> {
  const res = await query(
    `SELECT id, bank_id, requested_by, scope, period, format, status,
            file_url, expires_at, created_at, updated_at
       FROM export_jobs
      WHERE id = $1 AND bank_id = $2`,
    [jobId, bankId]
  );
  const raw = res.rows[0] as Record<string, unknown> | undefined;
  if (!raw) return null;
  const job = mapRow(raw);
  const isAuditor = requesterRole === "AUDITOR" || requesterRole === "SUPER_ADMIN";
  if (!isAuditor && job.requestedBy !== requesterId) {
    // Job d'un autre demandeur du même tenant : 404 opaque (jamais 403 révélateur).
    return null;
  }
  return job;
}

/** Passe un job en `PROCESSING` (garde tenant : bank_id filtré). */
export async function markProcessing(
  query: QueryFn,
  jobId: string,
  bankId: string,
  now: Date
): Promise<void> {
  await query(
    `UPDATE export_jobs SET status = 'PROCESSING', updated_at = $3
      WHERE id = $1 AND bank_id = $2`,
    [jobId, bankId, now.toISOString()]
  );
}

/**
 * Passe un job en `READY` avec l'URL signée de téléchargement et son expiration.
 *
 * @param query     - Requête paramétrée
 * @param jobId     - Job
 * @param bankId    - Tenant
 * @param fileUrl   - URL signée de téléchargement
 * @param expiresAt - Expiration de l'URL signée (TTL 24 h)
 * @param now       - Horloge injectée
 */
export async function markReady(
  query: QueryFn,
  jobId: string,
  bankId: string,
  fileUrl: string,
  expiresAt: Date,
  now: Date
): Promise<void> {
  await query(
    `UPDATE export_jobs
        SET status = 'READY', file_url = $3, expires_at = $4, updated_at = $5
      WHERE id = $1 AND bank_id = $2`,
    [jobId, bankId, fileUrl, expiresAt.toISOString(), now.toISOString()]
  );
}

/** Passe un job en `FAILED` (jamais de fichier corrompu servi). */
export async function markFailed(
  query: QueryFn,
  jobId: string,
  bankId: string,
  now: Date
): Promise<void> {
  await query(
    `UPDATE export_jobs SET status = 'FAILED', file_url = NULL, updated_at = $3
      WHERE id = $1 AND bank_id = $2`,
    [jobId, bankId, now.toISOString()]
  );
}
