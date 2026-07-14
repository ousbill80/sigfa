/**
 * Boucle 2 F4 — S5 : le Bearer de la session borne est porté par les appels.
 * Tests TDD écrits AVANT le correctif (phase rouge).
 *
 * Constat panel : POST /tickets/sync (core, scope agency) et
 * POST /kiosks/{kioskId}/heartbeat (public, token de session borne) partaient
 * SANS Authorization → 401 systématique contre l'API réelle.
 */
import "fake-indexeddb/auto";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { renderHook } from "@testing-library/react";
import { useOfflineTicket } from "@/hooks/useOfflineTicket";
import { useKioskHeartbeat } from "@/hooks/useKioskHeartbeat";
import { getOfflineDb, __resetOfflineDbForTests } from "@/lib/offline-db";
import {
  registerKioskSessionProvisioner,
  ensureKioskSession,
  __resetKioskSessionForTests,
} from "@/lib/kiosk-session-store";
import type { KioskSession } from "@/lib/kiosk-session";

const KIOSK_ID = "14141414-1414-4141-a141-141414141414";
const AGENCY_ID = "33333333-3333-4333-a333-333333333333";

function makeSession(overrides: Partial<KioskSession> = {}): KioskSession {
  return {
    accessToken: "jwt-session-borne",
    expiresIn: 43200,
    kioskId: KIOSK_ID,
    agencyId: AGENCY_ID,
    bankId: "22222222-2222-4222-a222-222222222222",
    createdAt: Date.now(),
    ...overrides,
  };
}

interface SyncBody {
  tickets: { localUuid: string }[];
}

const server = setupServer();
let syncAuthHeaders: (string | null)[] = [];
let heartbeatAuthHeaders: (string | null)[] = [];

beforeEach(async () => {
  server.listen({ onUnhandledRequest: "bypass" });
  syncAuthHeaders = [];
  heartbeatAuthHeaders = [];
  server.use(
    http.post("*/tickets/sync", async ({ request }) => {
      syncAuthHeaders.push(request.headers.get("Authorization"));
      const body = (await request.json()) as SyncBody;
      return HttpResponse.json({
        synced: body.tickets.map((t) => ({
          localUuid: t.localUuid,
          serverId: crypto.randomUUID(),
          number: "A100",
        })),
        skipped: [],
      });
    }),
    http.post("*/kiosks/:kioskId/heartbeat", ({ request }) => {
      heartbeatAuthHeaders.push(request.headers.get("Authorization"));
      return HttpResponse.json(
        { serverTime: new Date().toISOString() },
        { status: 200 }
      );
    })
  );

  __resetKioskSessionForTests();
  __resetOfflineDbForTests();
  const db = getOfflineDb();
  await db.open();
  await db.tickets.clear();
  await db.counters.clear();
});

afterEach(async () => {
  server.resetHandlers();
  server.close();
  const db = getOfflineDb();
  await db.tickets.clear();
  await db.counters.clear();
  __resetOfflineDbForTests();
  __resetKioskSessionForTests();
  vi.useRealTimers();
});

describe("KIOSK-001/S5: Bearer session borne sur sync + heartbeat", () => {
  it("S5: POST /tickets/sync porte Authorization: Bearer <session borne>", async () => {
    registerKioskSessionProvisioner(async () => makeSession());
    await ensureKioskSession();

    const { result } = renderHook(() => useOfflineTicket());
    await result.current.createOfflineTicket({ serviceId: "svc-1" });
    const res = await result.current.syncPendingTickets();

    expect(res.syncedCount).toBe(1);
    expect(syncAuthHeaders).toHaveLength(1);
    expect(syncAuthHeaders[0]).toBe("Bearer jwt-session-borne");
  });

  it("S5: POST /kiosks/{kioskId}/heartbeat porte le token de session borne", async () => {
    registerKioskSessionProvisioner(async () => makeSession());
    await ensureKioskSession();

    const { result } = renderHook(() =>
      useKioskHeartbeat({ apiUrl: "http://localhost:4010" })
    );
    const res = await result.current.sendHeartbeat({
      kioskId: KIOSK_ID,
      agencyId: AGENCY_ID,
      printerStatus: "OK",
    });

    expect(res.ok).toBe(true);
    expect(heartbeatAuthHeaders).toHaveLength(1);
    expect(heartbeatAuthHeaders[0]).toBe("Bearer jwt-session-borne");
  });

  it("S5: session expirée avant la sync → RE-CRÉATION puis Bearer neuf (12 h)", async () => {
    // Seule l'horloge Date est simulée : fetch/MSW gardent leurs timers réels.
    vi.useFakeTimers({ toFake: ["Date"] });
    let calls = 0;
    registerKioskSessionProvisioner(async () => {
      calls += 1;
      return makeSession({ accessToken: `jwt-rotation-${calls}` });
    });
    await ensureKioskSession();
    expect(calls).toBe(1);

    // 12 h + 1 min : la session est expirée au moment de la sync.
    vi.advanceTimersByTime(43_260 * 1000);

    const { result } = renderHook(() => useOfflineTicket());
    await result.current.createOfflineTicket({ serviceId: "svc-1" });
    await result.current.syncPendingTickets();

    expect(calls).toBe(2);
    expect(syncAuthHeaders[0]).toBe("Bearer jwt-rotation-2");
  });

  it("S5: échec de re-création → sync dégradée sans Bearer, sans crash (ticket conservé si 401)", async () => {
    server.use(
      http.post("*/tickets/sync", ({ request }) => {
        syncAuthHeaders.push(request.headers.get("Authorization"));
        return HttpResponse.json(
          { error: { code: "UNAUTHORIZED", message: "session requise" } },
          { status: 401 }
        );
      })
    );
    // Aucun provisionneur : borne dégradée (pas de session possible).
    const { result } = renderHook(() => useOfflineTicket());
    await result.current.createOfflineTicket({ serviceId: "svc-1" });
    const res = await result.current.syncPendingTickets();

    // Pas de purge : le ticket sera rejoué quand la session sera rétablie.
    expect(res.syncedCount).toBe(0);
    expect(syncAuthHeaders[0]).toBeNull();
    const db = getOfflineDb();
    expect(await db.tickets.count()).toBe(1);
  });
});
