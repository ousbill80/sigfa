/**
 * Tests for tv-fullscreen — plein écran natif (Fullscreen API + préfixes
 * webkit, geste utilisateur requis), bouton discret du bandeau, curseur masqué
 * après inactivité (écran public).
 * @module components/tv/tv-fullscreen.test
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import { renderHook } from "@testing-library/react";
import {
  TvFullscreenButton,
  useTvFullscreen,
  useTvIdleCursor,
  TV_CURSOR_IDLE_MS,
} from "./tv-fullscreen";

type FullscreenDoc = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => void;
};
type FullscreenRoot = HTMLElement & { webkitRequestFullscreen?: () => void };

/** Pose/retire `document.fullscreenElement` (jsdom : getter non assignable). */
function setFullscreenElement(el: Element | null): void {
  Object.defineProperty(document, "fullscreenElement", {
    configurable: true,
    get: () => el,
  });
}

afterEach(() => {
  setFullscreenElement(null);
  delete (document.documentElement as FullscreenRoot).webkitRequestFullscreen;
  delete (document as FullscreenDoc).webkitExitFullscreen;
  Reflect.deleteProperty(document.documentElement, "requestFullscreen");
  Reflect.deleteProperty(document, "exitFullscreen");
  vi.useRealTimers();
});

describe("useTvFullscreen — Fullscreen API (geste requis, best-effort)", () => {
  it("TV-PUB: toggle hors plein écran → requestFullscreen() sur documentElement", () => {
    const request = vi.fn(() => Promise.resolve());
    Object.defineProperty(document.documentElement, "requestFullscreen", {
      configurable: true,
      value: request,
    });

    const { result } = renderHook(() => useTvFullscreen());
    expect(result.current.isFullscreen).toBe(false);
    act(() => result.current.toggle());
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("TV-PUB: repli webkitRequestFullscreen quand l'API standard est absente", () => {
    const webkit = vi.fn();
    (document.documentElement as FullscreenRoot).webkitRequestFullscreen = webkit;

    const { result } = renderHook(() => useTvFullscreen());
    act(() => result.current.toggle());
    expect(webkit).toHaveBeenCalledTimes(1);
  });

  it("TV-PUB: fullscreenchange resynchronise l'état (sortie via Échap incluse)", () => {
    const { result } = renderHook(() => useTvFullscreen());
    expect(result.current.isFullscreen).toBe(false);

    setFullscreenElement(document.documentElement);
    act(() => {
      document.dispatchEvent(new Event("fullscreenchange"));
    });
    expect(result.current.isFullscreen).toBe(true);

    setFullscreenElement(null);
    act(() => {
      document.dispatchEvent(new Event("fullscreenchange"));
    });
    expect(result.current.isFullscreen).toBe(false);
  });

  it("TV-PUB: toggle EN plein écran → exitFullscreen()", () => {
    const exit = vi.fn(() => Promise.resolve());
    Object.defineProperty(document, "exitFullscreen", { configurable: true, value: exit });
    setFullscreenElement(document.documentElement);

    const { result } = renderHook(() => useTvFullscreen());
    act(() => result.current.toggle());
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it("TV-PUB: API totalement absente → toggle n'explose pas (fenêtré conservé)", () => {
    const { result } = renderHook(() => useTvFullscreen());
    expect(() => act(() => result.current.toggle())).not.toThrow();
  });
});

describe("useTvIdleCursor — curseur masqué après inactivité", () => {
  it("TV-PUB: inactif après TV_CURSOR_IDLE_MS, réveil au mouvement de souris", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useTvIdleCursor());
    expect(result.current).toBe(false);

    act(() => vi.advanceTimersByTime(TV_CURSOR_IDLE_MS));
    expect(result.current).toBe(true);

    act(() => {
      window.dispatchEvent(new Event("pointermove"));
    });
    expect(result.current).toBe(false);

    // Ré-armement : redevient inactif après un nouveau délai complet.
    act(() => vi.advanceTimersByTime(TV_CURSOR_IDLE_MS));
    expect(result.current).toBe(true);
  });
});

describe("TvFullscreenButton — bouton discret du coin du bandeau", () => {
  it("TV-PUB: clic → onToggle (le geste utilisateur requis par l'API)", () => {
    const onToggle = vi.fn();
    render(<TvFullscreenButton isFullscreen={false} onToggle={onToggle} />);
    fireEvent.click(screen.getByTestId("tv-fullscreen-button"));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("TV-PUB: hors plein écran — libellé accessible « Plein écran » (FR)", () => {
    render(<TvFullscreenButton isFullscreen={false} onToggle={() => undefined} />);
    const button = screen.getByTestId("tv-fullscreen-button");
    expect(button).toHaveAttribute("aria-label", "Plein écran");
    expect(button).toHaveAttribute("data-fullscreen", "off");
  });

  it("TV-PUB: en plein écran — devient « Quitter le plein écran »", () => {
    render(<TvFullscreenButton isFullscreen onToggle={() => undefined} locale="fr" />);
    const button = screen.getByTestId("tv-fullscreen-button");
    expect(button).toHaveAttribute("aria-label", "Quitter le plein écran");
    expect(button).toHaveAttribute("data-fullscreen", "on");
  });

  it("TV-PUB: locale EN — libellés traduits", () => {
    render(<TvFullscreenButton isFullscreen={false} onToggle={() => undefined} locale="en" />);
    expect(screen.getByTestId("tv-fullscreen-button")).toHaveAttribute(
      "aria-label",
      "Full screen"
    );
  });

  it("TV-PUB: masqué à l'inactivité — invisible ET inopérant (écran public)", () => {
    render(<TvFullscreenButton isFullscreen={false} hidden onToggle={() => undefined} />);
    const style = screen.getByTestId("tv-fullscreen-button").getAttribute("style") ?? "";
    expect(style).toContain("opacity: 0");
    expect(style).toContain("pointer-events: none");
  });

  it("TV-PUB: sobre — transparent, pictogramme couleur bandeau, semi-effacé au repos", () => {
    render(<TvFullscreenButton isFullscreen={false} onToggle={() => undefined} />);
    const style = screen.getByTestId("tv-fullscreen-button").getAttribute("style") ?? "";
    expect(style).toContain("background-color: transparent");
    expect(style).toContain("--brand-contrast");
    expect(style).toContain("opacity: 0.55");
  });
});
