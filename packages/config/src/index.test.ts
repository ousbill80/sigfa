import { describe, it, expect } from "vitest";
import { CONFIG_VERSION } from "./index.js";

describe("@sigfa/config", () => {
  it("INFRA-001: exports CONFIG_VERSION", () => {
    expect(CONFIG_VERSION).toBe("0.0.0");
  });
});
