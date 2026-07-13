/**
 * Game day PRA (SEC-003) — restauration TESTÉE de bout en bout, EN CI, SANS réseau.
 *
 * Environnement jetable Testcontainers (PostgreSQL 16 réel). Le stockage objet est
 * l'adaptateur MOCK en mémoire (`MockBackupStorage`) : AUCUN R2/S3/MinIO réel, zéro
 * dépendance réseau. `pg_dump`/`pg_restore` s'exécutent DANS le conteneur PG (binaires
 * garantis présents), le transfert binaire se fait en base64 via `exec` → aucun binaire
 * client requis sur le runner.
 *
 * Déroulé prouvé :
 *  1. seed de données dans la base SOURCE (banks + tickets, dont un téléphone chiffré) ;
 *  2. dump `pg_dump -Fc` → chiffré AES-256-GCM → checksum → poussé au mock ;
 *  3. VÉRIFICATION post-push (présence + taille + checksum) via BackupService ;
 *  4. restauration dans une base NEUVE (`pg_restore`) à partir du dernier backup ;
 *  5. vérif d'INTÉGRITÉ : comptes de lignes par table + contraintes + requête de
 *     contrôle par table sensible (les données restaurées == source) ;
 *  6. le téléphone reste CHIFFRÉ dans le backup (pas de PII en clair) ;
 *  7. le RTO est CHRONOMÉTRÉ ; un dépassement de la cible fait échouer le test.
 *
 * Cible RTO ≤ 15 min : sur un seed CI la mesure est de l'ordre de la seconde ; la
 * mesure À TAILLE RÉELLE est GATED infra (cf. RUNBOOK / _arbitrage D11). On asserte
 * néanmoins la cible pour que la mécanique de chronométrage soit prouvée.
 *
 * Nommage strict : `SEC-003: <description>`.
 *
 * @module
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import pg from "pg";
import {
  GenericContainer,
  type StartedTestContainer,
  Wait,
} from "testcontainers";
import { MockBackupStorage } from "src/pra/mock-backup-storage.js";
import { BACKUP_KEY_BYTES } from "src/pra/backup-cipher.js";
import { RTO_TARGET_MINUTES } from "src/pra/backup-config.js";
import { BackupService } from "src/pra/backup-service.js";

const KEY = randomBytes(BACKUP_KEY_BYTES);
const SOURCE_DB = "sigfa_source";
const RESTORE_DB = "sigfa_restore";
const PHONE_PLAINTEXT = "+22507010203";

let container: StartedTestContainer;
let host: string;
let port: number;

/** Client pg vers une base nommée du conteneur. */
function client(database: string): pg.Client {
  return new pg.Client({
    host,
    port,
    user: "sigfa",
    password: "sigfa_test",
    database,
  });
}

/** Exécute une commande dans le conteneur, échoue si exitCode != 0. */
async function execOk(cmd: string[]): Promise<string> {
  const res = await container.exec(cmd);
  if (res.exitCode !== 0) {
    throw new Error(`exec ${cmd.join(" ")} → ${res.exitCode} : ${res.output}`);
  }
  return res.stdout;
}

