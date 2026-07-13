/**
 * NOTIF-005-B — tests for the PWA i18n namespace.
 * @module lib/pwa/pwa-i18n.test
 */
import { describe, it, expect } from "vitest";
import { pt, PWA_FR, PWA_EN, PWA_LOCALES, PWA_LOCALES_MAP } from "./pwa-i18n";

describe("NOTIF-005-B: PWA i18n (pwa.* namespace, FR/EN only)", () => {
  it("exposes exactly two locales fr and en", () => {
    expect([...PWA_LOCALES]).toEqual(["fr", "en"]);
  });

  it("FR and EN share the exact same key set (no missing translation)", () => {
    const frKeys = Object.keys(PWA_FR).sort();
    const enKeys = Object.keys(PWA_EN).sort();
    expect(enKeys).toEqual(frKeys);
  });

  it("every key is namespaced under pwa.*", () => {
    for (const key of Object.keys(PWA_FR)) {
      expect(key.startsWith("pwa.")).toBe(true);
    }
  });

  it("contains no emoji in any locale (design bar)", () => {
    const emoji = /\p{Extended_Pictographic}/u;
    for (const dict of [PWA_FR, PWA_EN]) {
      for (const value of Object.values(dict)) {
        expect(emoji.test(value)).toBe(false);
      }
    }
  });

  it("resolves a key in the requested locale", () => {
    expect(pt("pwa.confirm.submit", "fr")).toBe("Prendre mon ticket");
    expect(pt("pwa.confirm.submit", "en")).toBe("Get my ticket");
  });

  it("defaults to French when no locale is provided", () => {
    expect(pt("pwa.ticket.eyebrow")).toBe(PWA_FR["pwa.ticket.eyebrow"]);
  });

  it("interpolates {placeholder} variables", () => {
    expect(pt("pwa.ticket.minutes", "fr", { minutes: 8 })).toBe("8 min");
    expect(pt("pwa.service.wait", "en", { minutes: 12 })).toBe("About 12 min wait");
  });

  it("leaves unknown placeholders untouched", () => {
    expect(pt("pwa.service.wait", "fr", { other: 1 })).toContain("{minutes}");
  });

  it("maps locales to their dictionaries", () => {
    expect(PWA_LOCALES_MAP.fr).toBe(PWA_FR);
    expect(PWA_LOCALES_MAP.en).toBe(PWA_EN);
  });
});
