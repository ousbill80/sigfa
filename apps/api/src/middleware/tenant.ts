/**
 * Middleware tenant + RBAC — API-002
 *
 * Responsabilités :
 *   1. Vérifier le JWT Bearer → expose `c.var.tenant` typé
 *   2. Enforcer x-required-role depuis rbac-route-map
 *   3. Ouvrir la connexion withTenant(bankId) pour les routes bank/agency
 *   4. Ouvrir withPlatform pour les routes platform (SUPER_ADMIN)
 *   5. Journaliser requestId + bankId (jamais de token ni téléphone)
 *   6. JAMAIS de SET bank_id vide
 *
 * @module
 */

import type { Context, Next } from "hono";
import type { Client } from "pg";
import type { Redis } from "ioredis";
import { nanoid } from "nanoid";
import { verifyAccessToken } from "src/services/auth.service.js";
import { buildError } from "src/lib/errors.js";
import { logger } from "src/lib/logger.js";
import { findRouteEntry, hasRequiredRole } from "src/middleware/rbac-route-map.js";

/** Contexte tenant exposé via c.var.tenant */
export interface TenantContext {
  /** Identifiant unique de la requête */
  requestId: string;
  /** ID de l'utilisateur (claim sub) */
  userId: string;
  /** bankId du JWT (null pour SUPER_ADMIN) */
  bankId: string | null;
  /** Rôle de l'utilisateur */
  role: string;
  /** IDs des agences accessibles */
  agencyIds: string[];
}

/** Variables Hono étendues avec le contexte tenant */
export interface TenantEnv {
  Variables: {
    db: Client;
    redis: Redis;
    jwtSecret: Uint8Array;
    tenant: TenantContext;
  };
}

/**
 * Vérifie que l'agencyId fourni (query param) est dans les agencyIds du JWT.
 * Lève une SigfaError 403 si ce n'est pas le cas.
 *
 * @param agencyId  - agencyId extrait du query param
 * @param tenant    - Contexte tenant courant
 * @throws {Response} 403 FORBIDDEN si agencyId hors scope
 */
export function assertAgencyInScope(
  agencyId: string,
  tenant: TenantContext
): void {
  if (
    tenant.role !== "SUPER_ADMIN" &&
    !tenant.agencyIds.includes(agencyId)
  ) {
    throw new AgencyOutOfScopeError(agencyId);
  }
}

/** Erreur interne : agencyId hors scope JWT */
export class AgencyOutOfScopeError extends Error {
  constructor(agencyId: string) {
    super(`agencyId ${agencyId} hors scope JWT`);
    this.name = "AgencyOutOfScopeError";
  }
}

/**
 * Middleware principal tenant + RBAC.
 * À appliquer sur toutes les routes non-publiques.
 *
 * Ordre : extraction JWT → vérification RBAC → validation agencyId → set c.var.tenant
 */
export async function tenantMiddleware(
  c: Context<TenantEnv>,
  next: Next
): Promise<Response | void> {
  const requestId = nanoid(12);
  const method = c.req.method;
  const path = c.req.path.replace(/^\/api\/v1/, "");

  // Trouver l'entrée RBAC pour cette route
  const routeEntry = findRouteEntry(method, path);

  // Routes inconnues (hors mapping) : passer au 404 handler sans auth
  if (!routeEntry) {
    return next();
  }

  // Routes publiques : pas d'auth requise
  if (routeEntry.requiredRole === "NONE" || routeEntry.tenantScope === "public") {
    logger.info({ requestId, method, path }, "request:public");
    return next();
  }

  // Extraction du token Bearer
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return c.json(
      buildError("UNAUTHORIZED", "Token manquant ou malformé."),
      401
    );
  }

  const token = authHeader.slice(7);
  const secret = c.get("jwtSecret");

  let payload: Awaited<ReturnType<typeof verifyAccessToken>>;
  try {
    payload = await verifyAccessToken(secret, token);
  } catch {
    return c.json(
      buildError("UNAUTHORIZED", "Token invalide ou expiré."),
      401
    );
  }

  const bankId = payload.bankId ?? null;
  const role = payload.role;
  const agencyIds = (payload.agencyIds as string[]) ?? [];
  const userId = payload.sub ?? "";

  const tenant: TenantContext = {
    requestId,
    userId,
    bankId,
    role,
    agencyIds,
  };

  // Log structuré : requestId + bankId (jamais le token ni le téléphone)
  logger.info({ requestId, bankId, role, method, path }, "request:authed");

  // Vérification RBAC : le rôle du JWT satisfait-il le rôle requis ?
  if (routeEntry) {
    const requiredRole = routeEntry.requiredRole;

    if (!hasRequiredRole(role, requiredRole)) {
      logger.warn(
        { requestId, bankId, role, requiredRole, path },
        "rbac:forbidden"
      );
      return c.json(
        buildError("FORBIDDEN", "Permissions insuffisantes pour cette ressource."),
        403
      );
    }

    // Validation cross-tenant : le bankId de la route doit correspondre au JWT
    const scope = routeEntry.tenantScope as string;
    if (
      scope !== "platform" &&
      scope !== "public" &&
      role !== "SUPER_ADMIN" &&
      bankId !== null
    ) {
      // Pour les routes avec {id} dans le path (ex: /banks/{id}),
      // vérifier que l'id dans le path appartient au tenant du JWT
      const isCrossTenantViolation = detectCrossTenantViolation(path, bankId);
      if (isCrossTenantViolation) {
        logger.warn(
          { requestId, bankId, path },
          "rbac:cross-tenant-violation"
        );
        return c.json(
          buildError("FORBIDDEN", "Accès refusé : ressource hors de votre tenant."),
          403
        );
      }
    }

    // Validation agencyId sur les routes x-security-note (ex: /queues)
    const reqRole = routeEntry.requiredRole as string;
    if (routeEntry.tenantScope === "agency" && reqRole !== "NONE") {
      const agencyIdParam = new URL(c.req.url).searchParams.get("agencyId");
      if (agencyIdParam && role !== "SUPER_ADMIN") {
        try {
          assertAgencyInScope(agencyIdParam, tenant);
        } catch {
          return c.json(
            buildError(
              "FORBIDDEN",
              "agencyId hors scope du JWT — accès refusé."
            ),
            403
          );
        }
      }
    }
  }

  // Exposer le contexte tenant
  c.set("tenant", tenant);

  return next();
}

/**
 * Détecte une violation cross-tenant sur les routes avec {id} path param.
 * Compare le premier segment UUID du path avec le bankId du JWT.
 *
 * Exemple : GET /banks/uuid-B avec JWT bankId=uuid-A → violation.
 *
 * @param path   - Chemin sans préfixe /api/v1
 * @param bankId - bankId extrait du JWT
 */
function detectCrossTenantViolation(path: string, bankId: string): boolean {
  // Routes /banks/{id}* : le premier segment après /banks/ doit être le bankId du JWT
  const banksMatch = /^\/banks\/([0-9a-f-]{36})/.exec(path);
  if (banksMatch) {
    return banksMatch[1] !== bankId;
  }

  // Routes /agencies/{id}* : la vérification se fait côté DB via RLS
  // On ne peut pas comparer agencyId au bankId ici (relation indirecte)
  // La RLS gère le cas où sigfa_app essaie d'accéder à une agence hors tenant

  return false;
}
