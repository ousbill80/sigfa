/**
 * realtime-env — résolution d'environnement temps réel (pure, testable).
 *
 * Centralise la bascule `NEXT_PUBLIC_REALTIME_MODE` (RT-001b) et la dérivation
 * des URLs : base REST mock (Prism canonique :4010) et origine socket (le
 * socket parle au serveur HTTP+WS racine, pas au préfixe /api/v1 REST).
 * @module lib/realtime-env
 */
import type { RealtimeMode } from "./socket-provider";

/** Base mock canonique unifiée web/kiosk (mock Prism). */
export const DEFAULT_MOCK_URL = "http://localhost:4010";

/**
 * Mode temps réel dérivé de l'env (défaut off = fixtures F4).
 * @returns `real` ou `off`.
 */
export function resolveRealtimeMode(): RealtimeMode {
  return process.env.NEXT_PUBLIC_REALTIME_MODE === "real" ? "real" : "off";
}

/**
 * Base REST d'env (peut inclure /api/v1 côté API réelle).
 * @returns L'URL REST configurée, ou le mock canonique.
 */
export function restApiBase(): string {
  const url = process.env.NEXT_PUBLIC_API_URL;
  return url !== undefined && url.length > 0 ? url : DEFAULT_MOCK_URL;
}

/**
 * Rebase une URL REST (potentiellement suffixée /api/v1) sur son origine
 * socket.
 * @param apiUrl - URL REST (défaut : env).
 * @returns L'origine (scheme://host:port) pour la connexion socket.io.
 */
export function socketOrigin(apiUrl: string = restApiBase()): string {
  try {
    return new URL(apiUrl).origin;
  } catch {
    return apiUrl;
  }
}
