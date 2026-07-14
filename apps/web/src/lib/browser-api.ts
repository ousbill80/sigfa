/**
 * browser-api — porte d'entrée API UNIQUE du JavaScript navigateur (S3/RT-003).
 *
 * Tout appel de CONTRAT émis par le JS client (composants "use client", hooks)
 * passe par le proxy authentifié same-origin `/api/rt`
 * (app/api/rt/[...path]/route) :
 * - aucune requête cross-origin — l'API réelle n'expose pas de CORS et son
 *   préflight `OPTIONS /api/v1/*` répond 404, ce qui bloquait tout appel
 *   navigateur direct vers `NEXT_PUBLIC_API_URL` ;
 * - le Bearer httpOnly est injecté côté serveur par le proxy — le token n'est
 *   JAMAIS exposé au JS client (S2) ;
 * - en mode mock (RT-001b), le proxy relaie vers le mock Prism : la bascule
 *   d'environnement reste invisible pour le navigateur.
 *
 * Seule exception documentée : le socket temps réel (lib/socket-provider) qui
 * parle à l'origine WebSocket de l'API et ne peut pas traverser un route
 * handler HTTP.
 * @module lib/browser-api
 */

/** Base API same-origin du navigateur — TOUJOURS le proxy authentifié. */
export const BROWSER_API_BASE = "/api/rt";
