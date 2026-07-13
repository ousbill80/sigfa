/**
 * Route import CSV d'agents — API-009 (agents.yaml).
 *
 * POST /agents/import (multipart/form-data, champ `file`) — AGENCY_DIRECTOR, scope
 * bank. Parse le CSV (module `csv-agents` : ≤500 lignes, colonnes fixées, E.164),
 * puis crée les agents en **transaction PAR LIGNE** : une ligne en échec
 * (doublon, agence inconnue) n'annule PAS les lignes valides déjà créées.
 *
 * Mots de passe initiaux **aléatoires** (bcrypt), JAMAIS renvoyés (envoi = F6).
 * Réponse : `{ created, skipped, errors[{line,field,code,message}] }`.
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
import { errorResponse, requireBankId } from "src/lib/admin-helpers.js";
import { recordAudit, extractIp } from "src/lib/audit-context.js";
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
      const bankId = requireBankId(tenant);
      const csv = await readCsvFile(c.req.raw);
      // Anti-escalade (Boucle 3 F3) : une ligne ne peut pas provisionner un rôle
      // strictement supérieur à l'importateur, et jamais un SUPER_ADMIN.
      const parsed = parseAgentCsv(csv, tenant.role);
      const report = await importRows(db, bankId, parsed.rows, parsed.errors, {
        tenant,
        ip: extractIp(c),
      });
      return c.json(report, 200);
    } catch (err) {
      return errorResponse(c, err);
    }
  });
  return router;
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
 * Crée un agent dans sa PROPRE transaction. Rollback si échec (aucune ligne
 * partielle). Retourne "created" ou une `ImportError` décrivant l'échec.
 *
 * @param db     - Connexion PG
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
  try {
    await db.query("BEGIN");
    const agencyId = await resolveAgency(db, bankId, row.agencyCode);
    const userId = await insertUser(db, bankId, row);
    if (agencyId) await linkAgency(db, bankId, agencyId, userId);
    // SEC-001a : audit de la création d'agent DANS la transaction de la ligne.
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
    await db.query("COMMIT");
    return "created";
  } catch (err) {
    await db.query("ROLLBACK");
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
