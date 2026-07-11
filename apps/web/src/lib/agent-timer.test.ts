/**
 * Tests for the agent service timer (WEB-002).
 * @module lib/agent-timer.test
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { formatDuration, useTicketTimer } from "./agent-timer";

describe("formatDuration", () => {
  it("WEB-002: formats seconds as MM:SS zero-padded", () => {
    expect(formatDuration(0)).toBe("00:00");
    expect(formatDuration(7)).toBe("00:07");
    expect(formatDuration(227)).toBe("03:47");
    expect(formatDuration(3599)).toBe("59:59");
  });

  it("WEB-002: clamps negative values to 00:00", () => {
    expect(formatDuration(-5)).toBe("00:00");
  });
});

describe("useTicketTimer", () => {
  afterEach(() => vi.useRealTimers());

  it("WEB-002: chrono démarre à 00:00 à l'appel et s'incrémente en secondes", () => {
    vi.useFakeTimers();
    const { result } = renderHook(({ k }) => useTicketTimer(k), {
      initialProps: { k: 1 as number | null },
    });
    expect(result.current).toBe("00:00");
    act(() => vi.advanceTimersByTime(3000));
    expect(result.current).toBe("00:03");
  });

  it("WEB-002: chrono se réinitialise à 00:00 à chaque nouveau ticket", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ k }) => useTicketTimer(k), {
      initialProps: { k: 1 as number | null },
    });
    act(() => vi.advanceTimersByTime(5000));
    expect(result.current).toBe("00:05");
    rerender({ k: 2 });
    expect(result.current).toBe("00:00");
  });

  it("WEB-002: runningSince null → chrono figé à 00:00", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useTicketTimer(null));
    act(() => vi.advanceTimersByTime(5000));
    expect(result.current).toBe("00:00");
  });
});
