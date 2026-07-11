import { describe, it, expect } from "vitest";
import { ciVersion } from "./index.js";

describe("@sigfa/ci", () => {
  it("exports ciVersion", () => {
    expect(ciVersion).toBe("0.0.0");
  });
});
