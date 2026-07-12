/**
 * socket-wiring — helpers serveur pour le câblage du SocketProvider (RT-003).
 *
 * Décode (sans vérification cryptographique — la vérif réelle vit dans le
 * middleware jose / côté API) le payload d'un JWT SIGFA pour en extraire la
 * première agence du scope tenant (`agencyIds[0]`). Utilisé par le layout web
 * (server component) pour injecter `agencyId` dans le SocketProvider à partir du
 * cookie httpOnly, sans aucun fetch hors contrat.
 *
 * @module lib/socket-wiring
 */

/** Forme minimale du payload JWT utile au câblage socket. */
interface SocketJwtPayload {
  /** Scope tenant : agences accessibles. */
  agencyIds?: string[];
}

/**
 * Décode le payload (base64url) d'un JWT sans en vérifier la signature.
 * @param token - JWT compact (`header.payload.signature`).
 * @returns Le payload décodé, ou null si le token est malformé.
 */
export function decodeSocketJwt(token: string): SocketJwtPayload | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const payload = parts[1];
  if (!payload) return null;
  try {
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const json =
      typeof Buffer !== "undefined"
        ? Buffer.from(normalized, "base64").toString("utf-8")
        : atob(normalized);
    return JSON.parse(json) as SocketJwtPayload;
  } catch {
    return null;
  }
}

/**
 * Extrait la première agence du scope d'un JWT (pour `join:agency`).
 * @param token - JWT compact.
 * @returns L'agencyId, ou null si absent/malformé.
 */
export function firstAgencyIdFromToken(token: string): string | null {
  const payload = decodeSocketJwt(token);
  const agencyIds = payload?.agencyIds;
  if (!Array.isArray(agencyIds) || agencyIds.length === 0) return null;
  const first = agencyIds[0];
  return typeof first === "string" && first.length > 0 ? first : null;
}
