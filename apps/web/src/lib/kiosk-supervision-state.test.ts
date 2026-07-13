/**
 * Tests for kiosk-supervision-state (ADM-003b) — token mapping (SILENT=danger),
 * severity ordering, reducer with contract-validated realtime events, per-agency
 * roll-up, and injected-clock relative time.
 * @module lib/kiosk-supervision-state.test
 */
import { describe, it, expect } from "vitest";
import {
  statusToken,
  statusSeverity,
  kioskSupervisionReducer,
  initialKioskSupervisionState,
  orderBySeverity,
  countStatuses,
  activeAlertCount,
  rollupByAgency,
  relativeLastSeen,
  type SupervisedKiosk,
  type KioskStatus,
} from "./kiosk-supervision-state";

const A1 = "33333333-3333-4333-a333-333333333333";
const A2 = "44444444-4444-4444-a444-444444444444";
const K1 = "14141414-1414-4141-a141-141414141414";
const K2 = "15151515-1515-4151-a151-151515151515";
const K3 = "16161616-1616-4161-a161-161616161616";

function kiosk(over: Partial<SupervisedKiosk> = {}): SupervisedKiosk {
  return {
    kioskId: K1,
    agencyId: A1,
    status: "ONLINE",
    lastSeen: "2026-07-12T09:59:30Z",
    ...over,
  };
}

describe("ADM-003b: mapping statut → token Design System v2", () => {
  it("ADM-003b: SILENT → var(--danger) (jamais fond rouge plein — pastille)", () => {
    expect(statusToken("SILENT")).toBe("var(--danger)");
  });

  it("ADM-003b: ONLINE=success, DEGRADED=warning, NEVER_SEEN=neutre (jamais danger)", () => {
    expect(statusToken("ONLINE")).toBe("var(--success)");
    expect(statusToken("DEGRADED")).toBe("var(--warning)");
    expect(statusToken("NEVER_SEEN")).not.toBe("var(--danger)");
  });

  it("ADM-003b: --danger réservé au seul SILENT (aucun autre état)", () => {
    const others: KioskStatus[] = ["ONLINE", "DEGRADED", "NEVER_SEEN"];
    for (const s of others) expect(statusToken(s)).not.toBe("var(--danger)");
  });
});

describe("ADM-003b: sévérité + ordonnancement (muette en tête)", () => {
  it("ADM-003b: SILENT est la sévérité la plus haute", () => {
    expect(statusSeverity("SILENT")).toBeGreaterThan(statusSeverity("DEGRADED"));
    expect(statusSeverity("DEGRADED")).toBeGreaterThan(statusSeverity("NEVER_SEEN"));
    expect(statusSeverity("NEVER_SEEN")).toBeGreaterThan(statusSeverity("ONLINE"));
  });

  it("ADM-003b: orderBySeverity remonte les bornes muettes en tête", () => {
    const ordered = orderBySeverity([
      kiosk({ kioskId: K1, status: "ONLINE" }),
      kiosk({ kioskId: K2, status: "SILENT", lastSeen: "2026-07-12T09:40:00Z" }),
      kiosk({ kioskId: K3, status: "DEGRADED" }),
    ]);
    expect(ordered[0]!.kioskId).toBe(K2);
    expect(ordered[0]!.status).toBe("SILENT");
  });

  it("ADM-003b: orderBySeverity ne mute pas l'entrée (pur)", () => {
    const input = [kiosk({ kioskId: K1, status: "ONLINE" })];
    const before = JSON.stringify(input);
    orderBySeverity(input);
    expect(JSON.stringify(input)).toBe(before);
  });
});

