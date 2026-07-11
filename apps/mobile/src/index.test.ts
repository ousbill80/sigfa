import { describe, it, expect } from "vitest";
import { mobileVersion } from "./index.js";

describe("@sigfa/mobile", () => {
  it("exports mobileVersion", () => {
    expect(mobileVersion).toBe("0.0.0");
  });
});
