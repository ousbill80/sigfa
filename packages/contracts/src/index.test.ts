import { describe, it, expect } from "vitest";
import { CONTRACTS_VERSION } from "./index.js";

describe("@sigfa/contracts", () => {
  it("exports CONTRACTS_VERSION", () => {
    expect(CONTRACTS_VERSION).toBe("0.0.0");
  });
});
