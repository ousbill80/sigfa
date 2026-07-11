/**
 * KIOSK-002/003 — Tests unitaires pour les hooks kiosk
 * Couvre : useAccessibilityMode, useInactivityTimeout, useQueueStatus
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// ─────────────────────────────────────────────────────────
// useAccessibilityMode
// ─────────────────────────────────────────────────────────
import { useAccessibilityMode } from "@/hooks/useAccessibilityMode";

describe("KIOSK-003: useAccessibilityMode", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("KIOSK-003: returns false by default when sessionStorage is empty", () => {
    const { result } = renderHook(() => useAccessibilityMode());
    expect(result.current.isAccessibilityMode).toBe(false);
  });

  it("KIOSK-003: returns true when sessionStorage has 'true'", () => {
    sessionStorage.setItem("kiosk_accessibility_mode", "true");
    const { result } = renderHook(() => useAccessibilityMode());
    expect(result.current.isAccessibilityMode).toBe(true);
  });

  it("KIOSK-003: toggleAccessibilityMode flips state from false to true", () => {
    const { result } = renderHook(() => useAccessibilityMode());
    expect(result.current.isAccessibilityMode).toBe(false);

    act(() => {
      result.current.toggleAccessibilityMode();
    });

    expect(result.current.isAccessibilityMode).toBe(true);
    expect(sessionStorage.getItem("kiosk_accessibility_mode")).toBe("true");
  });

  it("KIOSK-003: toggleAccessibilityMode flips state from true to false", () => {
    sessionStorage.setItem("kiosk_accessibility_mode", "true");
    const { result } = renderHook(() => useAccessibilityMode());
    expect(result.current.isAccessibilityMode).toBe(true);

    act(() => {
      result.current.toggleAccessibilityMode();
    });

    expect(result.current.isAccessibilityMode).toBe(false);
    expect(sessionStorage.getItem("kiosk_accessibility_mode")).toBe("false");
  });

  it("KIOSK-003: toggleAccessibilityMode updates sessionStorage", () => {
    const { result } = renderHook(() => useAccessibilityMode());

    act(() => {
      result.current.toggleAccessibilityMode();
    });

    expect(sessionStorage.getItem("kiosk_accessibility_mode")).toBe("true");

    act(() => {
      result.current.toggleAccessibilityMode();
    });

    expect(sessionStorage.getItem("kiosk_accessibility_mode")).toBe("false");
  });
});

// ─────────────────────────────────────────────────────────
// useInactivityTimeout
// ─────────────────────────────────────────────────────────
import { useInactivityTimeout } from "@/hooks/useInactivityTimeout";

describe("KIOSK-002: useInactivityTimeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("KIOSK-002: calls onTimeout after delayMs of inactivity", () => {
    const onTimeout = vi.fn();
    renderHook(() => useInactivityTimeout(onTimeout, 3000));

    vi.advanceTimersByTime(3000);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it("KIOSK-002: does NOT call onTimeout before delay expires", () => {
    const onTimeout = vi.fn();
    renderHook(() => useInactivityTimeout(onTimeout, 3000));

    vi.advanceTimersByTime(2999);
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it("KIOSK-002: resets timer on mousemove event", () => {
    const onTimeout = vi.fn();
    renderHook(() => useInactivityTimeout(onTimeout, 3000));

    vi.advanceTimersByTime(2000);
    window.dispatchEvent(new MouseEvent("mousemove"));
    vi.advanceTimersByTime(2000);

    // Should not have been called yet (timer was reset by mousemove)
    expect(onTimeout).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1001);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it("KIOSK-002: resets timer on touchstart event", () => {
    const onTimeout = vi.fn();
    renderHook(() => useInactivityTimeout(onTimeout, 3000));

    vi.advanceTimersByTime(2500);
    window.dispatchEvent(new TouchEvent("touchstart"));
    vi.advanceTimersByTime(2500);

    expect(onTimeout).not.toHaveBeenCalled();

    vi.advanceTimersByTime(501);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it("KIOSK-002: resets timer on keydown event", () => {
    const onTimeout = vi.fn();
    renderHook(() => useInactivityTimeout(onTimeout, 3000));

    vi.advanceTimersByTime(2500);
    window.dispatchEvent(new KeyboardEvent("keydown"));
    vi.advanceTimersByTime(2500);

    expect(onTimeout).not.toHaveBeenCalled();

    vi.advanceTimersByTime(501);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it("KIOSK-002: cleans up event listeners on unmount", () => {
    const onTimeout = vi.fn();
    const removeEventListenerSpy = vi.spyOn(window, "removeEventListener");

    const { unmount } = renderHook(() => useInactivityTimeout(onTimeout, 3000));
    unmount();

    expect(removeEventListenerSpy).toHaveBeenCalledWith("touchstart", expect.any(Function));
    expect(removeEventListenerSpy).toHaveBeenCalledWith("mousemove", expect.any(Function));
    expect(removeEventListenerSpy).toHaveBeenCalledWith("keydown", expect.any(Function));
  });

  it("KIOSK-002: does NOT call onTimeout after unmount", () => {
    const onTimeout = vi.fn();
    const { unmount } = renderHook(() => useInactivityTimeout(onTimeout, 3000));

    unmount();
    vi.advanceTimersByTime(3000);

    expect(onTimeout).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────
// useQueueStatus
// ─────────────────────────────────────────────────────────
import { useQueueStatus } from "@/hooks/useQueueStatus";

describe("KIOSK-002: useQueueStatus", () => {
  beforeEach(() => {
    // navigator.onLine is true by default in jsdom
    Object.defineProperty(navigator, "onLine", {
      writable: true,
      configurable: true,
      value: true,
    });
  });

  it("KIOSK-002: returns initial state with null counts and isOffline false", () => {
    const { result } = renderHook(() => useQueueStatus());
    expect(result.current.count).toBeNull();
    expect(result.current.estimatedMinutes).toBeNull();
    expect(result.current.isOffline).toBe(false);
  });

  it("KIOSK-002: returns isOffline true when navigator.onLine is false", () => {
    Object.defineProperty(navigator, "onLine", {
      writable: true,
      configurable: true,
      value: false,
    });
    const { result } = renderHook(() => useQueueStatus());
    expect(result.current.isOffline).toBe(true);
  });

  it("KIOSK-002: updates state when queue:updated custom event is dispatched", () => {
    const { result } = renderHook(() => useQueueStatus());

    act(() => {
      window.dispatchEvent(
        new CustomEvent("queue:updated", {
          detail: { count: 7, estimatedMinutes: 15 },
        })
      );
    });

    expect(result.current.count).toBe(7);
    expect(result.current.estimatedMinutes).toBe(15);
  });

  it("KIOSK-002: sets isOffline to false when online event fires", () => {
    Object.defineProperty(navigator, "onLine", {
      writable: true,
      configurable: true,
      value: false,
    });

    const { result } = renderHook(() => useQueueStatus());
    expect(result.current.isOffline).toBe(true);

    act(() => {
      Object.defineProperty(navigator, "onLine", { value: true, writable: true, configurable: true });
      window.dispatchEvent(new Event("online"));
    });

    expect(result.current.isOffline).toBe(false);
  });

  it("KIOSK-002: sets isOffline to true when offline event fires", () => {
    const { result } = renderHook(() => useQueueStatus());
    expect(result.current.isOffline).toBe(false);

    act(() => {
      window.dispatchEvent(new Event("offline"));
    });

    expect(result.current.isOffline).toBe(true);
  });

  it("KIOSK-002: cleans up event listeners on unmount", () => {
    const removeEventListenerSpy = vi.spyOn(window, "removeEventListener");
    const { unmount } = renderHook(() => useQueueStatus());
    unmount();

    expect(removeEventListenerSpy).toHaveBeenCalledWith("online", expect.any(Function));
    expect(removeEventListenerSpy).toHaveBeenCalledWith("offline", expect.any(Function));
    expect(removeEventListenerSpy).toHaveBeenCalledWith("queue:updated", expect.any(Function));
  });
});
