/**
 * Rate-limit Redis sliding-window RÉUTILISABLE (API-010, monté globalement par API-011).
 *
 * Algorithme : sorted-set par clé, membres = horodatages (ms). À chaque appel :
 *   1. ZREMRANGEBYSCORE  — évince les entrées hors de la fenêtre glissante
 *   2. ZCARD             — compte les entrées restantes dans la fenêtre
 *   3. si < limite : ZADD (nouvelle entrée) + EXPIRE (auto-nettoyage) → autorisé
 *      sinon        : refusé, `retryAfterSeconds` calculé sur l'entrée la plus ancienne
 *
 * Générique : la clé encode la dimension (IP, trackingId, IP×trackingId, …).
 * Aucune PII n'est journalisée ni stockée — seule la clé opaque fournie transite.
 *
 * @module
 */

import type { Redis } from "ioredis";
import type { Context, Next } from "hono";
import { buildError } from "src/lib/errors.js";
import { resolveClientIp } from "src/lib/client-ip.js";

/** Résultat d'une vérification de débit. */
export interface RateLimitResult {
  /** `true` si l'appel est autorisé (sous la limite). */
  allowed: boolean;
  /** Secondes à attendre avant le prochain essai (0 si autorisé). */
  retryAfterSeconds: number;
  /** Appels restants dans la fenêtre courante (0 si refusé). */
  remaining: number;
}

/**
 * Vérifie et consomme un jeton de débit pour une clé (sliding-window).
 *
 * @param redis         - Client Redis
 * @param key           - Clé opaque de la dimension limitée (ex. `feedback:ip:1.2.3.4`)
 * @param limit         - Nombre maximal d'appels autorisés dans la fenêtre
 * @param windowSeconds - Taille de la fenêtre glissante en secondes
 * @returns Décision + Retry-After + restant
 */
export async function checkRateLimit(
  redis: Redis,
  key: string,
  limit: number,
  windowSeconds: number
): Promise<RateLimitResult> {
  const now = Date.now();
  const windowMs = windowSeconds * 1000;
  const redisKey = `ratelimit:${key}`;
  await redis.zremrangebyscore(redisKey, 0, now - windowMs);
  const count = await redis.zcard(redisKey);
  if (count >= limit) {
    return { allowed: false, retryAfterSeconds: await retryAfter(redis, redisKey, now, windowMs), remaining: 0 };
  }
  await redis.zadd(redisKey, now, `${now}-${Math.random().toString(36).slice(2)}`);
  await redis.expire(redisKey, windowSeconds);
  return { allowed: true, retryAfterSeconds: 0, remaining: limit - count - 1 };
}

/**
 * Calcule le Retry-After : temps restant avant que l'entrée la plus ancienne
 * ne sorte de la fenêtre (au minimum 1 s).
 *
 * @param redis    - Client Redis
 * @param redisKey - Clé Redis préfixée
 * @param now      - Horodatage courant (ms)
 * @param windowMs - Fenêtre en ms
 */
async function retryAfter(redis: Redis, redisKey: string, now: number, windowMs: number): Promise<number> {
  const oldest = await redis.zrange(redisKey, 0, 0, "WITHSCORES");
  const oldestTs = oldest.length >= 2 ? Number(oldest[1]) : now;
  const remainingMs = oldestTs + windowMs - now;
  return Math.max(1, Math.ceil(remainingMs / 1000));
}

/** Configuration d'une règle de rate-limit pour le middleware. */
export interface RateLimitRule {
  /** Construit la clé depuis le contexte (encode la/les dimension(s)). */
  keyFn: (c: Context) => string;
  /** Limite d'appels dans la fenêtre. */
  limit: number;
  /** Fenêtre glissante (secondes). */
  windowSeconds: number;
}

/**
 * Extrait l'IP cliente pour la dimension de rate-limit (jamais de PII loggée).
 * Délègue à `resolveClientIp` : les en-têtes `X-Forwarded-For`/`X-Real-IP` ne
 * sont pris en compte que si `TRUST_PROXY` est activé (défaut `false`), sinon
 * l'IP de connexion réelle est utilisée. Empêche un attaquant de réinitialiser
 * sa fenêtre via un XFF falsifié (Boucle 3 F3). Repli `unknown` sinon.
 *
 * @param c - Contexte Hono
 */
export function clientIp(c: Context): string {
  return resolveClientIp(c);
}

/**
 * Fabrique un middleware Hono appliquant une ou plusieurs règles de débit.
 * Conçu générique pour un montage global (API-011). Sur dépassement : 429 LA LOI
 * (`TOO_MANY_REQUESTS`) + en-tête `Retry-After`.
 *
 * @param rules - Règles à évaluer (toutes doivent passer)
 * @returns Middleware Hono
 */
export function rateLimitMiddleware(
  rules: RateLimitRule[]
): (c: Context, next: Next) => Promise<Response | void> {
  return async (c, next) => {
    const redis = c.get("redis") as Redis;
    for (const rule of rules) {
      const result = await checkRateLimit(redis, rule.keyFn(c), rule.limit, rule.windowSeconds);
      if (!result.allowed) {
        c.header("Retry-After", String(result.retryAfterSeconds));
        return c.json(
          buildError("TOO_MANY_REQUESTS", "Limite de débit atteinte. Réessayez ultérieurement.", {
            retryAfterSeconds: result.retryAfterSeconds,
          }),
          429
        );
      }
    }
    return next();
  };
}
