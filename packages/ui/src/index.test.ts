import { describe, it, expect } from "vitest";
import {
  UI_VERSION,
  tokens,
  color,
  Button,
  contrastRatio,
} from "./index.js";

describe("@sigfa/ui public entry", () => {
  it("exposes the v2 version", () => {
    expect(UI_VERSION).toBe("2.0.0");
  });

  it("re-exports the token bundle with the brand hex", () => {
    expect(tokens.color).toBe(color);
    expect(color["--brand"]).toBe("#C25A16");
  });

  it("re-exports components and utilities", () => {
    // Button is a forwardRef object; contrastRatio is a function.
    expect(Button).toBeTypeOf("object");
    expect(contrastRatio).toBeTypeOf("function");
  });
});
