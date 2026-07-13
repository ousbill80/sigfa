/**
 * Tests unitaires — MockBackupStorage (SEC-003).
 * Nommage strict : `SEC-003: <description>`.
 *
 * @module
 */

import { describe, it, expect } from "vitest";
import { MockBackupStorage } from "src/pra/mock-backup-storage.js";
import { BackupObjectNotFoundError } from "src/pra/backup-storage.js";

describe("MockBackupStorage", () => {
  it("SEC-003: put puis get restitue le contenu à l'identique", async () => {
    const s = new MockBackupStorage();
    const body = Buffer.from("dump-1");
    const meta = await s.put("backups/hourly/a", body, "sum-a");
    expect(meta.size).toBe(body.byteLength);
    expect((await s.get("backups/hourly/a")).equals(body)).toBe(true);
  });

  it("SEC-003: get d'une clé absente rejette BackupObjectNotFoundError", async () => {
    const s = new MockBackupStorage();
    await expect(s.get("nope")).rejects.toBeInstanceOf(BackupObjectNotFoundError);
  });

  it("SEC-003: head retourne null pour une clé absente (jamais d'exception)", async () => {
    const s = new MockBackupStorage();
    expect(await s.head("nope")).toBeNull();
  });

  it("SEC-003: le stockage est immuable (mutation externe du Buffer sans effet)", async () => {
    const s = new MockBackupStorage();
    const body = Buffer.from("orig");
    await s.put("k", body, "c");
    body[0] = 0xff; // mutation après put
    expect((await s.get("k")).toString()).toBe("orig");
  });

  it("SEC-003: list filtre par préfixe et trie par createdAt croissant", async () => {
    let t = 1_000;
    const s = new MockBackupStorage(() => new Date(t));
    t = 3_000;
    await s.put("backups/hourly/c", Buffer.from("c"), "c");
    t = 1_000;
    await s.put("backups/hourly/a", Buffer.from("a"), "a");
    t = 2_000;
    await s.put("backups/daily/b", Buffer.from("b"), "b");
    const hourly = await s.list("backups/hourly/");
    expect(hourly.map((m) => m.key)).toEqual([
      "backups/hourly/a",
      "backups/hourly/c",
    ]);
  });

  it("SEC-003: delete est idempotent (no-op sur clé absente)", async () => {
    const s = new MockBackupStorage();
    await s.put("k", Buffer.from("x"), "c");
    await s.delete("k");
    await s.delete("k"); // second delete = no-op
    expect(await s.head("k")).toBeNull();
    expect(s.size).toBe(0);
  });

  it("SEC-003: put réécrit une clé existante (remplacement)", async () => {
    const s = new MockBackupStorage();
    await s.put("k", Buffer.from("v1"), "c1");
    await s.put("k", Buffer.from("v2-plus-long"), "c2");
    expect((await s.get("k")).toString()).toBe("v2-plus-long");
    expect(s.size).toBe(1);
  });
});
