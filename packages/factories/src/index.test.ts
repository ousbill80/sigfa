import { describe, it, expect } from "vitest";
import { factoriesVersion } from "./index.js";

describe("@sigfa/factories", () => {
  it("exports factoriesVersion", () => {
    expect(factoriesVersion).toBe("0.0.0");
  });
});