describe("ADM-003b: reducer temps réel (payloads validés au contrat)", () => {
  it("ADM-003b: kiosk:silent → borne passe SILENT + lastSeen = since", () => {
    const seeded = kioskSupervisionReducer(initialKioskSupervisionState, {
      type: "seed",
      kiosks: [kiosk({ kioskId: K1, status: "ONLINE" })],
    });
    const next = kioskSupervisionReducer(seeded, {
      type: "kiosk:silent",
      payload: { kioskId: K1, agencyId: A1, status: "SILENT", since: "2026-07-12T09:40:00Z" },
    });
    expect(next.kiosks[0]!.status).toBe("SILENT");
    expect(next.kiosks[0]!.lastSeen).toBe("2026-07-12T09:40:00Z");
  });

  it("ADM-003b: kiosk:recovered → retour ONLINE", () => {
    const seeded = kioskSupervisionReducer(initialKioskSupervisionState, {
      type: "seed",
      kiosks: [kiosk({ kioskId: K1, status: "SILENT" })],
    });
    const next = kioskSupervisionReducer(seeded, {
      type: "kiosk:recovered",
      payload: { kioskId: K1, agencyId: A1, status: "ONLINE", since: "2026-07-12T10:00:00Z" },
    });
    expect(next.kiosks[0]!.status).toBe("ONLINE");
  });

  it("ADM-003b: kiosk:status upsert une borne inconnue (agrégat unitaire)", () => {
    const next = kioskSupervisionReducer(initialKioskSupervisionState, {
      type: "kiosk:status",
      payload: { kioskId: K2, agencyId: A1, status: "DEGRADED", since: "2026-07-12T10:00:00Z" },
    });
    expect(next.kiosks).toHaveLength(1);
    expect(next.kiosks[0]!.status).toBe("DEGRADED");
  });

  it("ADM-003b: payload invalide (uuid non conforme) → état inchangé", () => {
    const seeded = kioskSupervisionReducer(initialKioskSupervisionState, {
      type: "seed",
      kiosks: [kiosk({ kioskId: K1, status: "ONLINE" })],
    });
    const next = kioskSupervisionReducer(seeded, {
      type: "kiosk:silent",
      payload: { kioskId: "not-a-uuid", agencyId: "nope", status: "SILENT", since: "x" },
    });
    expect(next).toBe(seeded);
  });

  it("ADM-003b: action connection bascule offline/connected", () => {
    const next = kioskSupervisionReducer(initialKioskSupervisionState, {
      type: "connection",
      status: "offline",
    });
    expect(next.connection).toBe("offline");
  });

  it("ADM-003b: action inconnue → état inchangé (default)", () => {
    // @ts-expect-error — action volontairement hors union pour couvrir le default
    const next = kioskSupervisionReducer(initialKioskSupervisionState, { type: "noop" });
    expect(next).toBe(initialKioskSupervisionState);
  });
});

describe("ADM-003b: agrégats (compteurs + roll-up réseau)", () => {
  it("ADM-003b: countStatuses agrège online/degraded/silent/neverSeen", () => {
    const counts = countStatuses([
      kiosk({ kioskId: "a", status: "ONLINE" }),
      kiosk({ kioskId: "b", status: "SILENT" }),
      kiosk({ kioskId: "c", status: "DEGRADED" }),
      kiosk({ kioskId: "d", status: "NEVER_SEEN", lastSeen: null }),
    ]);
    expect(counts).toEqual({ online: 1, degraded: 1, silent: 1, neverSeen: 1 });
  });

  it("ADM-003b: activeAlertCount = nombre de bornes muettes", () => {
    expect(
      activeAlertCount([
        kiosk({ kioskId: "a", status: "SILENT" }),
        kiosk({ kioskId: "b", status: "ONLINE" }),
        kiosk({ kioskId: "c", status: "SILENT" }),
      ]),
    ).toBe(2);
  });

  it("ADM-003b: rollupByAgency trie les agences avec bornes muettes en tête", () => {
    const rows = rollupByAgency([
      kiosk({ kioskId: "a", agencyId: A1, status: "ONLINE" }),
      kiosk({ kioskId: "b", agencyId: A2, status: "SILENT" }),
      kiosk({ kioskId: "c", agencyId: A1, status: "ONLINE" }),
    ]);
    expect(rows[0]!.agencyId).toBe(A2);
    expect(rows[0]!.counts.silent).toBe(1);
    expect(rows[1]!.agencyId).toBe(A1);
  });
});

describe("ADM-003b: temps relatif (horloge injectée, déterministe)", () => {
  const base = Date.parse("2026-07-12T10:00:00Z");

  it("ADM-003b: NEVER_SEEN (lastSeen null) → null", () => {
    expect(relativeLastSeen(null, base, "fr")).toBeNull();
  });

  it("ADM-003b: secondes — « il y a 12 s » / « 12s ago »", () => {
    const twelve = new Date(base - 12_000).toISOString();
    expect(relativeLastSeen(twelve, base, "fr")).toBe("il y a 12 s");
    expect(relativeLastSeen(twelve, base, "en")).toBe("12s ago");
  });

  it("ADM-003b: minutes / heures / jours", () => {
    expect(relativeLastSeen(new Date(base - 5 * 60_000).toISOString(), base, "fr")).toBe("il y a 5 min");
    expect(relativeLastSeen(new Date(base - 3 * 3_600_000).toISOString(), base, "en")).toBe("3h ago");
    expect(relativeLastSeen(new Date(base - 2 * 86_400_000).toISOString(), base, "fr")).toBe("il y a 2 j");
  });

  it("ADM-003b: timestamp invalide → null", () => {
    expect(relativeLastSeen("not-a-date", base, "fr")).toBeNull();
  });
});
