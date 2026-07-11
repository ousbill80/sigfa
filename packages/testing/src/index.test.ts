import { describe, it, expect } from "vitest";
import { testingVersion } from "./index.js";

describe("@sigfa/testing", () => {
  it("exports testingVersion", () => {
    expect(testingVersion).toBe("0.0.0");
  });
});
