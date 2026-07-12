/**
 * KIOSK-006 — Tests de la base Dexie offline (in-memory via fake-indexeddb).
 * Écrits AVANT l'implémentation (phase rouge).
 */
import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach } from "vitest";
import {
  OfflineTicketDatabase,
  formatLocalNumber,
  nextLocalSequence,
  TICKET_COUNTER_ID,
  LOCAL_NUMBER_PREFIX,
} from "@/lib/offline-db";

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe("KIOSK-006: offline-db Dexie", () => {
  let db: OfflineTicketDatabase;

  beforeEach(async () => {
    db = new OfflineTicketDatabase(`test-${crypto.randomUUID()}`);
    await db.open();
  });

  it("KIOSK-006: ticket offline créé dans Dexie avec localUuid unique (test Dexie in-memory)", async () => {
    const localUuid = crypto.randomUUID();
    await db.tickets.put({
      localUuid,
      serviceId: "svc-1",
      agencyId: "agt-1",
      channel: "KIOSK",
      localSequence: 1,
      displayNumber: formatLocalNumber(1),
      createdOfflineAt: new Date().toISOString(),
    });
    const stored = await db.tickets.get(localUuid);
    expect(stored).toBeDefined();
    expect(stored?.localUuid).toMatch(UUID_V4);
    // localUuid est la clé primaire → un put du même uuid ne double jamais.
    await db.tickets.put({
      localUuid,
      serviceId: "svc-1",
      agencyId: "agt-1",
      channel: "KIOSK",
      localSequence: 1,
      displayNumber: formatLocalNumber(1),
      createdOfflineAt: new Date().toISOString(),
    });
    expect(await db.tickets.count()).toBe(1);
  });

  it("KIOSK-006: numérotation locale séquentielle monotone (jamais de doublon)", async () => {
    const seqs: number[] = [];
    for (let i = 0; i < 5; i++) {
      seqs.push(await nextLocalSequence(db));
    }
    expect(seqs).toEqual([1, 2, 3, 4, 5]);
    const counter = await db.counters.get(TICKET_COUNTER_ID);
    expect(counter?.value).toBe(5);
    // Numéros affichés sans collision.
    const displays = seqs.map(formatLocalNumber);
    expect(new Set(displays).size).toBe(5);
    expect(displays[0]).toBe(`${LOCAL_NUMBER_PREFIX}001`);
  });

  it("KIOSK-006: formatLocalNumber → préfixe H + 3 chiffres", () => {
    expect(formatLocalNumber(7)).toBe("H007");
    expect(formatLocalNumber(123)).toBe("H123");
  });
});
