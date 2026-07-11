/**
 * DB-008 — Chiffrement AES-256-GCM applicatif + HMAC-SHA256 des téléphones.
 *
 * ## Décision d'architecture (consignée)
 * Chiffrement **applicatif** (Node `node:crypto`), PAS `pgcrypto` : la clé ne transite
 * JAMAIS vers PostgreSQL, les dumps SQL sont chiffrés par construction. La rotation de
 * clé future s'appuie sur le préfixe de version du format stocké (`v1:...`).
 *
 * ## Format de stockage
 * `v1:iv:tag:ciphertext` — tous les segments en hexadécimal, IV aléatoire (12 octets)
 * par valeur, tag d'authentification GCM (16 octets). Le préfixe `v1` permet une
 * rotation de format sans casser les données existantes (story d'exploitation future).
 *
 * ## Normalisation centralisée
 * `normalizePhone` strippe les espaces et tirets puis valide la forme E.164
 * (`^\+[1-9]\d{7,14}$`). Toute écriture de `phone_encrypted`/`phone_hash` (tickets,
 * users, consents, log, devices, test_recipients) DOIT passer par ce module afin que
 * `'+225 07 00 00 00 01'` et `'+2250700000001'` produisent le MÊME `phone_hash`.
 *
 * ## Fail-fast au chargement
 * Les clés sont lues et validées AU CHARGEMENT du module. Si `PHONE_ENCRYPTION_KEY`
 * ou `PHONE_HASH_KEY` est absente ou invalide, l'import échoue avec un message
 * explicite — JAMAIS de repli en clair.
 *
 * @module
 */

import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

/** Préfixe de version du format de chiffrement (rotation future). */
const CIPHER_VERSION = "v1";
/** Algorithme AES-256 en mode GCM (authentifié). */
const ALGORITHM = "aes-256-gcm";
/** Taille de l'IV en octets (recommandation NIST pour GCM). */
const IV_LENGTH = 12;
/** Taille de la clé AES-256 en octets. */
const KEY_LENGTH = 32;
/** Taille du tag d'authentification GCM en octets. */
const AUTH_TAG_LENGTH = 16;

/** Regex E.164 : `+` suivi d'un chiffre 1–9 puis 7 à 14 chiffres (8–15 au total). */
const E164_REGEX = /^\+[1-9]\d{7,14}$/;

/**
 * Erreur levée quand un numéro de téléphone ne respecte pas la forme E.164
 * après normalisation.
 */
export class InvalidPhoneError extends Error {
  /**
   * @param message - Message décrivant le numéro rejeté (sans PII inutile)
   */
  constructor(message: string) {
    super(message);
    this.name = "InvalidPhoneError";
  }
}

/**
 * Charge et valide la clé de chiffrement AES-256 depuis l'environnement.
 * @returns Buffer de 32 octets
 * @throws Si la variable est absente, non-hex, ou de mauvaise taille
 */
function loadEncryptionKey(): Buffer {
  const raw = process.env.PHONE_ENCRYPTION_KEY;
  if (raw === undefined || raw.length === 0) {
    throw new Error(
      "PHONE_ENCRYPTION_KEY est absente : définir une clé AES-256 de 32 octets (64 caractères hex) — voir .env.example."
    );
  }
  if (!/^[0-9a-fA-F]+$/.test(raw)) {
    throw new Error(
      "PHONE_ENCRYPTION_KEY doit être une chaîne hexadécimale (générer via `openssl rand -hex 32`)."
    );
  }
  const key = Buffer.from(raw, "hex");
  if (key.length !== KEY_LENGTH) {
    throw new Error(
      `PHONE_ENCRYPTION_KEY doit faire exactement 32 octets (64 caractères hex) — reçu ${String(key.length)} octets.`
    );
  }
  return key;
}

/**
 * Charge et valide la clé HMAC depuis l'environnement.
 * @returns Clé HMAC (string non vide)
 * @throws Si la variable est absente ou vide
 */
function loadHashKey(): string {
  const raw = process.env.PHONE_HASH_KEY;
  if (raw === undefined || raw.length === 0) {
    throw new Error(
      "PHONE_HASH_KEY est absente : définir une clé HMAC secrète (générer via `openssl rand -hex 32`) — voir .env.example."
    );
  }
  return raw;
}

