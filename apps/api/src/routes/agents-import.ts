/**
 * Route import CSV d'agents — API-009 (agents.yaml).
 *
 * POST /agents/import (multipart/form-data, champ `file`) — AGENCY_DIRECTOR, scope
 * bank. Parse le CSV (module `csv-agents` : ≤500 lignes, colonnes fixées, E.164),
 * puis crée les agents en **unité PAR LIGNE** : une ligne en échec (doublon, agence
 * inconnue) n'annule PAS les lignes valides déjà créées.
 *
 * Mots de passe initiaux **aléatoires** (bcrypt), JAMAIS renvoyés (envoi = F6).
 * Réponse : `{ created, skipped, errors[{line,field,code,message}] }`.
 *
 * ## Sécurité (SEC-002-CUTOVER-LOT5)
 * TOUT accès DB tenant est routé via `withArmedTenant` (contexte RLS
 * `app.current_bank_id` armé sur la connexion `sigfa_app` NOBYPASSRLS) → cette route
 * est classée **ARMED** dans `tenant-armament-arch.test.ts`. Le batch complet ouvre
 * UNE transaction armée ; chaque ligne est délimitée par un SAVEPOINT (au lieu d'un
 * BEGIN/COMMIT par ligne) : un échec de ligne (doublon email, agence inconnue)
 * relâche SON savepoint sans casser la transaction armée ni les lignes valides. Toutes
 * les tables touchées (`users` / `agencies` / `agency_users` / `audit_log`) portent
 * la policy `tenant_isolation` + le GRANT CRUD `sigfa_app` (0001) — l'INSERT `users`
 * marqué `bank_id` d'un autre tenant serait rejeté par WITH CHECK sous armement.
 *
 * @module
 */

import { Hono } from "hono";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import type { Client } from "pg";
import type { Redis } from "ioredis";
import { SigfaError } from "src/lib/errors.js";
import type { TenantContext } from "src/middleware/tenant.js";
import { errorResponse } from "src/lib/admin-helpers.js";
import { recordAudit, extractIp } from "src/lib/audit-context.js";
import {
  withArmedTenant,
  asArmable,
  isCanonicalUuid,
} from "src/lib/armed-tenant.js";
import {
  parseAgentCsv,
  type ImportError,
  type ParsedAgentRow,
} from "src/lib/csv-agents.js";

/** Variables de contexte Hono du routeur import. */
interface ImportEnv {
  Variables: {
    db: Client;
    redis: Redis;
    jwtSecret: Uint8Array;
    tenant: TenantContext;
  };
}

/** Coût bcrypt des mots de passe initiaux. */
const BCRYPT_COST = 10;

/** Rapport d'import (LA LOI ImportReport). */
interface ImportReport {
  created: number;
  skipped: number;
  errors: ImportError[];
}

/**
 * Crée le routeur import (monté sous /api/v1).
 *
 * @returns Routeur Hono de la route d'import CSV API-009
 */
export function createAgentImportRouter(): Hono<ImportEnv> {
  const router = new Hono<ImportEnv>();
  router.post("/agents/import", async (c) => {
    const db = c.get("db");
    const tenant = c.get("tenant");
    try {
      const bankId = requireArmableBankId(tenant);
      const csv = await readCsvFile(c.req.raw);
      // Anti-escalade (Boucle 3 F3) : une ligne ne peut pas provisionner un rôle
      // strictement supérieur à l'importateur, et jamais un SUPER_ADMIN.
      const parsed = parseAgentCsv(csv, tenant.role);
      // SEC-002 : le batch entier s'exécute dans UNE transaction ARMÉE (RLS
      // `app.current_bank_id`). `importRows` délimite chaque ligne par SAVEPOINT.
      const report = await withArmedTenant(asArmable(db), bankId, (conn) =>
        importRows(conn as unknown as Client, bankId, parsed.rows, parsed.errors, {
          tenant,
          ip: extractIp(c),
        })
      );
      return c.json(report, 200);
    } catch (err) {
      return errorResponse(c, err);
    }
  });
  return router;
}

/**
 * Exige un `bankId` tenant en UUID canonique pour l'armement RLS (SEC-002).
 * Absent (contexte plateforme) ou malformé → 403 : une route tenant ne s'arme
 * jamais sans banque résolue (le `bank_id` est interpolé dans `SET LOCAL`).
 *
 * @param tenant - Contexte tenant résolu
 * @throws {SigfaError} 403 FORBIDDEN si `bankId` absent/non-UUID
 */
function requireArmableBankId(tenant: TenantContext): string {
  const bankId = tenant.bankId;
  if (!bankId || !isCanonicalUuid(bankId)) {
    throw new SigfaError(
      "FORBIDDEN",
      "Contexte de banque requis pour cette opération.",
      403
    );
  }
  return bankId;
}

/**
 * Extrait le contenu texte du champ `file` (multipart/form-data).
 *
 * @param request - Requête brute
 * @returns Contenu CSV décodé UTF-8
 * @throws {SigfaError} 400 si aucun fichier fourni
 */
async function readCsvFile(request: Request): Promise<string> {
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!file || typeof file === "string") {
    throw new SigfaError("BAD_REQUEST", "Champ 'file' (CSV) manquant.", 400);
  }
  return file.text();
}

/**
 * Crée les agents ligne par ligne (transaction par ligne). Les erreurs de format
 * (déjà détectées) sont fusionnées avec les erreurs de création (doublon, agence).
 *
 * @param db          - Connexion PG
 * @param bankId      - Banque courante
 * @param rows        - Lignes valides (format)
 * @param formatErrors - Erreurs de format préexistantes
 * @returns Rapport agrégé
 */
