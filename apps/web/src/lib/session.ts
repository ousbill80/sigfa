/**
 * Session JWT — vérification de signature (S1, Boucle 2 F4).
 *
 * Politique identique à l'API (SEC-F3-09) : jose `jwtVerify`, algorithme HS256
 * EXPLICITE, secret partagé `JWT_SECRET` (≥32 caractères). Aucun claim n'est lu
 * avant que la signature ne vérifie : token forgé / signé avec un autre secret /
 * signé avec un autre algorithme / expiré / malformé ⇒ non authentifié.
 *
 * Module edge-safe (jose est compatible edge) : consommé par le middleware
 * Next (runtime edge) et par les server components via lib/server-session.
 * @module lib/session
 */
import { jwtVerify, type JWTPayload } from "jose";
import { ROLES, type Role } from "./roles";

/** Longueur minimale de JWT_SECRET — même politique que apps/api. */
const JWT_SECRET_MIN_LENGTH = 32;

/** Claims de session SIGFA extraits d'un JWT VÉRIFIÉ. */
export interface SessionClaims {
  /** Identifiant utilisateur (claim `sub`). */
  sub: string;
  /** Rôle RBAC (validé contre la liste des rôles SIGFA). */
  role: Role;
  /** Scope tenant banque (null pour SUPER_ADMIN). */
  bankId: string | null;
  /** Scope tenant agences (vide si absent du token). */
  agencyIds: string[];
  /**
   * Nom d'affichage de l'utilisateur (claim additif WEB-002-HDR).
   * Null sur les tokens historiques émis avant l'ajout du claim.
   */
  displayName: string | null;
}

/**
 * Lit et valide `JWT_SECRET` (fail-closed : absent ou trop court → null,
 * aucun token ne sera accepté).
 * @param env - Environnement (défaut : process.env).
 * @returns Les octets du secret, ou null.
 */
export function getJwtSecret(
  env: Record<string, string | undefined> = process.env
): Uint8Array | null {
  const secret = env["JWT_SECRET"];
  if (!secret || secret.length < JWT_SECRET_MIN_LENGTH) return null;
  return new TextEncoder().encode(secret);
}

/**
 * Vérifie la signature d'un JWT (HS256 explicite) PUIS en extrait les claims
 * de session. Toute anomalie (signature, algorithme, expiration, forme des
 * claims) rend null : non authentifié.
 * @param token - JWT compact issu du cookie `access_token`.
 * @param secret - Octets de JWT_SECRET (cf. {@link getJwtSecret}).
 * @returns Les claims vérifiés, ou null.
 */
export async function verifySessionToken(
  token: string | undefined,
  secret: Uint8Array | null
): Promise<SessionClaims | null> {
  if (!token || !secret) return null;
  try {
    const { payload } = await jwtVerify(token, secret, { algorithms: ["HS256"] });
    return toSessionClaims(payload);
  } catch {
    return null;
  }
}

/**
 * Normalise un payload vérifié en {@link SessionClaims} (rôle inconnu ou sub
 * absent ⇒ null — un token signé mais hors modèle n'ouvre pas de session).
 * @param payload - Payload jose après vérification de signature.
 * @returns Les claims normalisés, ou null.
 */
function toSessionClaims(payload: JWTPayload): SessionClaims | null {
  const sub = payload.sub;
  if (typeof sub !== "string" || sub.length === 0) return null;

  const role = payload["role"];
  if (typeof role !== "string" || !(ROLES as readonly string[]).includes(role)) {
    return null;
  }

  const bankIdRaw = payload["bankId"];
  const bankId = typeof bankIdRaw === "string" && bankIdRaw.length > 0 ? bankIdRaw : null;

  const agencyIdsRaw = payload["agencyIds"];
  const agencyIds = Array.isArray(agencyIdsRaw)
    ? agencyIdsRaw.filter((id): id is string => typeof id === "string" && id.length > 0)
    : [];

  const displayNameRaw = payload["displayName"];
  const displayName =
    typeof displayNameRaw === "string" && displayNameRaw.trim().length > 0
      ? displayNameRaw.trim()
      : null;

  return { sub, role: role as Role, bankId, agencyIds, displayName };
}
