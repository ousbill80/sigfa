/**
 * KIOSK-007 — Tests TDD (phase rouge) pour useKioskHeartbeat.
 *
 * Chemin RÉEL de signalement imprimante : POST /kiosks/{kioskId}/heartbeat
 * (contrat public). En F4 : heartbeat = vrai appel HTTP mocké (MSW), émission
 * `kiosk:printer-error` = SIMULÉE via sink injecté (aucune socket réelle).
 */
import { describe, it, expect, vi, afterEach, beforeEach, beforeAll, afterAll } from "vitest";
import { renderHook } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "@/mocks/server";
import { useKioskHeartbeat } from "@/hooks/useKioskHeartbeat";
import type { DegradedEventSink } from "@/lib/kiosk-degraded-emitter";

const KIOSK_ID = "14141414-1414-4141-a141-141414141414";
const AGENCY_ID = "33333333-3333-4333-a333-333333333333";

function makeSink(): DegradedEventSink & { calls: Array<{ name: string; payload: unknown }> } {
  const calls: Array<{ name: string; payload: unknown }> = [];
  return { calls, emit: (name, payload) => calls.push({ name, payload }) };
}

let heartbeatBodies: unknown[] = [];

beforeAll(() => {
  server.listen({ onUnhandledRequest: "bypass" });
});

afterAll(() => {
  server.resetHandlers();
  server.close();
});

beforeEach(() => {
  heartbeatBodies = [];
  server.use(
    http.post("*/kiosks/:kioskId/heartbeat", async ({ request }) => {
      heartbeatBodies.push(await request.json());
      return HttpResponse.json({ serverTime: new Date().toISOString() }, { status: 200 });
    })
  );
});

afterEach(() => {
  server.resetHandlers();
  vi.clearAllMocks();
});

describe("KIOSK-007: useKioskHeartbeat", () => {
  it("KIOSK-007: heartbeat POST /kiosks/{kioskId}/heartbeat avec printerStatus (contrat)", async () => {
    const { result } = renderHook(() => useKioskHeartbeat({ apiUrl: "http://localhost:4010" }));
    const res = await result.current.sendHeartbeat({
      kioskId: KIOSK_ID,
      agencyId: AGENCY_ID,
      printerStatus: "OK",
    });
    expect(res.ok).toBe(true);
    expect(res.printerErrorSignalled).toBe(false);
    expect(heartbeatBodies).toHaveLength(1);
    expect(heartbeatBodies[0]).toMatchObject({ printerStatus: "OK" });
  });

  it("KIOSK-007: printerStatus != OK via heartbeat → kiosk:printer-error signalé sans délai (simulé F4)", async () => {
    const sink = makeSink();
    const { result } = renderHook(() =>
      useKioskHeartbeat({ apiUrl: "http://localhost:4010", sink })
    );
    const res = await result.current.sendHeartbeat({
      kioskId: KIOSK_ID,
      agencyId: AGENCY_ID,
      printerStatus: "ERROR",
    });
    expect(res.printerErrorSignalled).toBe(true);
    expect(sink.calls).toHaveLength(1);
    expect(sink.calls[0]!.name).toBe("kiosk:printer-error");
    expect(heartbeatBodies[0]).toMatchObject({ printerStatus: "ERROR" });
  });

  it("KIOSK-007: printerStatus OK → aucun kiosk:printer-error signalé", async () => {
    const sink = makeSink();
    const { result } = renderHook(() =>
      useKioskHeartbeat({ apiUrl: "http://localhost:4010", sink })
    );
    await result.current.sendHeartbeat({
      kioskId: KIOSK_ID,
      agencyId: AGENCY_ID,
      printerStatus: "OK",
    });
    expect(sink.calls).toHaveLength(0);
  });

  it("KIOSK-007: heartbeat en échec réseau → ok=false mais signalement imprimante conservé", async () => {
    server.use(
      http.post("*/kiosks/:kioskId/heartbeat", () => HttpResponse.error())
    );
    const sink = makeSink();
    const { result } = renderHook(() =>
      useKioskHeartbeat({ apiUrl: "http://localhost:4010", sink })
    );
    const res = await result.current.sendHeartbeat({
      kioskId: KIOSK_ID,
      agencyId: AGENCY_ID,
      printerStatus: "OFFLINE",
    });
    expect(res.ok).toBe(false);
    expect(res.printerErrorSignalled).toBe(true);
  });
});
