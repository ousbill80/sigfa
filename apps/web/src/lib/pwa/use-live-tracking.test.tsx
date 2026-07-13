/**
 * NOTIF-005-B — tests for useLiveTracking (polling + offline resync).
 * @module lib/pwa/use-live-tracking.test
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw-server";
import { useLiveTracking } from "./use-live-tracking";

const BASE = "http://localhost:4010";
const TID = "V9k2mXpLqRwZsYn8fBjH3";

function statusBody(status: string, position: number) {
  return {
    trackingId: TID,
    number: "A042",
    displayNumber: "OC-042",
    status,
    channel: "QR",
    position,
    estimatedWaitMinutes: position * 2,
    agencyId: "ag-1",
    serviceId: "svc-1",
    createdAt: "2026-07-11T09:00:00Z",
  };
}

function setOnLine(value: boolean): void {
  Object.defineProperty(navigator, "onLine", { value, configurable: true, writable: true });
}

beforeEach(() => setOnLine(true));
afterEach(() => {
  server.resetHandlers();
  setOnLine(true);
  vi.restoreAllMocks();
});

describe("NOTIF-005-B: useLiveTracking", () => {
  it("loads the ticket and reaches ready phase", async () => {
    server.use(http.get(`${BASE}/public/tickets/:id`, () => HttpResponse.json(statusBody("WAITING", 3))));
    const { result } = renderHook(() => useLiveTracking(BASE, TID, 999_999));
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    expect(result.current.ticket?.position).toBe(3);
  });

  it("does nothing when trackingId is null", async () => {
    const { result } = renderHook(() => useLiveTracking(BASE, null, 999_999));
    await Promise.resolve();
    expect(result.current.ticket).toBeNull();
    expect(result.current.phase).toBe("loading");
  });

  it("shows error phase when first load fails and nothing is cached", async () => {
    server.use(
      http.get(`${BASE}/public/tickets/:id`, () =>
        HttpResponse.json({ error: { code: "TICKET_NOT_FOUND" } }, { status: 404 }),
      ),
    );
    const { result } = renderHook(() => useLiveTracking(BASE, TID, 999_999));
    await waitFor(() => expect(result.current.phase).toBe("error"));
    expect(result.current.ticket).toBeNull();
  });

  it("keeps last known ticket and switches to offline on disconnection", async () => {
    server.use(http.get(`${BASE}/public/tickets/:id`, () => HttpResponse.json(statusBody("WAITING", 4))));
    const { result } = renderHook(() => useLiveTracking(BASE, TID, 999_999));
    await waitFor(() => expect(result.current.phase).toBe("ready"));

    act(() => {
      setOnLine(false);
      window.dispatchEvent(new Event("offline"));
    });
    await waitFor(() => expect(result.current.phase).toBe("offline"));
    // Last known state is preserved.
    expect(result.current.ticket?.position).toBe(4);
  });

  it("resyncs on reconnection", async () => {
    let position = 5;
    server.use(
      http.get(`${BASE}/public/tickets/:id`, () => HttpResponse.json(statusBody("WAITING", position))),
    );
    const { result } = renderHook(() => useLiveTracking(BASE, TID, 999_999));
    await waitFor(() => expect(result.current.ticket?.position).toBe(5));

    act(() => {
      setOnLine(false);
      window.dispatchEvent(new Event("offline"));
    });
    await waitFor(() => expect(result.current.phase).toBe("offline"));

    position = 1;
    act(() => {
      setOnLine(true);
      window.dispatchEvent(new Event("online"));
    });
    await waitFor(() => expect(result.current.ticket?.position).toBe(1));
    expect(result.current.phase).toBe("ready");
  });

  it("manual refresh re-fetches the status", async () => {
    let position = 6;
    server.use(
      http.get(`${BASE}/public/tickets/:id`, () => HttpResponse.json(statusBody("WAITING", position))),
    );
    const { result } = renderHook(() => useLiveTracking(BASE, TID, 999_999));
    await waitFor(() => expect(result.current.ticket?.position).toBe(6));
    position = 2;
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.ticket?.position).toBe(2));
  });
});
