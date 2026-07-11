import { describe, it, expect } from "vitest";
import { databaseVersion } from "./index.js";

describe("@sigfa/database", () => {
  it("exports databaseVersion", () => {
    expect(databaseVersion).toBe("0.0.0");
  });
});
