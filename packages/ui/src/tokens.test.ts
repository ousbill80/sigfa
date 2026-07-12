import { describe, it, expect } from "vitest";
import { tokens, color, fontSize, radius, space, font } from "./tokens.js";

describe("design tokens", () => {
  it("every colour token is a valid hex string", () => {
    for (const [name, value] of Object.entries(color)) {
      expect(value, name).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  it("exposes the « Or & Forêt » brand trio", () => {
    expect(color["--brand"]).toBe("#C25A16");
    expect(color["--forest"]).toBe("#0F6B4A");
    expect(color["--gold"]).toBe("#C79A3A");
  });

  it("uses a warm paper base, never clinical grey", () => {
    expect(color["--paper"]).toBe("#FBF8F3");
    expect(color["--ink"]).toBe("#1A130C");
  });

  it("carries the kiosk display size (76px ticket number)", () => {
    expect(fontSize.display).toBe(76);
    expect(fontSize["4xl"]).toBe(49);
  });

  it("has a coherent, assumed radius scale", () => {
    expect(radius.md).toBe(12);
    expect(radius.lg).toBe(18);
    expect(radius.xl).toBe(28);
  });

  it("uses a base-4 spacing scale", () => {
    for (const value of Object.values(space)) {
      expect(value % 4).toBe(0);
    }
  });

  it("makes fonts swappable via a stack (display first, system fallback)", () => {
    expect(font.display).toContain("Clash Display");
    expect(font.display).toContain("ui-sans-serif");
    expect(font.text).toContain("General Sans");
  });

  it("bundles all groups for a mobile RN theme", () => {
    expect(tokens.color).toBe(color);
    expect(tokens.fontSize).toBe(fontSize);
    expect(tokens.radius).toBe(radius);
    expect(tokens.space).toBe(space);
    expect(tokens.font).toBe(font);
    expect(tokens.motion.ease).toContain("cubic-bezier");
  });
});
