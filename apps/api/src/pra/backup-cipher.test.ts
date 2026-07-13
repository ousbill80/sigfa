/**
 * Tests unitaires — backup-cipher (SEC-003).
 * Nommage strict : `SEC-003: <description>`.
 *
 * @module
 */

import { describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import {
  BACKUP_KEY_BYTES,
  checksum,
  decryptBackup,
  encryptBackup,
  loadBackupKey,
} from "src/pra/backup-cipher.js";

const KEY = randomBytes(BACKUP_KEY_BYTES);

describe("backup-cipher", () => {
  it("SEC-003: chiffre puis déchiffre un dump à l'identique (round-trip)", () => {
    const plain = Buffer.from("PGDMP fake dump — données sensibles", "utf8");
    const envelope = encryptBackup(plain, KEY);
    expect(decryptBackup(envelope, KEY).equals(plain)).toBe(true);
  });

  it("SEC-003: l'enveloppe chiffrée ne contient jamais le clair (SSE au repos)", () => {
    const secret = "SECRET_APP_TOKEN_EN_CLAIR";
    const plain = Buffer.from(`x${secret}y`, "utf8");
    const envelope = encryptBackup(plain, KEY);
    expect(envelope.includes(Buffer.from(secret, "utf8"))).toBe(false);
  });

  it("SEC-003: deux chiffrements du même dump diffèrent (IV aléatoire)", () => {
    const plain = Buffer.from("idempotent-plain", "utf8");
    expect(encryptBackup(plain, KEY).equals(encryptBackup(plain, KEY))).toBe(false);
  });

  it("SEC-003: déchiffrement avec une mauvaise clé échoue (tag GCM)", () => {
    const envelope = encryptBackup(Buffer.from("data"), KEY);
    expect(() => decryptBackup(envelope, randomBytes(BACKUP_KEY_BYTES))).toThrow();
  });

  it("SEC-003: enveloppe altérée (1 bit) fait échouer le déchiffrement (intégrité)", () => {
    const envelope = encryptBackup(Buffer.from("intègre"), KEY);
    const tampered = Buffer.from(envelope);
    const last = tampered.length - 1;
    tampered[last] = (tampered[last] ?? 0) ^ 0x01;
    expect(() => decryptBackup(tampered, KEY)).toThrow();
  });

  it("SEC-003: enveloppe de version inconnue est rejetée", () => {
    const envelope = encryptBackup(Buffer.from("v"), KEY);
    const bad = Buffer.from(envelope);
    bad[0] = 0x09;
    expect(() => decryptBackup(bad, KEY)).toThrow(/Enveloppe de backup invalide/);
  });

  it("SEC-003: enveloppe trop courte est rejetée", () => {
    expect(() => decryptBackup(Buffer.from([1, 2, 3]), KEY)).toThrow();
  });

  it("SEC-003: chiffrer avec une clé de mauvaise taille est rejeté", () => {
    expect(() => encryptBackup(Buffer.from("x"), randomBytes(16))).toThrow(
      /taille invalide/
    );
  });

  it("SEC-003: checksum SHA-256 est déterministe et sensible au contenu", () => {
    const a = Buffer.from("game-day");
    expect(checksum(a)).toBe(checksum(Buffer.from("game-day")));
    expect(checksum(a)).not.toBe(checksum(Buffer.from("game-dax")));
    expect(checksum(a)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("SEC-003: loadBackupKey lit une clé hex de 64 caractères", () => {
    const hex = "ab".repeat(32);
    const key = loadBackupKey({ BACKUP_ENCRYPTION_KEY: hex } as NodeJS.ProcessEnv);
    expect(key.byteLength).toBe(BACKUP_KEY_BYTES);
  });

  it("SEC-003: loadBackupKey rejette une clé absente ou mal formée", () => {
    expect(() => loadBackupKey({} as NodeJS.ProcessEnv)).toThrow(
      /BACKUP_ENCRYPTION_KEY/
    );
    expect(() =>
      loadBackupKey({ BACKUP_ENCRYPTION_KEY: "zz" } as NodeJS.ProcessEnv)
    ).toThrow();
  });
});
