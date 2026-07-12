/**
 * Helpers transverses des routeurs admin — API-008.
 *
 * Facteurs communs aux routeurs banks/agencies/services/counters/hours/…
 * (validation UUID de chemin, réponses d'erreur LA LOI, pagination, parse JSON,
 * garde bankId). Toutes fonctions ≤30 lignes, zéro `any`.
 *
 * @module
 */

import type { Context } from "hono";
import { z } from "zod";
import { SigfaError, buildError } from "src/lib/errors.js";
import type { TenantContext } from "src/middleware/tenant.js";

/** Regex UUID canonique pour valider les paramètres de chemin. */
export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Codes HTTP émis par les routeurs admin. */
type AdminHttpStatus = 400 | 401 | 403 | 404 | 409 | 422;

/**
 * Lit et valide un paramètre de chemin UUID, sinon lève 404.
 *
 * @param c    - Contexte Hono
 * @param name - Nom du paramètre de chemin
 * @returns UUID validé
 */
export function paramUuid(c: Context, name: string): string {
  const value = c.req.param(name);
  if (!value || !UUID_RE.test(value)) {
    throw new SigfaError("NOT_FOUND", "Ressource introuvable.", 404);
  }
  return value;
}

/**
 * Émet une réponse d'erreur `SigfaError` au format LA LOI, ou relance.
 *
 * @param c   - Contexte Hono
 * @param err - Erreur capturée
 * @returns Réponse JSON d'erreur
 */
export function errorResponse(c: Context, err: unknown): Response {
  if (err instanceof SigfaError) {
    return c.json(
      buildError(err.code, err.message, err.details),
      err.httpStatus as AdminHttpStatus
    );
  }
  throw err;
}

/**
 * Parse le corps JSON de la requête, `null` si absent ou malformé.
 *
 * @param c - Contexte Hono
 * @returns Corps parsé ou null
 */
export async function parseJson(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return null;
  }
}

/**
 * Valide un corps avec un schéma Zod strict. En cas d'échec, lève une
 * `SigfaError` 422 UNPROCESSABLE_ENTITY (champ inconnu → additionalProperties: false).
 *
 * @param schema - Schéma Zod strict
 * @param body   - Corps à valider
 * @returns Données validées
 */
export function parseStrict<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new SigfaError(
      "UNPROCESSABLE_ENTITY",
      "Requête invalide ou champ hors schéma (additionalProperties: false).",
      422,
      { issues: parsed.error.issues }
    );
  }
  return parsed.data;
}

/** Schéma des paramètres de pagination (page/limit) conforme LA LOI. */
const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

/** Pagination validée (page/limit). */
export interface Pagination {
  /** Numéro de page (≥1). */
  page: number;
  /** Taille de page (1..100). */
  limit: number;
  /** Décalage SQL calculé. */
  offset: number;
}

/**
 * Lit et valide les paramètres de pagination depuis la query.
 *
 * @param c - Contexte Hono
 * @returns Pagination validée
 */
export function readPagination(c: Context): Pagination {
  const parsed = paginationSchema.safeParse({
    page: c.req.query("page"),
    limit: c.req.query("limit"),
  });
  if (!parsed.success) {
    throw new SigfaError("VALIDATION_ERROR", "Pagination invalide.", 400);
  }
  const { page, limit } = parsed.data;
  return { page, limit, offset: (page - 1) * limit };
}

/**
 * Extrait le bankId requis (jamais null pour les routes bank/agency).
 *
 * @param tenant - Contexte tenant
 * @returns bankId non nul
 */
export function requireBankId(tenant: TenantContext): string {
  if (!tenant.bankId) {
    throw new SigfaError(
      "FORBIDDEN",
      "Contexte de banque requis pour cette opération.",
      403
    );
  }
  return tenant.bankId;
}

/**
 * Vérifie qu'une agence est dans le scope du JWT (agences accessibles).
 * SUPER_ADMIN et BANK_ADMIN (scope banque) ne sont pas restreints ici.
 *
 * @param tenant   - Contexte tenant
 * @param agencyId - Agence ciblée
 * @throws {SigfaError} 403 si hors scope pour un rôle agence
 */
export function assertAgencyScope(
  tenant: TenantContext,
  agencyId: string
): void {
  const bankScopedRoles = new Set(["SUPER_ADMIN", "BANK_ADMIN"]);
  if (bankScopedRoles.has(tenant.role)) return;
  if (!tenant.agencyIds.includes(agencyId)) {
    throw new SigfaError(
      "FORBIDDEN",
      "Agence hors de votre périmètre.",
      403
    );
  }
}
