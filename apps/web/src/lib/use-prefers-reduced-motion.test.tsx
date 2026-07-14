/**
 * Tests for usePrefersReducedMotion — matchMedia optionnel (jsdom), abonnement
 * et désabonnement à la préférence spectateur.
 * @module lib/use-prefers-reduced-motion.test
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { usePrefersReducedMotion, REDUCED_MOTION_QUERY } from "./use-prefers-reduced-motion";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("usePrefersReducedMotion — préférence spectateur", () => {
  it("TV-MEDIA: sans matchMedia (jsdom) — false, aucun crash", () => {
    const { result } = renderHook(() => usePrefersReducedMotion());
    expect(result.current).toBe(false);
  });

  it("TV-MEDIA: matchMedia reduce actif — true, désabonnement au démontage", async () => {
    const removeEventListener = vi.fn();
    const matchMedia = vi.fn((query: string) => ({
      matches: query === REDUCED_MOTION_QUERY,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener,
    }));
    vi.stubGlobal("matchMedia", matchMedia);
    const { result, unmount } = renderHook(() => usePrefersReducedMotion());
    await waitFor(() => expect(result.current).toBe(true));
    unmount();
    expect(removeEventListener).toHaveBeenCalled();
  });

  it("TV-MEDIA: préférence inactive — false (transitions conservées)", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn((query: string) => ({
        matches: false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }))
    );
    const { result } = renderHook(() => usePrefersReducedMotion());
    expect(result.current).toBe(false);
  });
});
