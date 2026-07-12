/**
 * Tests for useAdCarousel — rotation via fake-timers, pause/reset on inactive.
 * @module lib/use-ad-carousel.test
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAdCarousel } from "./use-ad-carousel";
import type { AdSlide } from "./ad-slides";

const slides: AdSlide[] = [
  { id: "a", titleKey: "tv.ad.account.title", bg: "var(--night-2)" },
  { id: "b", titleKey: "tv.ad.credit.title", bg: "var(--night-2)" },
  { id: "c", titleKey: "tv.ad.app.title", bg: "var(--night-2)" },
];

describe("useAdCarousel", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("AdZone: démarre sur la première slide", () => {
    const { result } = renderHook(() => useAdCarousel({ slides, intervalMs: 1000 }));
    expect(result.current.index).toBe(0);
    expect(result.current.current?.id).toBe("a");
  });

  it("AdZone: avance d'une slide à chaque intervalle (fake-timers)", () => {
    const { result } = renderHook(() => useAdCarousel({ slides, intervalMs: 1000 }));
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.current?.id).toBe("b");
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.current?.id).toBe("c");
  });

  it("AdZone: boucle à la première slide après la dernière", () => {
    const { result } = renderHook(() => useAdCarousel({ slides, intervalMs: 1000 }));
    act(() => vi.advanceTimersByTime(3000));
    expect(result.current.index).toBe(0);
  });

  it("AdZone: pause quand inactive et repart de la première slide", () => {
    const { result, rerender } = renderHook(
      ({ active }) => useAdCarousel({ slides, active, intervalMs: 1000 }),
      { initialProps: { active: true } },
    );
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.index).toBe(1);
    rerender({ active: false });
    // Réinitialisé et figé.
    expect(result.current.index).toBe(0);
    act(() => vi.advanceTimersByTime(5000));
    expect(result.current.index).toBe(0);
  });

  it("AdZone: liste vide — pas de crash, current undefined", () => {
    const { result } = renderHook(() => useAdCarousel({ slides: [], intervalMs: 1000 }));
    expect(result.current.current).toBeUndefined();
    act(() => vi.advanceTimersByTime(5000));
    expect(result.current.index).toBe(0);
  });

  it("AdZone: une seule slide — aucune rotation", () => {
    const { result } = renderHook(() =>
      useAdCarousel({ slides: [slides[0]!], intervalMs: 1000 }),
    );
    act(() => vi.advanceTimersByTime(5000));
    expect(result.current.index).toBe(0);
  });
});
