import { describe, it, expect } from "vitest";
import { CI_VERSION } from "./index.js";

describe("@sigfa/ci", () => {
  it("exports CI_VERSION", () => {
    expect(CI_VERSION).toBe("0.0.0");
  });
});
