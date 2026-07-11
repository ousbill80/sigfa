import { describe, it, expect } from "vitest";
import { DATABASE_VERSION } from "./index.js";

describe("@sigfa/database", () => {
  it("exports DATABASE_VERSION", () => {
    expect(DATABASE_VERSION).toBe("0.0.0");
  });
});
