import { describe, it, expect } from "vitest";
import { TESTING_VERSION } from "./index.js";

describe("@sigfa/testing", () => {
  it("exports TESTING_VERSION", () => {
    expect(TESTING_VERSION).toBe("0.0.0");
  });
});