// ── Fail-fast : validation des clés au chargement du module ────────────────────
const ENCRYPTION_KEY = loadEncryptionKey();
const HASH_KEY = loadHashKey();

/**
 * Normalise un numéro de téléphone : strippe espaces et tirets, valide E.164.
 *
 * `'+225 07 00 00 00 01'`, `'+225-07-00-00-00-01'` et `'+2250700000001'` produisent
 * tous la forme canonique `'+2250700000001'`.
 *
 * @param raw - Numéro brut (potentiellement espacé/tireté)
 * @returns Forme canonique E.164
 * @throws {InvalidPhoneError} Si le numéro n'est pas E.164 après normalisation
 */
export function normalizePhone(raw: string): string {
  const stripped = raw.replace(/[\s-]/g, "");
  if (!E164_REGEX.test(stripped)) {
    throw new InvalidPhoneError(
      `Numéro de téléphone invalide (attendu E.164 ^\\+[1-9]\\d{7,14}$) : longueur=${String(stripped.length)}.`
    );
  }
  return stripped;
}

/**
 * Calcule l'empreinte déterministe HMAC-SHA256 d'un numéro de téléphone.
 *
 * NORMALISE d'abord (via `normalizePhone`) : deux représentations d'un même numéro
 * produisent le MÊME hash. Le hash est une colonne de recherche, jamais réversible.
 *
 * @param raw - Numéro brut (normalisé avant hachage)
 * @returns Empreinte hexadécimale (64 caractères)
 * @throws {InvalidPhoneError} Si le numéro n'est pas E.164
 */
export function hashPhone(raw: string): string {
  const normalized = normalizePhone(raw);
  return createHmac("sha256", HASH_KEY).update(normalized).digest("hex");
}

/**
 * Chiffre un numéro de téléphone en AES-256-GCM avec IV aléatoire.
 *
 * NORMALISE d'abord (via `normalizePhone`) : la valeur chiffrée correspond toujours
 * à la forme canonique E.164. Chaque appel génère un IV distinct, donc deux
 * chiffrements du même numéro produisent des ciphertexts DIFFÉRENTS.
 *
 * @param plain - Numéro brut (normalisé avant chiffrement)
 * @returns Chaîne au format `v1:iv:tag:ciphertext` (tous segments en hex)
 * @throws {InvalidPhoneError} Si le numéro n'est pas E.164
 */
export function encryptPhone(plain: string): string {
  const normalized = normalizePhone(plain);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, ENCRYPTION_KEY, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });
  const ciphertext = Buffer.concat([cipher.update(normalized, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [
    CIPHER_VERSION,
    iv.toString("hex"),
    authTag.toString("hex"),
    ciphertext.toString("hex"),
  ].join(":");
}

/**
 * Déchiffre une valeur `v1:iv:tag:ciphertext` produite par `encryptPhone`.
 *
 * Vérifie le tag d'authentification GCM : toute altération (ciphertext ou tag) fait
 * échouer le déchiffrement. Une version de format inconnue est rejetée explicitement.
 *
 * @param cipher - Chaîne au format `v1:iv:tag:ciphertext`
 * @returns Numéro de téléphone en clair (forme canonique E.164)
 * @throws Si le format est malformé, la version inconnue, ou l'intégrité compromise
 */
export function decryptPhone(cipher: string): string {
  const segments = cipher.split(":");
  if (segments.length !== 4) {
    throw new Error("Format de chiffrement invalide : attendu `v1:iv:tag:ciphertext`.");
  }
  const [version, ivHex, tagHex, ctHex] = segments as [string, string, string, string];
  if (version !== CIPHER_VERSION) {
    throw new Error(`Version de chiffrement inconnue : « ${version} » (attendu « ${CIPHER_VERSION} »).`);
  }
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(tagHex, "hex");
  const ciphertext = Buffer.from(ctHex, "hex");
  const decipher = createDecipheriv(ALGORITHM, ENCRYPTION_KEY, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });
  decipher.setAuthTag(authTag);
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plain.toString("utf8");
}
