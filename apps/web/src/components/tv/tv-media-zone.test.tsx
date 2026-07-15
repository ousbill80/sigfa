/**
 * Tests for TvMediaZone — enchaînement image→vidéo, skip d'un média en échec,
 * repli quand tout échoue, fondu 400ms + reduced-motion, attributs vidéo.
 * @module components/tv/tv-media-zone.test
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import { TvMediaZone } from "./tv-media-zone";
import { TV_MEDIA_DEFAULT_DURATION_MS, TV_MEDIA_FADE_MS, type TvMediaItem } from "@/lib/tv-media";

const PLAYLIST: readonly TvMediaItem[] = [
  { type: "image", src: "/tv-media/promo-epargne.svg" },
  { type: "video", src: "/tv-media/demo-clip.mp4" },
  { type: "image", src: "/tv-media/promo-credit.svg", durationMs: 5000 },
];

function visibleItem(): HTMLElement {
  const items = screen.getAllByTestId("tv-media-item");
  const shown = items.filter((el) => el.getAttribute("data-visible") === "on");
  expect(shown).toHaveLength(1);
  return shown[0]!;
}

describe("TvMediaZone — enchaînement du carrousel (fake-timers)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("TV-MEDIA: image → vidéo — l'image dure 8 s par défaut puis la vidéo prend la main", () => {
    render(<TvMediaZone items={PLAYLIST} />);
    expect(visibleItem().getAttribute("data-media-type")).toBe("image");
    act(() => vi.advanceTimersByTime(TV_MEDIA_DEFAULT_DURATION_MS));
    expect(visibleItem().getAttribute("data-media-type")).toBe("video");
  });

  it("TV-MEDIA: vidéo sans durationMs — avance à la fin de lecture (ended), boucle infinie", () => {
    render(<TvMediaZone items={PLAYLIST} />);
    act(() => vi.advanceTimersByTime(TV_MEDIA_DEFAULT_DURATION_MS)); // → vidéo
    const video = screen.getByTestId("tv-media-video");
    act(() => {
      fireEvent.ended(video);
    });
    expect(visibleItem().getAttribute("data-media-type")).toBe("image");
    // durationMs explicite (5 s) sur la 3e image, puis boucle vers la 1re.
    act(() => vi.advanceTimersByTime(5000));
    const first = screen.getAllByTestId("tv-media-item")[0]!;
    expect(first.getAttribute("data-visible")).toBe("on");
  });

  it("TV-MEDIA: vidéo avec durationMs — la minuterie borne l'affichage", () => {
    const items: TvMediaItem[] = [
      { type: "video", src: "/tv-media/a.mp4", durationMs: 3000 },
      { type: "image", src: "/tv-media/b.svg" },
    ];
    render(<TvMediaZone items={items} />);
    expect(visibleItem().getAttribute("data-media-type")).toBe("video");
    act(() => vi.advanceTimersByTime(3000));
    expect(visibleItem().getAttribute("data-media-type")).toBe("image");
  });

  it("TV-MEDIA: média en échec — sauté proprement, jamais réaffiché dans la boucle", () => {
    render(<TvMediaZone items={PLAYLIST} />);
    const video = screen.getByTestId("tv-media-video");
    act(() => {
      fireEvent.error(video);
    });
    // La vidéo cassée est démontée de la pile.
    expect(screen.queryByTestId("tv-media-video")).toBeNull();
    // L'image 1 finit son temps puis on passe DIRECTEMENT à l'image 3.
    act(() => vi.advanceTimersByTime(TV_MEDIA_DEFAULT_DURATION_MS));
    expect(visibleItem().getAttribute("data-media-type")).toBe("image");
    const items = screen.getAllByTestId("tv-media-item");
    expect(items).toHaveLength(2);
    expect(visibleItem()).toBe(items[1]);
    // Boucle complète : retour à l'image 1 sans jamais revoir la vidéo.
    act(() => vi.advanceTimersByTime(5000));
    expect(visibleItem()).toBe(screen.getAllByTestId("tv-media-item")[0]);
  });

  it("TV-MEDIA: média courant en échec — avance immédiate sans attendre la minuterie", () => {
    render(<TvMediaZone items={PLAYLIST} />);
    const image = screen.getAllByTestId("tv-media-image")[0]!;
    act(() => {
      fireEvent.error(image);
    });
    expect(visibleItem().getAttribute("data-media-type")).toBe("video");
  });
});

describe("TvMediaZone — replis", () => {
  it("TV-MEDIA: playlist vide — repli promo texte rendu (zéro régression)", () => {
    render(
      <TvMediaZone items={[]} fallback={<div data-testid="promo-texte">Crédit auto</div>} />
    );
    expect(screen.getByTestId("tv-media-fallback")).toBeInTheDocument();
    expect(screen.getByTestId("promo-texte")).toBeInTheDocument();
    expect(screen.queryByTestId("tv-media-zone")).toBeNull();
  });

  it("TV-MEDIA: tous les médias en échec — bascule sur le repli promo texte", () => {
    const items: TvMediaItem[] = [
      { type: "image", src: "/tv-media/a.svg" },
      { type: "image", src: "/tv-media/b.svg" },
    ];
    render(<TvMediaZone items={items} fallback={<div data-testid="promo-texte" />} />);
    for (const img of screen.getAllByTestId("tv-media-image")) {
      act(() => {
        fireEvent.error(img);
      });
    }
    expect(screen.getByTestId("promo-texte")).toBeInTheDocument();
    expect(screen.queryByTestId("tv-media-zone")).toBeNull();
  });
});

describe("TvMediaZone — fondu, reduced-motion, attributs vidéo", () => {
  it("TV-MEDIA: fondu croisé 400ms en --ease sur chaque couche", () => {
    render(<TvMediaZone items={PLAYLIST} />);
    const first = screen.getAllByTestId("tv-media-item")[0]!;
    const style = first.getAttribute("style") ?? "";
    expect(style).toContain(`opacity ${TV_MEDIA_FADE_MS}ms`);
    expect(style).toContain("var(--ease)");
  });

  it("TV-MEDIA: reduced-motion — aucune transition (bascule instantanée)", () => {
    render(<TvMediaZone items={PLAYLIST} reducedMotion />);
    for (const layer of screen.getAllByTestId("tv-media-item")) {
      expect(layer.getAttribute("style")).toContain("transition: none");
    }
  });

  it("TV-MEDIA: vidéo — muted + playsInline + préchargement du média suivant", () => {
    render(<TvMediaZone items={PLAYLIST} />);
    const video = screen.getByTestId("tv-media-video") as HTMLVideoElement;
    expect(video.muted).toBe(true);
    expect(video).toHaveAttribute("playsinline");
    // L'image 1 est affichée : la vidéo (média suivant) est préchargée.
    expect(video).toHaveAttribute("preload", "auto");
  });

  it("TV-MEDIA: la zone ne recouvre jamais la colonne d'appels — pas de z-index élevé, overflow caché", () => {
    render(<TvMediaZone items={PLAYLIST} />);
    const zone = screen.getByTestId("tv-media-zone");
    const style = zone.getAttribute("style") ?? "";
    expect(style).toContain("overflow: hidden");
    expect(style).not.toContain("z-index");
  });

  it("TV-MEDIA: overlays Neutre Premium — lave brand, vignette nuit, lavette papier + pastilles brand-inv", () => {
    render(<TvMediaZone items={PLAYLIST} />);
    expect(screen.getByTestId("tv-media-wash-top")).toBeInTheDocument();
    expect(screen.getByTestId("tv-media-vignette")).toBeInTheDocument();
    expect(screen.getByTestId("tv-media-wash-right")).toBeInTheDocument();
    expect(screen.getByTestId("tv-media-progress")).toBeInTheDocument();
    const dots = screen.getAllByTestId("tv-media-dot");
    expect(dots).toHaveLength(3);
    expect(dots[0]).toHaveAttribute("data-active", "on");
    expect(dots[0]!.getAttribute("style") ?? "").toContain("var(--brand-inv)");
  });
});
