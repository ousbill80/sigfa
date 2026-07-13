/**
 * NOTIF-005-B — tests for useNetworkStatus.
 * @module lib/pwa/use-network-status.test
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useNetworkStatus } from "./use-network-status";

/** Overrides navigator.onLine for the duration of a test. */
function setOnLine(value: boolean): void {
  Object.defineProperty(navigator, "onLine", { value, configurable: true, writable: true });
}

afterEach(() => {
  setOnLine(true);
  vi.restoreAllMocks();
});

describe("NOTIF-005-B: useNetworkStatus", () => {
  it("reports the initial navigator.onLine value", () => {
    setOnLine(false);
    const { result } = renderHook(() => useNetworkStatus());
    expect(result.current).toBe(false);
  });

  it("flips to offline on the offline event and back on online", () => {
    setOnLine(true);
    const { result } = renderHook(() => useNetworkStatus());
    expect(result.current).toBe(true);

    act(() => {
      setOnLine(false);
      window.dispatchEvent(new Event("offline"));
    });
    expect(result.current).toBe(false);

    act(() => {
      setOnLine(true);
      window.dispatchEvent(new Event("online"));
    });
    expect(result.current).toBe(true);
  });

  it("detaches listeners on unmount (no leak)", () => {
    const removeSpy = vi.spyOn(window, "removeEventListener");
    const { unmount } = renderHook(() => useNetworkStatus());
    unmount();
    expect(removeSpy).toHaveBeenCalledWith("online", expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith("offline", expect.any(Function));
  });
});
