/**
 * phone-cipher (API) — chiffrement AES-256-GCM + HMAC-SHA256 des téléphones.
 *
 * Miroir applicatif de DB-008 : la clé ne transite JAMAIS vers PostgreSQL. Le
 * format stocké `v1:iv:tag:ciphertext` (hex) est identique au module database,
 * afin que `phone_encrypted`/`phone_hash` restent interopérables. Deux formes
 * d'un même numéro (`'+225 07 …'` et `'+22507…'`) produisent le MÊME hash.
 *
 * Fail-lazy : les clés sont lues au premier appel (pas au chargement) pour ne
 * pas bloquer les routes qui ne manipulent aucun téléphone.
 *
 * @module
 */

import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import { SigfaError } from "src/lib/errors.js";

/** Préfixe de version du format de chiffrement (rotation future). */
const CIPHER_VERSION = "v1";
/** Algorithme AES-256 en mode GCM (authentifié). */
const ALGORITHM = "aes-256-gcm";
/** Taille de l'IV en octets (recommandation NIST pour GCM). */
const IV_LENGTH = 12;
/** Taille de la clé/HMAC en octets. */
const KEY_LENGTH = 32;
/** Taille du tag d'authentification GCM en octets. */
const AUTH_TAG_LENGTH = 16;
/** Regex E.164 : `+` suivi d'un chiffre 1–9 puis 6 à 14 chiffres. */
const E164_REGEX = /^\+[1-9]\d{6,14}$/;

/**
 * Charge une clé hex de 32 octets depuis l'environnement.
 * @param name - Nom de la variable d'environnement
 * @returns Buffer de 32 octets
 * @throws {SigfaError} 500 si absente, non-hex ou de mauvaise taille
 */
function loadKey(name: string): Buffer {
  const raw = process.env[name];
  if (!raw || !/^[0-9a-fA-F]{64}$/.test(raw)) {
    throw new SigfaError(
      "INTERNAL_SERVER_ERROR",
      `${name} absente ou invalide (64 caractères hex requis).`,
      500
    );
  }
  return Buffer.from(raw, "hex");
}

/**
 * Normalise un numéro : strippe espaces/tirets, valide E.164.
 * @param raw - Numéro brut
 * @returns Forme canonique E.164
 * @throws {SigfaError} 422 INVALID_PHONE si non conforme
 */
export function normalizePhone(raw: string): string {
  const stripped = raw.replace(/[\s-]/g, "");
  if (!E164_REGEX.test(stripped)) {
    throw new SigfaError("INVALID_PHONE", "Numéro de téléphone invalide (E.164 attendu).", 422);
  }
  return stripped;
}

/**
 * Empreinte déterministe HMAC-SHA256 d'un numéro (normalisé d'abord).
 * @param raw - Numéro brut
 * @returns Empreinte hexadécimale (64 caractères)
 */
export function hashPhone(raw: string): string {
  const normalized = normalizePhone(raw);
  return createHmac("sha256", loadKey("PHONE_HASH_KEY")).update(normalized).digest("hex");
}

/**
 * Chiffre un numéro en AES-256-GCM (IV aléatoire, normalisé d'abord).
 * @param plain - Numéro brut
 * @returns Chaîne `v1:iv:tag:ciphertext` (hex)
 */
export function encryptPhone(plain: string): string {
  const normalized = normalizePhone(plain);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, loadKey("PHONE_ENCRYPTION_KEY"), iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });
  const ct = Buffer.concat([cipher.update(normalized, "utf8"), cipher.final()]);
  return [CIPHER_VERSION, iv.toString("hex"), cipher.getAuthTag().toString("hex"), ct.toString("hex")].join(":");
}

/**
 * Déchiffre une valeur `v1:iv:tag:ciphertext` (vérifie le tag GCM).
 * @param cipher - Chaîne chiffrée
 * @returns Numéro en clair (E.164)
 * @throws {SigfaError} 500 si format/version/intégrité invalide
 */
export function decryptPhone(cipher: string): string {
  const segments = cipher.split(":");
  if (segments.length !== 4 || segments[0] !== CIPHER_VERSION) {
    throw new SigfaError("INTERNAL_SERVER_ERROR", "Format de chiffrement invalide.", 500);
  }
  const [, ivHex, tagHex, ctHex] = segments as [string, string, string, string];
  const key = loadKey("PHONE_ENCRYPTION_KEY");
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, "hex"), {
    authTagLength: AUTH_TAG_LENGTH,
  });
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([decipher.update(Buffer.from(ctHex, "hex")), decipher.final()]).toString("utf8");
}

/** Longueur attendue d'une clé (octets) — exportée pour les tests. */
export const PHONE_KEY_BYTES = KEY_LENGTH;
