import { describe, it, expect } from "vitest";
import { MOBILE_VERSION } from "./index.js";

describe("@sigfa/mobile", () => {
  it("INFRA-001: exports MOBILE_VERSION", () => {
    expect(MOBILE_VERSION).toBe("0.0.0");
  });
});
