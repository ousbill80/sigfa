/**
 * NOTIF-005-B — tests for useServiceWorker registration.
 * @module lib/pwa/use-service-worker.test
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useServiceWorker, SERVICE_WORKER_PATH } from "./use-service-worker";

afterEach(() => {
  vi.restoreAllMocks();
  // Clean up any injected serviceWorker mock.
  if ("serviceWorker" in navigator) {
    delete (navigator as unknown as { serviceWorker?: unknown }).serviceWorker;
  }
});

describe("NOTIF-005-B: useServiceWorker", () => {
  it("registers the SW at the expected path when enabled", () => {
    const register = vi.fn().mockResolvedValue({});
    Object.defineProperty(navigator, "serviceWorker", {
      value: { register },
      configurable: true,
    });
    renderHook(() => useServiceWorker(true));
    expect(register).toHaveBeenCalledWith(SERVICE_WORKER_PATH, { scope: "/q/" });
  });

  it("does not register when disabled", () => {
    const register = vi.fn().mockResolvedValue({});
    Object.defineProperty(navigator, "serviceWorker", {
      value: { register },
      configurable: true,
    });
    renderHook(() => useServiceWorker(false));
    expect(register).not.toHaveBeenCalled();
  });

  it("is a no-op when serviceWorker is unavailable", () => {
    // Ensure the API is absent.
    if ("serviceWorker" in navigator) {
      delete (navigator as unknown as { serviceWorker?: unknown }).serviceWorker;
    }
    expect(() => renderHook(() => useServiceWorker(true))).not.toThrow();
  });

  it("swallows a failed registration (progressive enhancement)", async () => {
    const register = vi.fn().mockRejectedValue(new Error("no sw"));
    Object.defineProperty(navigator, "serviceWorker", {
      value: { register },
      configurable: true,
    });
    expect(() => renderHook(() => useServiceWorker(true))).not.toThrow();
    // Allow the rejected promise to settle without an unhandled rejection.
    await Promise.resolve();
    expect(register).toHaveBeenCalled();
  });
});
