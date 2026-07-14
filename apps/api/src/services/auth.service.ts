/**
 * Service d'authentification SIGFA — API-001
 *
 * Gère login, refresh, logout et résolution du profil courant.
 * Toutes les requêtes à `users` lors du login sont HORS contexte tenant
 * (email unique global — exception documentée).
 *
 * @module
 */

import bcrypt from "bcryptjs";
import {
  SignJWT,
  jwtVerify,
  type JWTPayload,
} from "jose";
import { nanoid } from "nanoid";
import type { Redis } from "ioredis";
import type { Client } from "pg";
import { SigfaError } from "src/lib/errors.js";
import { logger } from "src/lib/logger.js";

/** Durée de vie de l'access token : 15 minutes */
const ACCESS_TOKEN_TTL_SECONDS = 900;

/** Durée de vie du refresh token : 7 jours */
const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

/** Nombre max d'échecs de connexion avant verrouillage */
const MAX_FAILED_ATTEMPTS = 5;

/** Durée de verrouillage après MAX_FAILED_ATTEMPTS : 15 min */
const LOCK_DURATION_SECONDS = 15 * 60;

/** Préfixe des clés Redis pour les refresh tokens actifs */
const REFRESH_KEY_PREFIX = "refresh:";

/** Préfixe des clés Redis pour les familles de tokens */
const FAMILY_KEY_PREFIX = "family:";

/**
 * Préfixe des clés Redis pour les tokens consommés (détection de vol).
 * TTL identique au refresh token (7 j) — suffisant pour détecter un rejeu.
 */
const CONSUMED_KEY_PREFIX = "consumed:";

/** Données stockées dans Redis pour un refresh token actif */
interface RefreshTokenData {
  userId: string;
  familyId: string;
  bankId: string | null;
  role: string;
  agencyIds: string[];
  /** Nom d'affichage (additif WEB-002-HDR — absent des tokens historiques). */
  displayName?: string | null;
}

/** Payload du JWT access token */
export interface JwtAccessPayload extends JWTPayload {
  sub: string;
  bankId: string | null;
  role: string;
  agencyIds: string[];
  /** Nom d'affichage (claim additif WEB-002-HDR — absent des tokens historiques). */
  displayName?: string | null;
}

/** Résultat d'une opération de login/refresh */
export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

/** Profil utilisateur retourné par /auth/me */
export interface UserProfile {
  id: string;
  email: string;
  role: string;
  bankId: string | null;
  agencyId: string | undefined;
}

/**
 * Récupère un utilisateur par email (connexion SANS contexte tenant — exception documentée).
 * L'email est unique globalement, ce qui permet la résolution sans bank_id.
 *
 * @param db    - Client PostgreSQL (BYPASSRLS pour la résolution globale de l'email)
 * @param email - Email de l'utilisateur
 */
async function getUserByEmail(
  db: Client,
  email: string
): Promise<Record<string, unknown> | null> {
  const result = await db.query(
    `SELECT u.id, u.email, u.password_hash, u.role, u.bank_id,
            u.failed_login_attempts, u.locked_until,
            u.is_active, u.deleted_at,
            u.first_name, u.last_name, u.display_name,
            array_agg(DISTINCT au.agency_id) FILTER (WHERE au.agency_id IS NOT NULL) AS agency_ids
     FROM users u
     LEFT JOIN agency_users au ON au.user_id = u.id
     WHERE u.email = $1
     GROUP BY u.id`,
    [email]
  );
  return (result.rows[0] as Record<string, unknown>) ?? null;
}

/**
 * Résout le nom d'affichage d'un utilisateur (WEB-002-HDR) :
 * `display_name` (conseillers) sinon « Prénom Nom », sinon null.
 *
 * @param user - Ligne utilisateur (snake_case)
 * @returns Le nom d'affichage, ou null si aucun champ nom n'est renseigné
 */
