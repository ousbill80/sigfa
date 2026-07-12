/**
 * Résolution de l'IP cliente RÉELLE — durcissement Boucle 3 F3 (SEC).
 *
 * `X-Forwarded-For` / `X-Real-IP` sont des en-têtes FALSIFIABLES par le client :
 * un attaquant peut les faire varier pour réinitialiser sa fenêtre de rate-limit
 * ou falsifier l'IP d'audit. On ne leur fait donc confiance QUE derrière un proxy
 * de confiance, signalé par la variable d'environnement `TRUST_PROXY` (défaut
 * `false`).
 *
 * - `TRUST_PROXY` OFF (défaut) : on ignore XFF/X-Real-IP et on utilise l'IP de la
 *   connexion TCP réelle (source Node via `getConnInfo`).
 * - `TRUST_PROXY` ON : on lit le 1er hop de `X-Forwarded-For`, puis `X-Real-IP`,
 *   puis l'IP de connexion réelle.
 *
 * Aucune PII n'est journalisée ici — seule la valeur opaque est retournée.
 *
 * @module
 */

import type { Context } from "hono";
import { getConnInfo } from "@hono/node-server/conninfo";

/** Repli lorsqu'aucune IP n'est déterminable (dimension isolée, jamais bloquante). */
const UNKNOWN_IP = "unknown";

/**
 * Indique si les en-têtes de proxy (`X-Forwarded-For`/`X-Real-IP`) doivent être
 * pris en compte. Piloté par `TRUST_PROXY` (défaut `false`). Accepte `1`/`true`
 * (insensible à la casse). Lu à l'appel (pas de cache) pour rester testable.
 */
export function isProxyTrusted(): boolean {
  const raw = (process.env["TRUST_PROXY"] ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true";
}

/**
 * Extrait l'IP de connexion TCP réelle depuis le contexte Node, ou `null`.
 * Tolérant : en test (app.fetch/app.request sans serveur Node), `getConnInfo`
 * peut échouer — on renvoie alors `null` sans lever.
 *
 * @param c - Contexte Hono
 */
function connectionIp(c: Context): string | null {
  try {
    return getConnInfo(c).remote.address ?? null;
  } catch {
    return null;
  }
}

/**
 * Résout l'IP cliente réelle d'une requête Hono en respectant `TRUST_PROXY`.
 * Utilisée par le rate-limit et l'audit : un attaquant ne peut plus réinitialiser
 * sa fenêtre ni usurper une IP d'audit via un `X-Forwarded-For` falsifié.
 *
 * @param c - Contexte Hono
 * @returns IP cliente (jamais vide : repli `unknown`)
 */
export function resolveClientIp(c: Context): string {
  if (isProxyTrusted()) {
    const fwd = c.req.header("x-forwarded-for");
    if (fwd) {
      const first = fwd.split(",")[0]?.trim();
      if (first) return first;
    }
    const real = c.req.header("x-real-ip");
    if (real) return real;
  }
  return connectionIp(c) ?? UNKNOWN_IP;
}
