/**
 * AUDIT-F7 — Tests TDD pour useScrollAffordance.ts
 * Écrits AVANT l'implémentation (phase rouge).
 *
 * Un client DEBOUT devant la borne ne sait pas qu'il y a du contenu sous le
 * pli : le hook mesure la région scrollable et expose `canScrollDown` (vrai
 * tant qu'il reste du contenu en dessous, faux en fin de scroll) pour piloter
 * l'affordance visuelle (dégradé + chevron).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import { useScrollAffordance } from "@/hooks/useScrollAffordance";

/** Sonde minimale : région scrollable + drapeau lisible dans le DOM. */
function Probe() {
  const { scrollRef, canScrollDown, onScroll, recompute } =
    useScrollAffordance<HTMLDivElement>();
  return (
    <div>
      <div data-testid="region" ref={scrollRef} onScroll={onScroll} />
      <span data-testid="flag">{canScrollDown ? "down" : "end"}</span>
      <button data-testid="recompute" onClick={recompute} />
    </div>
  );
}

/** Simule les dimensions de scroll (jsdom ne mesure pas la mise en page). */
function setScrollMetrics(
  el: HTMLElement,
  { scrollHeight, clientHeight, scrollTop }: {
    scrollHeight: number;
    clientHeight: number;
    scrollTop: number;
  }
) {
  Object.defineProperty(el, "scrollHeight", { value: scrollHeight, configurable: true });
  Object.defineProperty(el, "clientHeight", { value: clientHeight, configurable: true });
  Object.defineProperty(el, "scrollTop", {
    value: scrollTop,
    writable: true,
    configurable: true,
  });
}

describe("AUDIT-F7: useScrollAffordance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("AUDIT-F7: sans débordement → pas d'affordance", () => {
    render(<Probe />);
    expect(screen.getByTestId("flag")).toHaveTextContent("end");
  });

  it("AUDIT-F7: contenu sous le pli → canScrollDown vrai après recompute", () => {
    render(<Probe />);
    const region = screen.getByTestId("region");
    setScrollMetrics(region, { scrollHeight: 1200, clientHeight: 600, scrollTop: 0 });
    act(() => {
      fireEvent.click(screen.getByTestId("recompute"));
    });
    expect(screen.getByTestId("flag")).toHaveTextContent("down");
  });

  it("AUDIT-F7: fin de scroll (à ≤ 8 px près) → l'affordance disparaît", () => {
    render(<Probe />);
    const region = screen.getByTestId("region");
    setScrollMetrics(region, { scrollHeight: 1200, clientHeight: 600, scrollTop: 0 });
    act(() => {
      fireEvent.scroll(region);
    });
    expect(screen.getByTestId("flag")).toHaveTextContent("down");

    // Le client atteint le bas (tolérance sous-pixel ≤ 8 px).
    setScrollMetrics(region, { scrollHeight: 1200, clientHeight: 600, scrollTop: 595 });
    act(() => {
      fireEvent.scroll(region);
    });
    expect(screen.getByTestId("flag")).toHaveTextContent("end");
  });

  it("AUDIT-F7: re-mesure au resize fenêtre (rotation / résolution borne)", () => {
    render(<Probe />);
    const region = screen.getByTestId("region");
    expect(screen.getByTestId("flag")).toHaveTextContent("end");
    setScrollMetrics(region, { scrollHeight: 1200, clientHeight: 600, scrollTop: 0 });
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    expect(screen.getByTestId("flag")).toHaveTextContent("down");
  });

  it("AUDIT-F7: le listener resize est retiré au démontage (borne allumée 12 h/j — zéro fuite)", () => {
    const removeSpy = vi.spyOn(window, "removeEventListener");
    const { unmount } = render(<Probe />);
    unmount();
    expect(
      removeSpy.mock.calls.some(([eventName]) => eventName === "resize")
    ).toBe(true);
    removeSpy.mockRestore();
  });

  it("AUDIT-F7: ResizeObserver (Electron) → observe la région ET son contenu, déconnecté au démontage", () => {
    const observed: Element[] = [];
    const disconnect = vi.fn();
    class FakeResizeObserver {
      observe(el: Element) {
        observed.push(el);
      }
      unobserve() {}
      disconnect = disconnect;
    }
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    try {
      function ProbeWithContent() {
        const { scrollRef, canScrollDown, onScroll } =
          useScrollAffordance<HTMLDivElement>();
        return (
          <div>
            <div data-testid="region" ref={scrollRef} onScroll={onScroll}>
              <span>contenu</span>
            </div>
            <span data-testid="flag">{canScrollDown ? "down" : "end"}</span>
          </div>
        );
      }
      const { unmount } = render(<ProbeWithContent />);
      const region = screen.getByTestId("region");
      // La région ET son premier enfant (le contenu qui grandit) sont suivis.
      expect(observed).toContain(region);
      expect(observed).toContain(region.firstElementChild);
      unmount();
      expect(disconnect).toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("AUDIT-F7: sans région attachée (ref nulle) → jamais d'affordance, jamais de crash", () => {
    function DetachedProbe() {
      const { canScrollDown, recompute } = useScrollAffordance<HTMLDivElement>();
      return (
        <div>
          <span data-testid="flag">{canScrollDown ? "down" : "end"}</span>
          <button data-testid="recompute" onClick={recompute} />
        </div>
      );
    }
    render(<DetachedProbe />);
    act(() => {
      fireEvent.click(screen.getByTestId("recompute"));
    });
    expect(screen.getByTestId("flag")).toHaveTextContent("end");
  });
});
