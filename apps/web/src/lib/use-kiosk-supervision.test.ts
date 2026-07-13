/**
 * Tests for useKioskSupervision (ADM-003b) — status fetch → seed, 5 loads,
 * realtime events (kiosk:silent/recovered/status), poll fallback, resync on
 * reconnect, and defensive row coercion.
 * @module lib/use-kiosk-supervision.test
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import {
  useKioskSupervision,
  toSupervisedKiosk,
  type RawKioskEntry,
  type SupervisionSocket,
} from "./use-kiosk-supervision";

const A1 = "33333333-3333-4333-a333-333333333333";
const K1 = "14141414-1414-4141-a141-141414141414";
const K2 = "15151515-1515-4151-a151-151515151515";

function row(over: Partial<RawKioskEntry> = {}): RawKioskEntry {
  return { kioskId: K1, agencyId: A1, status: "ONLINE", lastSeen: "2026-07-12T09:59:30Z", ...over };
}

/** A fake socket recording listeners so tests can fire events. */
function fakeSocket(connected: boolean): SupervisionSocket & {
  fire: (event: string, payload?: unknown) => void;
  listeners: Map<string, Set<(p: unknown) => void>>;
} {
  const listeners = new Map<string, Set<(p: unknown) => void>>();
  return {
    connected,
    listeners,
    on(event, listener) {
      const set = listeners.get(event) ?? new Set();
      set.add(listener);
      listeners.set(event, set);
    },
    off(event, listener) {
      listeners.get(event)?.delete(listener);
    },
    fire(event, payload) {
      for (const l of listeners.get(event) ?? []) l(payload);
    },
  };
}

describe("ADM-003b: coercion défensive des lignes de statut", () => {
  it("ADM-003b: rejette une ligne sans kioskId/status valide", () => {
    expect(toSupervisedKiosk({ kioskId: 42, agencyId: A1, status: "ONLINE" })).toBeNull();
    expect(toSupervisedKiosk({ kioskId: K1, agencyId: A1, status: "BOGUS" })).toBeNull();
  });

  it("ADM-003b: lastSeen absent → null (NEVER_SEEN)", () => {
    const k = toSupervisedKiosk({ kioskId: K1, agencyId: A1, status: "NEVER_SEEN" });
    expect(k?.lastSeen).toBeNull();
  });
});

describe("ADM-003b: chargement du statut agence", () => {
  it("ADM-003b: fetchStatus → seed + load ready", async () => {
    const fetchStatus = vi.fn(async () => [row(), row({ kioskId: K2, status: "SILENT" })]);
    const { result } = renderHook(() => useKioskSupervision({ fetchStatus }));
    await waitFor(() => expect(result.current.load).toBe("ready"));
    expect(result.current.state.kiosks).toHaveLength(2);
  });

  it("ADM-003b: liste vide → load empty (EmptyState)", async () => {
    const fetchStatus = vi.fn(async () => []);
    const { result } = renderHook(() => useKioskSupervision({ fetchStatus }));
    await waitFor(() => expect(result.current.load).toBe("empty"));
  });

  it("ADM-003b: fetch null au premier appel → load error", async () => {
    const fetchStatus = vi.fn(async () => null);
    const { result } = renderHook(() => useKioskSupervision({ fetchStatus }));
    await waitFor(() => expect(result.current.load).toBe("error"));
  });

  it("ADM-003b: API indisponible APRÈS un premier succès → stale + dernier état connu", async () => {
    const fetchStatus = vi
      .fn<() => Promise<RawKioskEntry[] | null>>()
      .mockResolvedValueOnce([row()])
      .mockResolvedValueOnce(null);
    const { result } = renderHook(() => useKioskSupervision({ fetchStatus }));
    await waitFor(() => expect(result.current.load).toBe("ready"));
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.load).toBe("stale");
    // Dernier état connu conservé (jamais un écran vide).
    expect(result.current.state.kiosks).toHaveLength(1);
  });
});

describe("ADM-003b: temps réel via socket injecté", () => {
  it("ADM-003b: kiosk:silent → borne passe SILENT", async () => {
    const fetchStatus = vi.fn(async () => [row({ status: "ONLINE" })]);
    const socket = fakeSocket(true);
    const { result } = renderHook(() => useKioskSupervision({ fetchStatus, socket }));
    await waitFor(() => expect(result.current.load).toBe("ready"));
    act(() => {
      socket.fire("kiosk:silent", { kioskId: K1, agencyId: A1, status: "SILENT", since: "2026-07-12T09:40:00Z" });
    });
    expect(result.current.state.kiosks[0]!.status).toBe("SILENT");
  });

  it("ADM-003b: kiosk:recovered → retour ONLINE", async () => {
    const fetchStatus = vi.fn(async () => [row({ status: "SILENT" })]);
    const socket = fakeSocket(true);
    const { result } = renderHook(() => useKioskSupervision({ fetchStatus, socket }));
    await waitFor(() => expect(result.current.load).toBe("ready"));
    act(() => {
      socket.fire("kiosk:recovered", { kioskId: K1, agencyId: A1, status: "ONLINE", since: "2026-07-12T10:00:00Z" });
    });
    expect(result.current.state.kiosks[0]!.status).toBe("ONLINE");
  });

  it("ADM-003b: reconnexion (connect) → resync complet (re-fetch)", async () => {
    const fetchStatus = vi.fn(async () => [row()]);
    const socket = fakeSocket(true);
    renderHook(() => useKioskSupervision({ fetchStatus, socket }));
    await waitFor(() => expect(fetchStatus).toHaveBeenCalledTimes(1));
    act(() => {
      socket.fire("connect");
    });
    await waitFor(() => expect(fetchStatus).toHaveBeenCalledTimes(2));
  });

  it("ADM-003b: connexion active → connection = connected", async () => {
    const fetchStatus = vi.fn(async () => [row()]);
    const socket = fakeSocket(true);
    const { result } = renderHook(() => useKioskSupervision({ fetchStatus, socket }));
    await waitFor(() => expect(result.current.state.connection).toBe("connected"));
  });
});

describe("ADM-003b: repli poll (mock / socket absent)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("ADM-003b: sans socket → connection offline + poll périodique", async () => {
    const fetchStatus = vi.fn(async () => [row()]);
    const { result } = renderHook(() =>
      useKioskSupervision({ fetchStatus, pollMs: 5_000 }),
    );
    // Initial load.
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.state.connection).toBe("offline");
    const before = fetchStatus.mock.calls.length;
    await act(async () => {
      vi.advanceTimersByTime(5_000);
      await Promise.resolve();
    });
    expect(fetchStatus.mock.calls.length).toBeGreaterThan(before);
  });
});
