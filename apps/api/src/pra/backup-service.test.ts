/**
 * Tests unitaires — BackupService (SEC-003) sur stockage MOCK (aucun réseau).
 * Nommage strict : `SEC-003: <description>`.
 *
 * @module
 */

import { describe, it, expect, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { MockBackupStorage } from "src/pra/mock-backup-storage.js";
import {
  type BackupObjectMeta,
  type BackupStorage,
} from "src/pra/backup-storage.js";
import { BACKUP_KEY_BYTES, decryptBackup } from "src/pra/backup-cipher.js";
import {
  BackupPushError,
  BackupService,
  NoValidBackupError,
  type AlertFn,
} from "src/pra/backup-service.js";

const KEY = randomBytes(BACKUP_KEY_BYTES);

/** Fabrique un service câblé sur un mock, avec dump/restore fakes. */
function makeService(opts: {
  storage?: BackupStorage;
  dumpSequence?: Buffer[];
  clock?: () => Date;
  alert?: AlertFn;
}) {
  const storage = opts.storage ?? new MockBackupStorage(opts.clock);
  const dumps = opts.dumpSequence ?? [Buffer.from("DUMP-DATA")];
  let i = 0;
  const restored: Buffer[] = [];
  const service = new BackupService({
    storage,
    key: KEY,
    clock: opts.clock,
    alert: opts.alert,
    dump: () => Promise.resolve(dumps[Math.min(i++, dumps.length - 1)] as Buffer),
    restore: (plain) => {
      restored.push(plain);
      return Promise.resolve();
    },
  });
  return { service, storage, restored };
}

describe("BackupService.createBackup", () => {
  it("SEC-003: produit un backup chiffré + checksum, poussé et VÉRIFIÉ", async () => {
    const { service, storage } = makeService({
      dumpSequence: [Buffer.from("SECRET-DUMP")],
    });
    const res = await service.createBackup("hourly");
    expect(res.key).toMatch(/^backups\/hourly\/sigfa-.*\.dump\.enc$/);
    expect(res.size).toBeGreaterThan(0);
    expect(res.checksum).toMatch(/^[0-9a-f]{64}$/);
    // L'objet stocké est bien chiffré (ne contient pas le clair).
    const stored = await storage.get(res.key);
    expect(stored.includes(Buffer.from("SECRET-DUMP"))).toBe(false);
    // Et il redéchiffre vers le dump d'origine.
    expect(decryptBackup(stored, KEY).toString()).toBe("SECRET-DUMP");
  });

  it("SEC-003: échec de poussée (storage rejette) → alerte émise + BackupPushError", async () => {
    const alert = vi.fn();
    const failing: BackupStorage = {
      put: () => Promise.reject(new Error("R2 injoignable")),
      get: () => Promise.reject(new Error("n/a")),
      head: () => Promise.resolve(null),
      list: () => Promise.resolve([]),
      delete: () => Promise.resolve(),
    };
    const { service } = makeService({ storage: failing, alert });
    await expect(service.createBackup()).rejects.toBeInstanceOf(BackupPushError);
    expect(alert).toHaveBeenCalledOnce();
    expect(alert.mock.calls[0]?.[1]).toMatchObject({ reason: expect.stringContaining("R2 injoignable") });
  });

  it("SEC-003: objet absent après put (silence) → alerte + échec visible", async () => {
    const alert = vi.fn();
    const silent: BackupStorage = {
      put: (key, body, sum) =>
        Promise.resolve<BackupObjectMeta>({ key, size: body.byteLength, checksum: sum, createdAt: new Date().toISOString() }),
      get: () => Promise.reject(new Error("n/a")),
      head: () => Promise.resolve(null), // HEAD ne voit rien : poussée non confirmée
      list: () => Promise.resolve([]),
      delete: () => Promise.resolve(),
    };
    const { service } = makeService({ storage: silent, alert });
    await expect(service.createBackup()).rejects.toThrow(/objet absent/);
    expect(alert).toHaveBeenCalledOnce();
  });

  it("SEC-003: taille nulle au HEAD → alerte + échec (objet vide)", async () => {
    const alert = vi.fn();
    const empty: BackupStorage = {
      put: (key, _body, sum) =>
        Promise.resolve<BackupObjectMeta>({ key, size: 0, checksum: sum, createdAt: new Date().toISOString() }),
      get: () => Promise.reject(new Error("n/a")),
      head: (key) =>
        Promise.resolve<BackupObjectMeta>({ key, size: 0, checksum: "x", createdAt: new Date().toISOString() }),
      list: () => Promise.resolve([]),
      delete: () => Promise.resolve(),
    };
    const { service } = makeService({ storage: empty, alert });
    await expect(service.createBackup()).rejects.toThrow(/taille nulle/);
    expect(alert).toHaveBeenCalledOnce();
  });

  it("SEC-003: checksum divergent au HEAD → alerte + échec (anti-corruption transit)", async () => {
    const alert = vi.fn();
    const corrupting: BackupStorage = {
      put: (key, body) =>
        Promise.resolve<BackupObjectMeta>({ key, size: body.byteLength, checksum: "DIFFERENT", createdAt: new Date().toISOString() }),
      get: () => Promise.reject(new Error("n/a")),
      head: (key) => Promise.resolve<BackupObjectMeta>({ key, size: 10, checksum: "DIFFERENT", createdAt: new Date().toISOString() }),
      list: () => Promise.resolve([]),
      delete: () => Promise.resolve(),
    };
    const { service } = makeService({ storage: corrupting, alert });
    await expect(service.createBackup()).rejects.toThrow(/checksum divergent/);
    expect(alert).toHaveBeenCalledOnce();
  });
});

describe("BackupService.restoreLatest", () => {
  it("SEC-003: restaure le dump le PLUS RÉCENT (round-trip identique)", async () => {
    let t = 1_000;
    const { service, restored } = makeService({
      clock: () => new Date(t),
      dumpSequence: [Buffer.from("OLD"), Buffer.from("NEW")],
    });
    t = 1_000;
    await service.createBackup("hourly");
    t = 2_000;
    await service.createBackup("hourly");
    const { restored: meta, degraded } = await service.restoreLatest("hourly");
    expect(degraded).toBe(false);
    expect(restored.at(-1)?.toString()).toBe("NEW");
    expect(meta.key).toContain("hourly");
  });

  it("SEC-003: dernier backup corrompu → bascule avant-dernier (RPO dégradé)", async () => {
    let t = 1_000;
    const storage = new MockBackupStorage(() => new Date(t));
    const alert = vi.fn();
    const { service, restored } = makeService({
      storage,
      clock: () => new Date(t),
      dumpSequence: [Buffer.from("GOOD"), Buffer.from("WILL-CORRUPT")],
      alert,
    });
    t = 1_000;
    await service.createBackup("hourly");
    t = 2_000;
    const bad = await service.createBackup("hourly");
    // Corrompt l'objet le plus récent (checksum ne concordera plus).
    await storage.put(bad.key, Buffer.from("garbage-tampered"), bad.checksum);
    const { degraded } = await service.restoreLatest("hourly");
    expect(degraded).toBe(true);
    expect(restored.at(-1)?.toString()).toBe("GOOD");
    expect(alert).toHaveBeenCalled();
  });

  it("SEC-003: aucun backup restaurable → NoValidBackupError", async () => {
    const { service } = makeService({});
    await expect(service.restoreLatest("hourly")).rejects.toBeInstanceOf(
      NoValidBackupError
    );
  });
});

describe("BackupService.pruneExpired", () => {
  it("SEC-003: supprime les backups horaires au-delà de 48 h, garde les récents", async () => {
    let t = new Date("2026-07-13T00:00:00Z").getTime();
    const storage = new MockBackupStorage(() => new Date(t));
    const { service } = makeService({ storage, clock: () => new Date(t) });
    // Backup vieux de 50 h (à supprimer).
    t = new Date("2026-07-10T22:00:00Z").getTime();
    const old = await service.createBackup("hourly");
    // Backup vieux de 2 h (à garder).
    t = new Date("2026-07-12T22:00:00Z").getTime();
    const recent = await service.createBackup("hourly");
    // Prune « maintenant ».
    t = new Date("2026-07-13T00:00:00Z").getTime();
    const removed = await service.pruneExpired();
    expect(removed).toContain(old.key);
    expect(removed).not.toContain(recent.key);
    expect(await storage.head(recent.key)).not.toBeNull();
    expect(await storage.head(old.key)).toBeNull();
  });

  it("SEC-003: supprime les points quotidiens au-delà de 30 j", async () => {
    let t = new Date("2026-07-13T00:00:00Z").getTime();
    const storage = new MockBackupStorage(() => new Date(t));
    const { service } = makeService({ storage, clock: () => new Date(t) });
    t = new Date("2026-06-01T00:00:00Z").getTime(); // 42 j avant
    const old = await service.createBackup("daily");
    t = new Date("2026-07-13T00:00:00Z").getTime();
    const removed = await service.pruneExpired();
    expect(removed).toContain(old.key);
  });
});
