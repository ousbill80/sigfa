/**
 * Tests for useTvMediaManifest — fetch du manifeste + replis (404, réseau,
 * JSON invalide) → playlist vide et l'AdZone promo texte reste affichée.
 * @module lib/use-tv-media.test
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useTvMediaManifest } from "./use-tv-media";

function stubFetch(impl: () => Promise<Response>): ReturnType<typeof vi.fn> {
  const mock = vi.fn(impl);
  vi.stubGlobal("fetch", mock);
  return mock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useTvMediaManifest — chargement du manifeste", () => {
  it("TV-MEDIA: manifeste valide — playlist parsée exposée", async () => {
    stubFetch(async () =>
      new Response(
        JSON.stringify([
          { type: "image", src: "/tv-media/a.svg", durationMs: 5000 },
          { type: "video", src: "/tv-media/b.mp4" },
        ]),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    const { result } = renderHook(() => useTvMediaManifest("/tv-media/manifest.json"));
    await waitFor(() => expect(result.current).toHaveLength(2));
    expect(result.current[0]).toEqual({ type: "image", src: "/tv-media/a.svg", durationMs: 5000 });
  });

  it("TV-MEDIA: repli sans manifeste — 404 → playlist vide (AdZone conservée)", async () => {
    const mock = stubFetch(async () => new Response("not found", { status: 404 }));
    const { result } = renderHook(() => useTvMediaManifest("/tv-media/manifest.json"));
    await waitFor(() => expect(mock).toHaveBeenCalled());
    expect(result.current).toEqual([]);
  });

  it("TV-MEDIA: repli réseau — fetch rejeté → playlist vide, aucun crash", async () => {
    const mock = stubFetch(async () => {
      throw new Error("network down");
    });
    const { result } = renderHook(() => useTvMediaManifest("/tv-media/manifest.json"));
    await waitFor(() => expect(mock).toHaveBeenCalled());
    expect(result.current).toEqual([]);
  });

  it("TV-MEDIA: repli JSON invalide — corps non-JSON → playlist vide", async () => {
    const mock = stubFetch(async () => new Response("<html>oops</html>", { status: 200 }));
    const { result } = renderHook(() => useTvMediaManifest("/tv-media/manifest.json"));
    await waitFor(() => expect(mock).toHaveBeenCalled());
    expect(result.current).toEqual([]);
  });

  it("TV-MEDIA: payload non-tableau — playlist vide (parse tolérant)", async () => {
    const mock = stubFetch(async () =>
      new Response(JSON.stringify({ media: [] }), { status: 200 })
    );
    const { result } = renderHook(() => useTvMediaManifest("/tv-media/manifest.json"));
    await waitFor(() => expect(mock).toHaveBeenCalled());
    expect(result.current).toEqual([]);
  });
});
