/**
 * Tests for tv-media — manifest URL resolution + tolerant manifest parsing.
 * @module lib/tv-media.test
 */
import { describe, it, expect } from "vitest";
import {
  parseTvMediaManifest,
  tvMediaManifestUrl,
  TV_MEDIA_DEFAULT_DURATION_MS,
  TV_MEDIA_FADE_MS,
  TV_MEDIA_MANIFEST_DEFAULT_URL,
} from "./tv-media";

describe("tvMediaManifestUrl — résolution du manifeste", () => {
  it("TV-MEDIA: sans env — chemin local par défaut /tv-media/manifest.json", () => {
    expect(tvMediaManifestUrl(undefined)).toBe(TV_MEDIA_MANIFEST_DEFAULT_URL);
  });

  it("TV-MEDIA: env vide ou espaces — repli sur le défaut", () => {
    expect(tvMediaManifestUrl("")).toBe(TV_MEDIA_MANIFEST_DEFAULT_URL);
    expect(tvMediaManifestUrl("   ")).toBe(TV_MEDIA_MANIFEST_DEFAULT_URL);
  });

  it("TV-MEDIA: NEXT_PUBLIC_TV_MEDIA_MANIFEST_URL surchargée — URL retournée telle quelle", () => {
    expect(tvMediaManifestUrl("https://cdn.banque.example/tv/manifest.json")).toBe(
      "https://cdn.banque.example/tv/manifest.json"
    );
  });
});

describe("parseTvMediaManifest — parsing tolérant", () => {
  it("TV-MEDIA: manifeste valide — images et vidéos conservées avec durée", () => {
    const items = parseTvMediaManifest([
      { type: "image", src: "/tv-media/a.svg", durationMs: 5000 },
      { type: "video", src: "/tv-media/b.mp4" },
    ]);
    expect(items).toEqual([
      { type: "image", src: "/tv-media/a.svg", durationMs: 5000 },
      { type: "video", src: "/tv-media/b.mp4" },
    ]);
  });

  it("TV-MEDIA: payload non-tableau — playlist vide (repli texte possible)", () => {
    expect(parseTvMediaManifest(null)).toEqual([]);
    expect(parseTvMediaManifest({ items: [] })).toEqual([]);
    expect(parseTvMediaManifest("oops")).toEqual([]);
    expect(parseTvMediaManifest(undefined)).toEqual([]);
  });

  it("TV-MEDIA: entrées invalides filtrées une à une (type inconnu, src vide, non-objet)", () => {
    const items = parseTvMediaManifest([
      { type: "gif", src: "/tv-media/x.gif" },
      { type: "image", src: "" },
      { type: "image", src: "   " },
      { type: "video" },
      42,
      null,
      { type: "image", src: "/tv-media/ok.png" },
    ]);
    expect(items).toEqual([{ type: "image", src: "/tv-media/ok.png" }]);
  });

  it("TV-MEDIA: durationMs invalide (négatif, zéro, NaN, non-nombre) — ignoré, entrée conservée", () => {
    const items = parseTvMediaManifest([
      { type: "image", src: "/a.png", durationMs: -1 },
      { type: "image", src: "/b.png", durationMs: 0 },
      { type: "image", src: "/c.png", durationMs: Number.NaN },
      { type: "image", src: "/d.png", durationMs: "8000" },
    ]);
    expect(items).toHaveLength(4);
    for (const item of items) {
      expect(item.durationMs).toBeUndefined();
    }
  });

  it("TV-MEDIA: src avec espaces — trimée", () => {
    const items = parseTvMediaManifest([{ type: "video", src: "  /tv-media/clip.mp4  " }]);
    expect(items).toEqual([{ type: "video", src: "/tv-media/clip.mp4" }]);
  });

  it("TV-MEDIA: constantes de comportement — image 8s par défaut, fondu 400ms", () => {
    expect(TV_MEDIA_DEFAULT_DURATION_MS).toBe(8000);
    expect(TV_MEDIA_FADE_MS).toBe(400);
  });
});