function resolveDisplayName(user: Record<string, unknown>): string | null {
  const displayName = user["display_name"];
  if (typeof displayName === "string" && displayName.trim().length > 0) {
    return displayName.trim();
  }
  const first = typeof user["first_name"] === "string" ? (user["first_name"] as string) : "";
  const last = typeof user["last_name"] === "string" ? (user["last_name"] as string) : "";
  const full = `${first} ${last}`.trim();
  return full.length > 0 ? full : null;
}

/**
 * Signe un JWT access token avec les claims requis.
 *
 * @param secret      - Secret JWT (Uint8Array)
 * @param userId      - Identifiant de l'utilisateur
 * @param bankId      - Identifiant de la banque (null pour SUPER_ADMIN)
 * @param role        - Rôle de l'utilisateur
 * @param agencyIds   - Identifiants des agences
 * @param displayName - Nom d'affichage (claim additif WEB-002-HDR — null si inconnu)
 */
async function signAccessToken(
  secret: Uint8Array,
  userId: string,
  bankId: string | null,
  role: string,
  agencyIds: string[],
  displayName: string | null = null
): Promise<string> {
  return new SignJWT({ bankId, role, agencyIds, displayName })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TOKEN_TTL_SECONDS}s`)
    .sign(secret);
}

/**
 * Stocke un refresh token actif dans Redis avec TTL 7 jours.
 *
 * @param redis - Client Redis
 * @param jti   - Identifiant unique du token
 * @param data  - Données associées au token
 */
async function storeRefreshToken(
  redis: Redis,
  jti: string,
  data: RefreshTokenData
): Promise<void> {
  await redis.setex(
    `${REFRESH_KEY_PREFIX}${jti}`,
    REFRESH_TOKEN_TTL_SECONDS,
    JSON.stringify(data)
  );
}

/**
 * Marque un refresh token comme consommé (pour la détection de vol).
 * Conserve le familyId pendant 7 jours pour identifier une tentative de rejeu.
 *
 * @param redis    - Client Redis
 * @param jti      - Identifiant du token consommé
 * @param familyId - Identifiant de la famille associée
 */
async function markTokenConsumed(
  redis: Redis,
  jti: string,
  familyId: string
): Promise<void> {
  await redis.setex(
    `${CONSUMED_KEY_PREFIX}${jti}`,
    REFRESH_TOKEN_TTL_SECONDS,
    familyId
  );
}

/**
 * Révoque toute la famille de tokens (détection de vol).
 *
 * @param redis    - Client Redis
 * @param familyId - Identifiant de la famille
 */
async function revokeFamily(redis: Redis, familyId: string): Promise<void> {
  await redis.del(`${FAMILY_KEY_PREFIX}${familyId}`);
}

/**
 * Effectue le login : vérifie les credentials, gère le verrouillage,
 * génère access + refresh tokens.
 *
 * @param db       - Client PostgreSQL (hors contexte tenant pour email global)
 * @param redis    - Client Redis
 * @param secret   - Secret JWT
 * @param email    - Email de l'utilisateur
 * @param password - Mot de passe en clair
 */
export async function login(
  db: Client,
  redis: Redis,
  secret: Uint8Array,
  email: string,
  password: string
): Promise<AuthTokens> {
  const user = await getUserByEmail(db, email);

  // Utilisateur inconnu — retourner 401 générique (pas de leak d'info)
  if (!user) {
    throw new SigfaError("UNAUTHORIZED", "Identifiants invalides.", 401);
  }

  const userId = user["id"] as string;
  const lockedUntil = user["locked_until"] as Date | null;
  const failedAttempts = user["failed_login_attempts"] as number;
  const isActive = user["is_active"] as boolean;
  const deletedAt = user["deleted_at"] as Date | null;

  // Compte inactif ou supprimé
  if (!isActive || deletedAt !== null) {
    throw new SigfaError("UNAUTHORIZED", "Compte désactivé ou supprimé.", 401);
  }

  // Vérifier si le compte est actuellement verrouillé
  const now = new Date();
  if (lockedUntil !== null && lockedUntil > now) {
    const retryAfterSeconds = Math.ceil(
      (lockedUntil.getTime() - now.getTime()) / 1000
    );
    throw new SigfaError(
      "TOO_MANY_REQUESTS",
      "Trop de tentatives de connexion. Réessayez dans 15 minutes.",
      429,
      { retryAfterSeconds }
    );
  }

  const passwordHash = user["password_hash"] as string;
  const isValidPassword = await bcrypt.compare(password, passwordHash);

  if (!isValidPassword) {
    const newAttempts = failedAttempts + 1;
    if (newAttempts >= MAX_FAILED_ATTEMPTS) {
      const newLockedUntil = new Date(
        now.getTime() + LOCK_DURATION_SECONDS * 1000
      );
      await db.query(
        `UPDATE users SET failed_login_attempts = $1, locked_until = $2 WHERE id = $3`,
        [newAttempts, newLockedUntil.toISOString(), userId]
      );
      throw new SigfaError(
        "TOO_MANY_REQUESTS",
        "Trop de tentatives de connexion. Réessayez dans 15 minutes.",
        429,
        { retryAfterSeconds: LOCK_DURATION_SECONDS }
      );
    }
    await db.query(
      `UPDATE users SET failed_login_attempts = $1 WHERE id = $2`,
      [newAttempts, userId]
    );
    throw new SigfaError("UNAUTHORIZED", "Identifiants invalides.", 401);
  }

  // Succès : réinitialiser le compteur d'échecs et locked_until
  await db.query(
    `UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = $1`,
    [userId]
  );

  const bankId = (user["bank_id"] as string | null) ?? null;
  const role = user["role"] as string;
  const agencyIds = (user["agency_ids"] as string[] | null) ?? [];
  // WEB-002-HDR : nom d'affichage embarqué dans le JWT (display_name sinon
  // "Prénom Nom") — consommé par les consoles web SANS appel API supplémentaire.
  const displayName = resolveDisplayName(user);

  const jtiSecret = nanoid();
  const familyId = nanoid();

  const accessToken = await signAccessToken(
    secret,
    userId,
    bankId,
    role,
    agencyIds,
    displayName
  );

  await storeRefreshToken(redis, jtiSecret, {
    userId,
    familyId,
    bankId,
    role,
    agencyIds,
    displayName,
  });

  // Pointer la famille vers le token courant
  await redis.setex(
    `${FAMILY_KEY_PREFIX}${familyId}`,
    REFRESH_TOKEN_TTL_SECONDS,
    jtiSecret
  );

  logger.info({ userId, role }, "Login réussi");

  return {
    accessToken,
    refreshToken: jtiSecret,
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
  };
}

/**
 * Effectue la rotation du refresh token (GETDEL atomique).
 *
 * Détection de vol (rejeu) :
 * - Si le token est encore actif → rotation normale
 * - Si le token est marqué "consommé" → famille révoquée (vol détecté)
 * - Sinon (token inconnu) → 401 simple
 *
 * @param db           - Client PostgreSQL
 * @param redis        - Client Redis
 * @param secret       - Secret JWT
 * @param refreshToken - Refresh token opaque
 */
export async function refresh(
  db: Client,
  redis: Redis,
  secret: Uint8Array,
  refreshToken: string
): Promise<AuthTokens> {
  // GETDEL atomique : retourne la valeur ET supprime la clé (si active)
  const raw = await redis.getdel(`${REFRESH_KEY_PREFIX}${refreshToken}`);

  if (!raw) {
    // Token inconnu ou déjà consommé — vérifier si c'est un rejeu
    const consumedFamilyId = await redis.get(
      `${CONSUMED_KEY_PREFIX}${refreshToken}`
    );
    if (consumedFamilyId) {
      // Rejeu d'un token consommé = détection de vol → révoquer la famille
      await revokeFamily(redis, consumedFamilyId);
      logger.warn({ familyId: consumedFamilyId }, "Vol de token détecté — famille révoquée");
      throw new SigfaError(
        "UNAUTHORIZED",
        "Détection de rejeu : session révoquée intégralement.",
        401
      );
    }
    throw new SigfaError(
      "UNAUTHORIZED",
      "Refresh token invalide ou expiré.",
      401
    );
  }

  const data = JSON.parse(raw) as RefreshTokenData;
  const { userId, familyId, bankId, role, agencyIds } = data;
  // WEB-002-HDR : claim additif — absent (undefined) sur les tokens historiques.
  const displayName = data.displayName ?? null;

  // Vérifier que la famille est toujours valide
  const familyCurrentToken = await redis.get(`${FAMILY_KEY_PREFIX}${familyId}`);

  if (familyCurrentToken === null) {
    // Famille révoquée (logout précédent) → 401
    logger.warn({ userId, familyId }, "Famille de tokens révoquée");
    throw new SigfaError(
      "UNAUTHORIZED",
      "Session révoquée. Reconnectez-vous.",
      401
    );
  }

  // Vérifier l'état du compte (inactif / supprimé)
  const userResult = await db.query(
    `SELECT is_active, deleted_at FROM users WHERE id = $1`,
    [userId]
  );
  const userRow = userResult.rows[0] as
    | { is_active: boolean; deleted_at: Date | null }
    | undefined;

  if (!userRow || !userRow.is_active || userRow.deleted_at !== null) {
    await revokeFamily(redis, familyId);
    throw new SigfaError("UNAUTHORIZED", "Compte désactivé ou supprimé.", 401);
  }

  // Rotation : nouveau refresh token
  const newJti = nanoid();

  const [accessToken] = await Promise.all([
    signAccessToken(secret, userId, bankId, role, agencyIds, displayName),
    // Marquer l'ancien token comme consommé (pour détection de vol)
    markTokenConsumed(redis, refreshToken, familyId),
    // Stocker le nouveau token actif
    storeRefreshToken(redis, newJti, { userId, familyId, bankId, role, agencyIds, displayName }),
    // Mettre à jour le pointeur de famille
    redis.setex(
      `${FAMILY_KEY_PREFIX}${familyId}`,
      REFRESH_TOKEN_TTL_SECONDS,
      newJti
    ),
  ]);

  logger.info({ userId }, "Refresh token rotation réussie");

  return {
    accessToken,
    refreshToken: newJti,
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
  };
}

/**
 * Révoque le refresh token fourni (logout).
 * Idempotent : ne lève pas d'erreur si le token est inconnu.
 *
 * @param redis        - Client Redis
 * @param refreshToken - Refresh token opaque à révoquer
 */
export async function logout(
  redis: Redis,
  refreshToken: string
): Promise<void> {
  const raw = await redis.getdel(`${REFRESH_KEY_PREFIX}${refreshToken}`);
  if (raw) {
    const data = JSON.parse(raw) as RefreshTokenData;
    await revokeFamily(redis, data.familyId);
    logger.info({ userId: data.userId }, "Logout réussi");
  }
}

/**
 * Vérifie un access token JWT et retourne le payload.
 *
 * @param secret - Secret JWT
 * @param token  - JWT access token
 * @throws {SigfaError} UNAUTHORIZED si le token est invalide ou expiré
 */
export async function verifyAccessToken(
  secret: Uint8Array,
  token: string
): Promise<JwtAccessPayload> {
  try {
    // Restriction d'algorithme : n'accepter QUE HS256 (nos tokens sont signés
    // HS256). Empêche les attaques de confusion d'algorithme (ex. alg forgé).
    const { payload } = await jwtVerify(token, secret, { algorithms: ["HS256"] });
    return payload as JwtAccessPayload;
  } catch {
    throw new SigfaError("UNAUTHORIZED", "Token invalide ou expiré.", 401);
  }
}
