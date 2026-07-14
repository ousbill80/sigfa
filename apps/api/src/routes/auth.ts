/**
 * Routes d'authentification SIGFA — /auth/*
 *
 * POST /auth/login   — security: [] (publique)
 * POST /auth/refresh — security: [] (publique)
 * POST /auth/logout  — security: [] (publique, idempotent)
 * GET  /auth/me      — AUTHENTICATED (Bearer JWT)
 *
 * @module
 */

import { Hono } from "hono";
import { z } from "zod";
import type { Redis } from "ioredis";
import type { Client } from "pg";
import { SigfaError, buildError } from "src/lib/errors.js";
import {
  login,
  logout,
  refresh,
  verifyAccessToken,
} from "src/services/auth.service.js";

/** Schéma Zod du corps de la requête de login */
const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

/** Schéma Zod du corps des requêtes refresh/logout (conforme contrat — pas de minLength) */
const refreshSchema = z.object({
  refreshToken: z.string(),
});

/** Variables de contexte Hono injectées par le app.ts */
interface AuthEnv {
  Variables: {
    db: Client;
    redis: Redis;
    jwtSecret: Uint8Array;
  };
}

/**
 * Parse le corps JSON de la requête.
 * Retourne `null` si le corps est malformé (au lieu de lever une exception).
 *
 * @param c - Contexte Hono
 */
async function parseJson(c: { req: { json: () => Promise<unknown> } }): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return null;
  }
}

/**
 * Crée le routeur d'authentification.
 * Les dépendances (db, redis, jwtSecret) sont injectées via les variables de contexte Hono.
 */
export function createAuthRouter(): Hono<AuthEnv> {
  const router = new Hono<AuthEnv>();

  /**
   * POST /auth/login
   * Authentifie l'utilisateur, retourne access + refresh tokens.
   */
  router.post("/login", async (c) => {
    const body = await parseJson(c);
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        buildError("VALIDATION_ERROR", "Corps de requête invalide.", {
          issues: parsed.error.issues,
        }),
        400
      );
    }
    const { email, password } = parsed.data;
    const db = c.get("db");
    const redis = c.get("redis");
    const secret = c.get("jwtSecret");

    try {
      const tokens = await login(db, redis, secret, email, password);
      return c.json(tokens, 200);
    } catch (err) {
      if (err instanceof SigfaError) {
        return c.json(buildError(err.code, err.message, err.details), err.httpStatus as 401 | 429);
      }
      throw err;
    }
  });

  /**
   * POST /auth/refresh
   * Rotation du refresh token — retourne un nouveau couple access/refresh.
   */
  router.post("/refresh", async (c) => {
    const body = await parseJson(c);
    const parsed = refreshSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        buildError("VALIDATION_ERROR", "Corps de requête invalide."),
        400
      );
    }
    const { refreshToken } = parsed.data;
    const db = c.get("db");
    const redis = c.get("redis");
    const secret = c.get("jwtSecret");

    try {
      const tokens = await refresh(db, redis, secret, refreshToken);
      return c.json(tokens, 200);
    } catch (err) {
      if (err instanceof SigfaError) {
        return c.json(buildError(err.code, err.message, err.details), err.httpStatus as 401);
      }
      throw err;
    }
  });

  /**
   * POST /auth/logout
   * Révoque le refresh token. Idempotent — security: [].
   */
  router.post("/logout", async (c) => {
    const body = await parseJson(c);
    const parsed = refreshSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        buildError("VALIDATION_ERROR", "Corps de requête invalide."),
        400
      );
    }
    const { refreshToken } = parsed.data;
    const redis = c.get("redis");
    await logout(redis, refreshToken);
    return c.json({ success: true }, 200);
  });

  /**
   * GET /auth/me
   * Profil de l'utilisateur courant — nécessite un Bearer JWT valide.
   */
  router.get("/me", async (c) => {
    const authHeader = c.req.header("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return c.json(buildError("UNAUTHORIZED", "Token manquant."), 401);
    }
    const token = authHeader.slice(7);
    const secret = c.get("jwtSecret");

    try {
      const payload = await verifyAccessToken(secret, token);
      const profile = {
        id: payload.sub,
        email: (payload["email"] as string | undefined) ?? "",
        role: payload.role,
        bankId: payload.bankId,
        agencyId: (payload.agencyIds as string[])[0] ?? undefined,
        // WEB-002-HDR : claim additif displayName (UserProfile.displayName, contrat).
        ...(typeof payload.displayName === "string" && payload.displayName.length > 0
          ? { displayName: payload.displayName }
          : {}),
      };
      return c.json(profile, 200);
    } catch (err) {
      if (err instanceof SigfaError) {
        return c.json(buildError(err.code, err.message), err.httpStatus as 401);
      }
      throw err;
    }
  });

  return router;
}
