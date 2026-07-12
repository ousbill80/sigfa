/**
 * KIOSK-007 — Tests TDD (phase rouge) pour la dérivation d'état dégradé
 * et l'émetteur simulé (sockets SIMULÉS, convention F4 — aucune connexion réelle).
 */
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import {
  deriveDegradedState,
  useDegradedState,
  DEFAULT_LONG_QUEUE_THRESHOLD_MIN,
  NORMAL_DISPLAY_MS,
  EXTENDED_DISPLAY_MS,
} from "@/hooks/useDegradedState";
import {
  signalPrinterError,
  signalKioskSystemError,
  type DegradedEventSink,
} from "@/lib/kiosk-degraded-emitter";

function makeSink(): DegradedEventSink & { calls: Array<{ name: string; payload: unknown }> } {
  const calls: Array<{ name: string; payload: unknown }> = [];
  return {
    calls,
    emit: (name: string, payload: unknown) => {
      calls.push({ name, payload });
    },
  };
}

const KIOSK_ID = "14141414-1414-4141-a141-141414141414";
const AGENCY_ID = "33333333-3333-4333-a333-333333333333";

describe("KIOSK-007: dérivation d'état dégradé", () => {
  it("KIOSK-007: printerStatus PAPER_LOW → affichage prolongé 8 s, SMS suggéré", () => {
    const state = deriveDegradedState({ printerStatus: "PAPER_LOW" });
    expect(state.isPrinterDegraded).toBe(true);
    expect(state.isDisplayDegraded).toBe(true);
    expect(state.displayDurationMs).toBe(EXTENDED_DISPLAY_MS);
    expect(state.smsStronglySuggested).toBe(true);
  });

  it("KIOSK-007: printerStatus OK → affichage normal 4 s, aucun message dégradé", () => {
    const state = deriveDegradedState({ printerStatus: "OK" });
    expect(state.isPrinterDegraded).toBe(false);
    expect(state.isDisplayDegraded).toBe(false);
    expect(state.displayDurationMs).toBe(NORMAL_DISPLAY_MS);
    expect(state.smsStronglySuggested).toBe(false);
  });

  it("KIOSK-007: ERROR et OFFLINE dégradent aussi l'affichage", () => {
    expect(deriveDegradedState({ printerStatus: "ERROR" }).isDisplayDegraded).toBe(true);
    expect(deriveDegradedState({ printerStatus: "OFFLINE" }).isDisplayDegraded).toBe(true);
  });

  it("KIOSK-007: estimatedWaitMinutes ≥ seuil → file longue (défaut 30 min)", () => {
    expect(deriveDegradedState({ estimatedWaitMinutes: 30 }).isLongQueue).toBe(true);
    expect(deriveDegradedState({ estimatedWaitMinutes: 45 }).isLongQueue).toBe(true);
    expect(deriveDegradedState({ estimatedWaitMinutes: 29 }).isLongQueue).toBe(false);
    expect(DEFAULT_LONG_QUEUE_THRESHOLD_MIN).toBe(30);
  });

  it("KIOSK-007: seuil file longue configurable", () => {
    expect(
      deriveDegradedState({ estimatedWaitMinutes: 20, longQueueThresholdMinutes: 15 }).isLongQueue
    ).toBe(true);
    expect(
      deriveDegradedState({ estimatedWaitMinutes: 20, longQueueThresholdMinutes: 25 }).isLongQueue
    ).toBe(false);
  });

  it("KIOSK-007: réseau coupé après 201 avant confirmation imprimante → affichage 8 s", () => {
    const state = deriveDegradedState({ networkLostBeforePrinterConfirm: true });
    expect(state.isDisplayDegraded).toBe(true);
    expect(state.displayDurationMs).toBe(EXTENDED_DISPLAY_MS);
    expect(state.smsStronglySuggested).toBe(true);
  });

  it("KIOSK-007: hook useDegradedState délègue à deriveDegradedState (parité)", () => {
    const { result } = renderHook(() => useDegradedState({ printerStatus: "ERROR" }));
    expect(result.current).toEqual(deriveDegradedState({ printerStatus: "ERROR" }));
    expect(result.current.isDisplayDegraded).toBe(true);
  });
});

describe("KIOSK-007: émetteur simulé (F4, aucune connexion socket réelle)", () => {
  it("KIOSK-007: printerStatus ERROR → kiosk:printer-error émis (mock Socket, Vitest)", () => {
    const sink = makeSink();
    const ok = signalPrinterError(
      { kioskId: KIOSK_ID, agencyId: AGENCY_ID, since: new Date().toISOString() },
      sink
    );
    expect(ok).toBe(true);
    expect(sink.calls).toHaveLength(1);
    expect(sink.calls[0]!.name).toBe("kiosk:printer-error");
    expect(sink.calls[0]!.payload).toMatchObject({ kioskId: KIOSK_ID, agencyId: AGENCY_ID });
  });

  it("KIOSK-007: payload invalide → aucun signalement (validation contrat)", () => {
    const sink = makeSink();
    const ok = signalPrinterError(
      { kioskId: "not-a-uuid", agencyId: AGENCY_ID, since: "bad" },
      sink
    );
    expect(ok).toBe(false);
    expect(sink.calls).toHaveLength(0);
  });

  it("KIOSK-007: alert:manager KIOSK_SYSTEM_ERROR émis (type CONTRACT-012 — jamais SLA_BREACH, mock Socket)", () => {
    const sink = makeSink();
    const ok = signalKioskSystemError({ kioskId: KIOSK_ID, serviceId: "svc-1" }, sink);
    expect(ok).toBe(true);
    expect(sink.calls).toHaveLength(1);
    expect(sink.calls[0]!.name).toBe("alert:manager");
    const payload = sink.calls[0]!.payload as { type: string };
    expect(payload.type).toBe("KIOSK_SYSTEM_ERROR");
    expect(payload.type).not.toBe("SLA_BREACH");
  });

  it("KIOSK-007: sink par défaut est un no-op (émission réelle déléguée au serveur)", () => {
    // Ne doit lever aucune erreur ni ouvrir de réseau : simple no-op.
    expect(() =>
      signalPrinterError({ kioskId: KIOSK_ID, agencyId: AGENCY_ID, since: new Date().toISOString() })
    ).not.toThrow();
    void vi;
  });
});
