/**
 * backup-cipher — chiffrement AES-256-GCM des dumps de backup + checksum (SEC-003).
 *
 * Réutilise le pattern AES-256-GCM déjà en place pour les téléphones
 * (`lib/phone-cipher.ts`, miroir de DB-008), appliqué ici à un flux binaire
 * arbitraire (dump `pg_dump`) plutôt qu'à une chaîne E.164.
 *
 * Format d'enveloppe (binaire) : `[version:1][iv:12][tag:16][ciphertext:N]`.
 * Chiffrement AU REPOS (SSE côté application) : le dump n'est JAMAIS poussé en
 * clair vers le stockage objet. La clé (`BACKUP_ENCRYPTION_KEY`) ne transite
 * jamais vers le stockage → un attaquant du bucket ne peut rien déchiffrer.
 *
 * **Custody des clés = risque documenté** : un backup chiffré dont la clé est
 * perdue est irrécupérable (cf. RUNBOOK §Custody).
 *
 * Le checksum SHA-256 est calculé sur l'enveloppe CHIFFRÉE (ce qui est stocké),
 * garantissant l'intégrité bit-à-bit de l'objet au repos et au transit.
 *
 * @module
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { SigfaError } from "src/lib/errors.js";

/** Octet de version de l'enveloppe (rotation future du format). */
const ENVELOPE_VERSION = 1;
/** Algorithme AES-256 en mode GCM (authentifié). */
const ALGORITHM = "aes-256-gcm";
/** Taille de l'IV en octets (recommandation NIST pour GCM). */
const IV_LENGTH = 12;
/** Taille de la clé en octets (AES-256). */
const KEY_LENGTH = 32;
/** Taille du tag d'authentification GCM en octets. */
const AUTH_TAG_LENGTH = 16;
/** Décalage du ciphertext dans l'enveloppe. */
const HEADER_LENGTH = 1 + IV_LENGTH + AUTH_TAG_LENGTH;

/**
 * Charge la clé de chiffrement des backups (32 octets, hex 64 caractères).
 *
 * @param env - Table des variables d'environnement (défaut `process.env`)
 * @returns Buffer de 32 octets
 * @throws {SigfaError} 500 si absente, non-hex ou de mauvaise taille
 */
export function loadBackupKey(env: NodeJS.ProcessEnv = process.env): Buffer {
  const raw = env["BACKUP_ENCRYPTION_KEY"];
  if (!raw || !/^[0-9a-fA-F]{64}$/.test(raw)) {
    throw new SigfaError(
      "INTERNAL_SERVER_ERROR",
      "BACKUP_ENCRYPTION_KEY absente ou invalide (64 caractères hex requis).",
      500
    );
  }
  return Buffer.from(raw, "hex");
}

/**
 * Checksum d'intégrité SHA-256 (hex) d'un buffer.
 *
 * @param data - Contenu binaire
 * @returns Empreinte hexadécimale (64 caractères)
 */
export function checksum(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

/**
 * Chiffre un dump en enveloppe AES-256-GCM (IV aléatoire par appel).
 *
 * @param plain - Contenu binaire du dump en clair
 * @param key   - Clé AES-256 (32 octets)
 * @returns Enveloppe binaire `[version][iv][tag][ciphertext]`
 * @throws {SigfaError} 500 si la clé n'a pas 32 octets
 */
export function encryptBackup(plain: Buffer, key: Buffer): Buffer {
  if (key.byteLength !== KEY_LENGTH) {
    throw new SigfaError("INTERNAL_SERVER_ERROR", "Clé de backup de taille invalide.", 500);
  }
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from([ENVELOPE_VERSION]), iv, tag, ct]);
}

/**
 * Déchiffre une enveloppe produite par `encryptBackup` (vérifie le tag GCM).
 *
 * @param envelope - Enveloppe binaire chiffrée
 * @param key      - Clé AES-256 (32 octets)
 * @returns Dump en clair
 * @throws {SigfaError} 500 si version/format/intégrité invalide
 */
export function decryptBackup(envelope: Buffer, key: Buffer): Buffer {
  if (envelope.byteLength < HEADER_LENGTH || envelope[0] !== ENVELOPE_VERSION) {
    throw new SigfaError("INTERNAL_SERVER_ERROR", "Enveloppe de backup invalide.", 500);
  }
  const iv = envelope.subarray(1, 1 + IV_LENGTH);
  const tag = envelope.subarray(1 + IV_LENGTH, HEADER_LENGTH);
  const ct = envelope.subarray(HEADER_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}

/** Taille attendue d'une clé de backup (octets) — exportée pour les tests. */
export const BACKUP_KEY_BYTES = KEY_LENGTH;
