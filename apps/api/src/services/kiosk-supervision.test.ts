/**
 * Tests unitaires — supervision borne (ADM-003a).
 *
 * Couvre :
 *  - `deriveKioskStatus` : machine d'état ONLINE/DEGRADED/SILENT/NEVER_SEEN
 *    dérivée du délai depuis `lastSeen` (horloge injectée, table de cas) ;
 *  - `KioskSilenceTracker` : émission débouncée `kiosk:silent`/`kiosk:recovered`
 *    (une seule alerte par épisode, room STAFF, agrégation anti-tempête).
 *
 * Aucun accès DB : logique pure + bus de capture. Nommage strict `ADM-003a: …`.
 *
 * @module
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  deriveKioskStatus,
  KioskSilenceTracker,
  DEFAULT_SUPERVISION_CONFIG,
  type KioskSupervisionRow,
} from "src/services/kiosk-supervision.js";
import { createCaptureBus } from "src/services/realtime.js";

const AGENCY = "33333333-3333-4333-a333-333333333333";
const AGENCY_B = "44444444-4444-4444-a444-444444444444";
const KIOSK = "14141414-1414-4141-a141-141414141414";
const KIOSK_2 = "15151515-1515-4151-a151-151515151515";
const KIOSK_3 = "16161616-1616-4161-a161-161616161616";

/** Instant de référence des tests (horloge injectée). */
const NOW = new Date("2026-07-12T10:00:00.000Z");

/** Fabrique une ligne de supervision borne (valeurs par défaut saines). */
function row(over: Partial<KioskSupervisionRow> = {}): KioskSupervisionRow {
  return {
    kioskId: KIOSK,
    agencyId: AGENCY,
    lastSeen: new Date(NOW.getTime() - 10_000), // il y a 10 s → ONLINE
    printerOk: true,
    createdAt: new Date(NOW.getTime() - 3_600_000), // il y a 1 h
    ...over,
  };
}

/** Décale `NOW` de `deltaSeconds` (positif = passé). */
function secondsAgo(deltaSeconds: number): Date {
  return new Date(NOW.getTime() - deltaSeconds * 1000);
}

describe("ADM-003a: deriveKioskStatus — machine d'état (horloge injectée)", () => {
  it("ADM-003a: état ONLINE quand lastSeen < 2×H (dernier heartbeat récent)", () => {
    // 10 s < 60 s (2 × 30) → ONLINE.
    expect(deriveKioskStatus(row({ lastSeen: secondsAgo(10) }), NOW)).toBe("ONLINE");
  });

  it("ADM-003a: état DEGRADED quand lastSeen ∈ [2×H, seuil_muette) (retards intermittents)", () => {
    // 75 s ∈ [60, 90) → DEGRADED.
    expect(deriveKioskStatus(row({ lastSeen: secondsAgo(75) }), NOW)).toBe("DEGRADED");
  });

  it("ADM-003a: état DEGRADED quand heartbeat récent mais imprimante KO (anomalie signalée)", () => {
    // 10 s (ONLINE côté délai) mais printerOk=false → DEGRADED.
    expect(
      deriveKioskStatus(row({ lastSeen: secondsAgo(10), printerOk: false }), NOW)
    ).toBe("DEGRADED");
  });

  it("ADM-003a: état SILENT dès 3 heartbeats manqués (≥ seuil_muette = 90 s par défaut)", () => {
    // Exactement au seuil (90 s) → SILENT (≥).
    expect(deriveKioskStatus(row({ lastSeen: secondsAgo(90) }), NOW)).toBe("SILENT");
    // Bien au-delà → SILENT.
    expect(deriveKioskStatus(row({ lastSeen: secondsAgo(600) }), NOW)).toBe("SILENT");
  });

  it("ADM-003a: SILENT prime sur l'imprimante KO (une borne muette reste SILENT)", () => {
    expect(
      deriveKioskStatus(row({ lastSeen: secondsAgo(600), printerOk: false }), NOW)
    ).toBe("SILENT");
  });

  it("ADM-003a: état NEVER_SEEN quand lastSeen est null (borne provisionnée jamais vue)", () => {
    expect(deriveKioskStatus(row({ lastSeen: null }), NOW)).toBe("NEVER_SEEN");
  });

  it("ADM-003a: seuil_muette configurable par agence (surcharge du défaut 90 s)", () => {
    // Avec un seuil abaissé à 45 s, 60 s de silence → SILENT (alors que défaut = DEGRADED).
    const strict = { heartbeatIntervalSec: 15, silentThresholdSec: 45 };
    expect(deriveKioskStatus(row({ lastSeen: secondsAgo(60) }), NOW, strict)).toBe(
      "SILENT"
    );
    // Avec le défaut, 60 s → DEGRADED (démontre l'effet de la surcharge).
    expect(deriveKioskStatus(row({ lastSeen: secondsAgo(60) }), NOW)).toBe("DEGRADED");
  });

  it("ADM-003a: config par défaut = 30 s / 90 s (CONTRACT-013)", () => {
    expect(DEFAULT_SUPERVISION_CONFIG.heartbeatIntervalSec).toBe(30);
    expect(DEFAULT_SUPERVISION_CONFIG.silentThresholdSec).toBe(90);
  });
});

