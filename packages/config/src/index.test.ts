import { describe, it, expect } from "vitest";
import { configVersion } from "./index.js";

describe("@sigfa/config", () => {
  it("exports configVersion", () => {
    expect(configVersion).toBe("0.0.0");
  });
});
