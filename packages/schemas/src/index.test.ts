import { describe, it, expect } from "vitest";
import { schemasVersion } from "./index.js";

describe("@sigfa/schemas", () => {
  it("exports schemasVersion", () => {
    expect(schemasVersion).toBe("0.0.0");
  });
});
