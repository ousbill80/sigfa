/**
 * Tests for useTvMode — repos↔appel state machine via fake-timers.
 * @module lib/use-tv-mode.test
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTvMode, TV_CALL_WINDOW_MS } from "./use-tv-mode";

describe("useTvMode", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("bascule: repos par défaut sans appel actif", () => {
    const { result } = renderHook(() => useTvMode({ hasActiveCall: false }));
    expect(result.current).toBe("rest");
  });

  it("bascule: appel actif → mode call immédiat", () => {
    const { result } = renderHook(() => useTvMode({ hasActiveCall: true, windowMs: 1000 }));
    expect(result.current).toBe("call");
  });

  it("bascule: après la fenêtre sans nouvel appel → retour au repos", () => {
    const { result, rerender } = renderHook(
      ({ hasActiveCall }) => useTvMode({ hasActiveCall, windowMs: 1000 }),
      { initialProps: { hasActiveCall: true } },
    );
    expect(result.current).toBe("call");
    // L'appel n'est plus actif, mais la scène tient jusqu'à expiration.
    rerender({ hasActiveCall: false });
    expect(result.current).toBe("call");
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current).toBe("rest");
  });

  it("bascule: un nouvel appel ré-arme la fenêtre (reste en call)", () => {
    const { result, rerender } = renderHook(
      ({ hasActiveCall }) => useTvMode({ hasActiveCall, windowMs: 1000 }),
      { initialProps: { hasActiveCall: true } },
    );
    act(() => vi.advanceTimersByTime(800));
    // Nouvel appel avant la fin de fenêtre → réarme.
    rerender({ hasActiveCall: false });
    rerender({ hasActiveCall: true });
    act(() => vi.advanceTimersByTime(800));
    expect(result.current).toBe("call");
    act(() => vi.advanceTimersByTime(200));
    expect(result.current).toBe("rest");
  });

  it("bascule: fenêtre par défaut = 12s", () => {
    expect(TV_CALL_WINDOW_MS).toBe(12000);
    const { result, rerender } = renderHook(
      ({ hasActiveCall }) => useTvMode({ hasActiveCall }),
      { initialProps: { hasActiveCall: true } },
    );
    rerender({ hasActiveCall: false });
    act(() => vi.advanceTimersByTime(TV_CALL_WINDOW_MS - 1));
    expect(result.current).toBe("call");
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBe("rest");
  });
});