describe("ADM-003a: KioskSilenceTracker — alerte muette débouncée (room STAFF)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("ADM-003a: bascule vers SILENT → un seul kiosk:silent (payload PII-free)", () => {
    const bus = createCaptureBus();
    const tracker = new KioskSilenceTracker(bus);
    const silent = row({ lastSeen: secondsAgo(600) });

    tracker.reconcile([silent], NOW);

    const emitted = bus.ofType("kiosk:silent");
    expect(emitted).toHaveLength(1);
    expect(emitted[0]?.agencyId).toBe(AGENCY);
    expect(emitted[0]?.payload).toEqual({
      kioskId: KIOSK,
      agencyId: AGENCY,
      status: "SILENT",
      since: secondsAgo(600).toISOString(),
    });
  });

  it("ADM-003a: silence persistant → AUCUNE ré-émission (une alerte par épisode)", () => {
    const bus = createCaptureBus();
    const tracker = new KioskSilenceTracker(bus);
    const silent = row({ lastSeen: secondsAgo(600) });

    tracker.reconcile([silent], NOW);
    tracker.reconcile([silent], NOW); // toujours muette
    tracker.reconcile([silent], NOW); // toujours muette

    expect(bus.ofType("kiosk:silent")).toHaveLength(1);
    expect(bus.ofType("kiosk:recovered")).toHaveLength(0);
  });

  it("ADM-003a: heartbeat après silence → ONLINE + kiosk:recovered (une seule fois)", () => {
    const bus = createCaptureBus();
    const tracker = new KioskSilenceTracker(bus);

    tracker.reconcile([row({ lastSeen: secondsAgo(600) })], NOW); // SILENT
    // La borne réémet un heartbeat récent → ONLINE.
    tracker.reconcile([row({ lastSeen: secondsAgo(5) })], NOW);
    tracker.reconcile([row({ lastSeen: secondsAgo(5) })], NOW); // stable, pas de doublon

    const recovered = bus.ofType("kiosk:recovered");
    expect(recovered).toHaveLength(1);
    expect(recovered[0]?.payload).toMatchObject({
      kioskId: KIOSK,
      agencyId: AGENCY,
      status: "ONLINE",
    });
  });

  it("ADM-003a: recovery vers DEGRADED (imprimante KO) émet aussi kiosk:recovered", () => {
    const bus = createCaptureBus();
    const tracker = new KioskSilenceTracker(bus);
    tracker.reconcile([row({ lastSeen: secondsAgo(600) })], NOW); // SILENT
    tracker.reconcile([row({ lastSeen: secondsAgo(5), printerOk: false })], NOW);
    const recovered = bus.ofType("kiosk:recovered");
    expect(recovered).toHaveLength(1);
    expect(recovered[0]?.payload).toMatchObject({ status: "DEGRADED" });
  });

  it("ADM-003a: flapping SILENT→ONLINE→SILENT → un épisode fermé puis un nouveau", () => {
    const bus = createCaptureBus();
    const tracker = new KioskSilenceTracker(bus);
    tracker.reconcile([row({ lastSeen: secondsAgo(600) })], NOW); // SILENT (1)
    tracker.reconcile([row({ lastSeen: secondsAgo(5) })], NOW); // ONLINE → recovered (1)
    tracker.reconcile([row({ lastSeen: secondsAgo(600) })], NOW); // SILENT à nouveau (2)
    expect(bus.ofType("kiosk:silent")).toHaveLength(2);
    expect(bus.ofType("kiosk:recovered")).toHaveLength(1);
  });

  it("ADM-003a: anti-tempête — coupure agence (N bornes muettes) = 1 alerte par borne, agrégée par agence", () => {
    const bus = createCaptureBus();
    const tracker = new KioskSilenceTracker(bus);
    const outage: KioskSupervisionRow[] = [
      row({ kioskId: KIOSK, lastSeen: secondsAgo(600) }),
      row({ kioskId: KIOSK_2, lastSeen: secondsAgo(600) }),
      row({ kioskId: KIOSK_3, lastSeen: secondsAgo(600) }),
    ];
    tracker.reconcile(outage, NOW);
    // Une alerte par borne (pas de multiplication), toutes sur la même agence.
    const silent = bus.ofType("kiosk:silent");
    expect(silent).toHaveLength(3);
    expect(new Set(silent.map((e) => e.agencyId))).toEqual(new Set([AGENCY]));
    // Rejoué à l'identique : plus aucune alerte (épisodes déjà ouverts).
    tracker.reconcile(outage, NOW);
    expect(bus.ofType("kiosk:silent")).toHaveLength(3);
  });

  it("ADM-003a: NEVER_SEEN n'alerte JAMAIS (borne jamais vue ≠ borne muette)", () => {
    const bus = createCaptureBus();
    const tracker = new KioskSilenceTracker(bus);
    tracker.reconcile([row({ lastSeen: null })], NOW);
    expect(bus.ofType("kiosk:silent")).toHaveLength(0);
    expect(bus.ofType("kiosk:recovered")).toHaveLength(0);
  });

  it("ADM-003a: DEGRADED (retard/imprimante) n'alerte PAS (seul SILENT alerte)", () => {
    const bus = createCaptureBus();
    const tracker = new KioskSilenceTracker(bus);
    tracker.reconcile([row({ lastSeen: secondsAgo(75) })], NOW); // DEGRADED
    tracker.reconcile([row({ lastSeen: secondsAgo(10), printerOk: false })], NOW); // DEGRADED
    expect(bus.ofType("kiosk:silent")).toHaveLength(0);
  });

  it("ADM-003a: épisodes indépendants entre agences (isolation des trackers)", () => {
    const bus = createCaptureBus();
    const tracker = new KioskSilenceTracker(bus);
    tracker.reconcile(
      [
        row({ kioskId: KIOSK, agencyId: AGENCY, lastSeen: secondsAgo(600) }),
        row({ kioskId: KIOSK_2, agencyId: AGENCY_B, lastSeen: secondsAgo(5) }),
      ],
      NOW
    );
    const silent = bus.ofType("kiosk:silent");
    expect(silent).toHaveLength(1);
    expect(silent[0]?.agencyId).toBe(AGENCY);
  });
});