async function importRows(
  db: Client,
  bankId: string,
  rows: ParsedAgentRow[],
  formatErrors: ImportError[],
  audit: ImportAuditCtx
): Promise<ImportReport> {
  const errors: ImportError[] = [...formatErrors];
  let created = 0;
  let skipped = 0;
  for (const row of rows) {
    const outcome = await importOneRow(db, bankId, row, audit);
    if (outcome === "created") created += 1;
    else {
      skipped += 1;
      errors.push(outcome);
    }
  }
  errors.sort((a, b) => a.line - b.line);
  return { created, skipped, errors };
}

/** Contexte d'audit propagé à chaque ligne d'import (acteur + IP). */
interface ImportAuditCtx {
  tenant: TenantContext;
  ip: string | null;
}

/**
 * Crée un agent dans SON PROPRE SAVEPOINT à l'intérieur de la transaction armée
 * du batch (SEC-002). Rollback du seul savepoint si échec (aucune ligne partielle,
 * les lignes valides déjà créées sont préservées). Retourne "created" ou une
 * `ImportError` décrivant l'échec.
 *
 * @param db     - Connexion PG armée (transaction du batch déjà ouverte)
 * @param bankId - Banque courante
 * @param row    - Ligne valide à insérer
 * @returns "created" ou l'erreur de création
 */
async function importOneRow(
  db: Client,
  bankId: string,
  row: ParsedAgentRow,
  audit: ImportAuditCtx
): Promise<"created" | ImportError> {
  await db.query("SAVEPOINT import_row");
  try {
    const agencyId = await resolveAgency(db, bankId, row.agencyCode);
    const userId = await insertUser(db, bankId, row);
    if (agencyId) await linkAgency(db, bankId, agencyId, userId);
    // SEC-001a : audit de la création d'agent DANS le savepoint de la ligne.
    // Le diff n'expose JAMAIS `password_hash` (assaini par recordAudit) ni le
    // téléphone en clair — seuls des champs d'identité non sensibles.
    await recordAudit({
      db,
      tenant: audit.tenant,
      action: "POST /agents/import",
      entityType: "user",
      entityId: userId,
      ip: audit.ip,
      diff: {
        after: {
          email: row.email,
          role: row.role,
          firstName: row.firstName,
          lastName: row.lastName,
          ...(agencyId ? { agencyId } : {}),
        },
      },
    });
    await db.query("RELEASE SAVEPOINT import_row");
    return "created";
  } catch (err) {
    // Rollback du SEUL savepoint : la transaction armée du batch reste ouverte,
    // les lignes valides précédentes ne sont pas perdues.
    await db.query("ROLLBACK TO SAVEPOINT import_row");
    await db.query("RELEASE SAVEPOINT import_row").catch(() => {
      // Savepoint déjà libéré par le rollback sur certaines erreurs : sans effet.
    });
    return toImportError(row, err);
  }
}

/** Résout l'agencyCode → agencyId du tenant, ou null si non fourni. */
async function resolveAgency(
  db: Client,
  bankId: string,
  agencyCode: string | null
): Promise<string | null> {
  if (!agencyCode) return null;
  const res = await db.query(
    `SELECT id FROM agencies WHERE bank_id = $1 AND name = $2 AND deleted_at IS NULL`,
    [bankId, agencyCode]
  );
  const row = res.rows[0] as { id: string } | undefined;
  if (!row) {
    throw new SigfaError(
      "AGENCY_NOT_FOUND",
      `Agence '${agencyCode}' introuvable.`,
      404,
      { field: "agencyCode" }
    );
  }
  return row.id;
}

/** Insère l'utilisateur (mot de passe aléatoire bcrypt, jamais renvoyé). */
async function insertUser(
  db: Client,
  bankId: string,
  row: ParsedAgentRow
): Promise<string> {
  const password = randomBytes(24).toString("base64url");
  const hash = await bcrypt.hash(password, BCRYPT_COST);
  const res = await db.query(
    `INSERT INTO users (bank_id, email, password_hash, first_name, last_name, role, languages)
     VALUES ($1, $2, $3, $4, $5, $6::role, $7)
     RETURNING id`,
    [bankId, row.email, hash, row.firstName, row.lastName, row.role, row.languages]
  );
  return (res.rows[0] as { id: string }).id;
}

/** Rattache l'utilisateur à l'agence (agency_users). */
async function linkAgency(
  db: Client,
  bankId: string,
  agencyId: string,
  userId: string
): Promise<void> {
  await db.query(
    `INSERT INTO agency_users (bank_id, agency_id, user_id) VALUES ($1, $2, $3)`,
    [bankId, agencyId, userId]
  );
}

/** Traduit une erreur d'insertion en `ImportError` (doublon email, agence). */
function toImportError(row: ParsedAgentRow, err: unknown): ImportError {
  if (err instanceof SigfaError && err.code === "AGENCY_NOT_FOUND") {
    return { line: row.line, field: "agencyCode", code: "AGENCY_NOT_FOUND", message: err.message };
  }
  if (isUniqueViolation(err)) {
    return {
      line: row.line,
      field: "email",
      code: "DUPLICATE_EMAIL",
      message: `L'adresse email '${row.email}' est déjà enregistrée.`,
    };
  }
  return { line: row.line, field: "email", code: "IMPORT_ROW_FAILED", message: "Échec de création de la ligne." };
}

/** Détecte une violation d'unicité PostgreSQL (code SQLSTATE 23505). */
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: string }).code === "23505"
  );
}
