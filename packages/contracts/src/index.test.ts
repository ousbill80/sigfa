import { describe, it, expect } from "vitest";
import { contractsVersion } from "./index.js";

describe("@sigfa/contracts", () => {
  it("exports contractsVersion", () => {
    expect(contractsVersion).toBe("0.0.0");
  });
});
