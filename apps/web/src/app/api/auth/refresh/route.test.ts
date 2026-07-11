/**
 * Tests for refresh API route — WEB-001
 * @module app/api/auth/refresh/route.test
 */
import { describe, it, expect } from "vitest";

describe("WEB-001: silent token refresh", () => {
  it("WEB-001: refresh token silencieux — nouveau token obtenu", async () => {
    const res = await fetch("http://localhost:4010/auth/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: "valid_refresh_token" }),
    });
    expect(res.ok).toBe(true);
    const data = (await res.json()) as { access_token: string };
    expect(data.access_token).toBeTruthy();
  });
});
