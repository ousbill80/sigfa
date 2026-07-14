// @vitest-environment node
/**
 * Tests for the public /q/[token] PWA page (NOTIF-005-B) — S3 : le shell
 * client reçoit la base proxy same-origin /api/rt (jamais d'URL cross-origin
 * dans l'arbre navigateur ; le flux public ne porte aucun cookie, le proxy
 * relaie sans Bearer).
 * @module app/q/[token]/page.test
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { findElementByType } from "@/test/element-tree";
import { BROWSER_API_BASE } from "@/lib/browser-api";
import PwaTicketPage from "./page";
import { PwaPageClient } from "./pwa-page-client";

describe("NOTIF-005-B/S3: /q/[token] — base API navigateur = proxy /api/rt", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("S3: le shell client reçoit baseUrl /api/rt (relative, same-origin)", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "http://localhost:4010/api/v1");
    const tree = await PwaTicketPage({
      params: Promise.resolve({ token: "tok-123" }),
      searchParams: Promise.resolve({}),
    });
    const client = findElementByType(tree, PwaPageClient);
    expect(client).not.toBeNull();
    expect(client?.props.baseUrl).toBe(BROWSER_API_BASE);
    expect(client?.props.token).toBe("tok-123");
  });

  it("NOTIF-005-B: ?lang=en → locale en, sinon fr", async () => {
    const en = await PwaTicketPage({
      params: Promise.resolve({ token: "tok-123" }),
      searchParams: Promise.resolve({ lang: "en" }),
    });
    expect(findElementByType(en, PwaPageClient)?.props.initialLocale).toBe("en");
    const fr = await PwaTicketPage({
      params: Promise.resolve({ token: "tok-123" }),
      searchParams: Promise.resolve({ lang: "xx" }),
    });
    expect(findElementByType(fr, PwaPageClient)?.props.initialLocale).toBe("fr");
  });
});
