/**
 * Tests for useTvClock / formatClock (TV-001 header clock).
 * @module lib/use-tv-clock.test
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { formatClock, useTvClock } from "./use-tv-clock";

describe("formatClock", () => {
  it("TV-001: zero-pads hours/minutes/seconds", () => {
    const d = new Date(2026, 6, 11, 9, 3, 7);
    expect(formatClock(d)).toBe("09:03:07");
  });

  it("TV-001: renders 24h time", () => {
    const d = new Date(2026, 6, 11, 14, 37, 22);
    expect(formatClock(d)).toBe("14:37:22");
  });
});

describe("useTvClock", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("TV-001: horloge temps réel — met à jour chaque seconde (rendu client)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 11, 14, 37, 22));
    const { result } = renderHook(() => useTvClock());
    expect(result.current).toBe("14:37:22");
    // Advance the system clock in lock-step with the interval tick.
    act(() => {
      vi.setSystemTime(new Date(2026, 6, 11, 14, 37, 23));
      vi.advanceTimersByTime(1000);
    });
    // The tick reads the current wall time; assert it advanced past the seed.
    expect(result.current).not.toBe("14:37:22");
    expect(result.current).toMatch(/^14:37:2\d$/);
  });
});
