/**
 * NOTIF-005-B — tests for the PWA service catalog.
 * @module lib/pwa/pwa-services.test
 */
import { describe, it, expect } from "vitest";
import { getServices, findService, serviceName, DEMO_SERVICES } from "./pwa-services";

describe("NOTIF-005-B: pwa-services catalog", () => {
  it("exposes a non-empty catalog", () => {
    expect(getServices().length).toBeGreaterThan(0);
    expect(getServices()).toBe(DEMO_SERVICES);
  });

  it("every service id is a UUID (contract serviceId format)", () => {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    for (const s of getServices()) {
      expect(uuid.test(s.id)).toBe(true);
    }
  });

  it("provides FR and EN names for every service (no emoji)", () => {
    const emoji = /\p{Extended_Pictographic}/u;
    for (const s of getServices()) {
      expect(s.name.fr.length).toBeGreaterThan(0);
      expect(s.name.en.length).toBeGreaterThan(0);
      expect(emoji.test(s.name.fr + s.name.en)).toBe(false);
    }
  });

  it("includes at least one closed service (design: closed state)", () => {
    expect(getServices().some((s) => !s.isOpen)).toBe(true);
  });

  it("findService returns the matching service or undefined", () => {
    const first = getServices()[0]!;
    expect(findService(getServices(), first.id)).toBe(first);
    expect(findService(getServices(), "nope")).toBeUndefined();
  });

  it("serviceName resolves per locale", () => {
    const s = getServices()[0]!;
    expect(serviceName(s, "fr")).toBe(s.name.fr);
    expect(serviceName(s, "en")).toBe(s.name.en);
  });
});
