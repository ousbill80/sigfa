import { describe, it, expect } from "vitest";
import {
  UI_VERSION,
  tokens,
  color,
  Button,
  contrastRatio,
  Textarea,
  Select,
  SegmentedControl,
  Spinner,
  Heading,
  PageTitle,
  SectionTitle,
  Overline,
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

  it("re-exports the new design-foundation primitives", () => {
    // forwardRef components are objects; plain function components are functions.
    expect(Textarea).toBeTypeOf("object");
    expect(Select).toBeTypeOf("object");
    for (const C of [
      SegmentedControl,
      Spinner,
      Heading,
      PageTitle,
      SectionTitle,
      Overline,
    ]) {
      expect(C).toBeTypeOf("function");
    }
  });

  it("exposes the mono font token (referenced by the apps)", () => {
    expect(tokens.font.mono).toContain("monospace");
  });
});
