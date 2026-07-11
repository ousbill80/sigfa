import { describe, it, expect } from "vitest";
import { uiVersion } from "./index.js";

describe("@sigfa/ui", () => {
  it("exports uiVersion", () => {
    expect(uiVersion).toBe("0.0.0");
  });
});