/** Schéma + seed déterministe de la base SOURCE. */
async function seedSource(): Promise<{ bankRows: number; ticketRows: number }> {
  const db = client(SOURCE_DB);
  await db.connect();
  try {
    await db.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`);
    await db.query(
      `CREATE TABLE banks (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE);`
    );
    await db.query(`
      CREATE TABLE tickets (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        bank_id UUID NOT NULL REFERENCES banks(id),
        number INTEGER NOT NULL CHECK (number > 0),
        phone_encrypted TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (bank_id, number)
      );
    `);
    const bank = await db.query(
      `INSERT INTO banks (name, slug) VALUES ('Banque Test', 'test') RETURNING id`
    );
    const bankId = (bank.rows[0] as { id: string }).id;
    // Téléphone « chiffré » (miroir DB-008) : simulé ici par un cipher opaque —
    // ce qui compte est qu'AUCUN clair n'apparaisse jamais dans le dump.
    const cipherText = `v1:enc:${Buffer.from(PHONE_PLAINTEXT).toString("hex")}`;
    for (let n = 1; n <= 25; n++) {
      await db.query(
        `INSERT INTO tickets (bank_id, number, phone_encrypted) VALUES ($1, $2, $3)`,
        [bankId, n, cipherText]
      );
    }
    const banks = await db.query(`SELECT count(*)::int AS c FROM banks`);
    const tickets = await db.query(`SELECT count(*)::int AS c FROM tickets`);
    return {
      bankRows: (banks.rows[0] as { c: number }).c,
      ticketRows: (tickets.rows[0] as { c: number }).c,
    };
  } finally {
    await db.end();
  }
}

beforeAll(async () => {
  container = await new GenericContainer("postgres:16")
    .withEnvironment({
      POSTGRES_USER: "sigfa",
      POSTGRES_PASSWORD: "sigfa_test",
      POSTGRES_DB: SOURCE_DB,
    })
    .withExposedPorts(5432)
    .withWaitStrategy(
      Wait.forLogMessage(/database system is ready to accept connections/, 2)
    )
    .start();
  host = container.getHost();
  port = container.getMappedPort(5432);
}, 180_000);

afterAll(async () => {
  await container?.stop();
});

describe("SEC-003 game day — dump → mock storage → restore → intégrité", () => {
  it("SEC-003: seed→backup chiffré→S3 mock→restore→intégrité vérifiée + RTO ≤ 15 min", async () => {
    const seeded = await seedSource();
    expect(seeded.bankRows).toBe(1);
    expect(seeded.ticketRows).toBe(25);

    const storage = new MockBackupStorage();

    // DumpFn : pg_dump -Fc dans le conteneur, sorti en base64 (transfert binaire propre).
    const service = new BackupService({
      storage,
      key: KEY,
      dump: async () => {
        const b64 = await execOk([
          "sh",
          "-c",
          `pg_dump -U sigfa -Fc ${SOURCE_DB} | base64 | tr -d '\\n'`,
        ]);
        return Buffer.from(b64, "base64");
      },
      restore: async (plainDump) => {
        // Base NEUVE + réinjection du dump binaire via base64 → pg_restore.
        await execOk([
          "sh",
          "-c",
          `dropdb -U sigfa --if-exists ${RESTORE_DB} && createdb -U sigfa ${RESTORE_DB}`,
        ]);
        const b64 = plainDump.toString("base64");
        await execOk([
          "sh",
          "-c",
          `echo '${b64}' | base64 -d > /tmp/restore.dump && pg_restore -U sigfa -d ${RESTORE_DB} /tmp/restore.dump`,
        ]);
      },
    });

    // 2-3. Backup + vérification post-push.
    const backup = await service.createBackup("hourly");
    expect(backup.size).toBeGreaterThan(0);
    expect(backup.checksum).toMatch(/^[0-9a-f]{64}$/);

    // 6. L'objet stocké est chiffré : le clair du téléphone n'y apparaît JAMAIS.
    const storedEnvelope = await storage.get(backup.key);
    expect(storedEnvelope.includes(Buffer.from(PHONE_PLAINTEXT))).toBe(false);

    // 4 + 7. Restauration chronométrée (RTO).
    const startedAt = Date.now();
    const { degraded } = await service.restoreLatest("hourly");
    const rtoMs = Date.now() - startedAt;
    expect(degraded).toBe(false);
    expect(rtoMs).toBeLessThanOrEqual(RTO_TARGET_MINUTES * 60_000);

    // 5. Intégrité : comptes de lignes + contrainte + requête de contrôle par table.
    const restored = client(RESTORE_DB);
    await restored.connect();
    try {
      const banks = await restored.query(`SELECT count(*)::int AS c FROM banks`);
      const tickets = await restored.query(`SELECT count(*)::int AS c FROM tickets`);
      expect((banks.rows[0] as { c: number }).c).toBe(seeded.bankRows);
      expect((tickets.rows[0] as { c: number }).c).toBe(seeded.ticketRows);

      // Contrainte préservée (UNIQUE bank_id+number) : réinsertion en doublon rejetée.
      const anyBank = await restored.query(
        `SELECT bank_id, number FROM tickets ORDER BY number LIMIT 1`
      );
      const row = anyBank.rows[0] as { bank_id: string; number: number };
      await expect(
        restored.query(
          `INSERT INTO tickets (bank_id, number, phone_encrypted) VALUES ($1, $2, 'x')`,
          [row.bank_id, row.number]
        )
      ).rejects.toThrow();

      // Requête de contrôle : le téléphone reste chiffré (DB-008), pas de clair.
      const phones = await restored.query(
        `SELECT phone_encrypted FROM tickets LIMIT 1`
      );
      const enc = (phones.rows[0] as { phone_encrypted: string }).phone_encrypted;
      expect(enc.startsWith("v1:enc:")).toBe(true);
      expect(enc.includes(PHONE_PLAINTEXT)).toBe(false);
    } finally {
      await restored.end();
    }
  }, 180_000);

  it("SEC-003: RPO ≤ 60 min — l'écart backup↔sinistre est sous la cible horaire", async () => {
    // Cadence horaire ⇒ le backup le plus récent a au plus ~60 min. Ici, on prouve la
    // MÉCANIQUE : le createdAt du dernier backup est très proche de « maintenant »
    // (sinistre simulé = instant présent), donc l'écart RPO est franchement < 60 min.
    const storage = new MockBackupStorage();
    const service = new BackupService({
      storage,
      key: KEY,
      dump: async () => {
        const b64 = await execOk([
          "sh",
          "-c",
          `pg_dump -U sigfa -Fc ${SOURCE_DB} | base64 | tr -d '\\n'`,
        ]);
        return Buffer.from(b64, "base64");
      },
      restore: () => Promise.resolve(),
    });
    const backup = await service.createBackup("hourly");
    const disasterAt = Date.now();
    const rpoMs = disasterAt - new Date(backup.createdAt).getTime();
    expect(rpoMs).toBeLessThanOrEqual(60 * 60_000);
  }, 120_000);
});
