/**
 * Tests for API health check — WEB-001
 * @module lib/api-health.test
 */
import { describe, it, expect } from "vitest";
import { server } from "@/test/msw-server";
import { http, HttpResponse } from "msw";
import { checkApiHealth } from "./api-health";

describe("WEB-001: état error — API indisponible → page 'Service indisponible' sans crash", () => {
  it("returns ok=true when API is healthy", async () => {
    const result = await checkApiHealth("http://localhost:4010");
    expect(result.ok).toBe(true);
  });

  it("returns ok=false when API returns 500", async () => {
    server.use(
      http.get("http://localhost:4010/health", () => {
        return HttpResponse.json({ error: "Internal Server Error" }, { status: 500 });
      })
    );
    const result = await checkApiHealth("http://localhost:4010");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("500");
  });

  it("returns ok=false when API is unreachable (network error)", async () => {
    server.use(
      http.get("http://localhost:4010/health", () => {
        return HttpResponse.error();
      })
    );
    const result = await checkApiHealth("http://localhost:4010");
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("does not throw even when API completely fails", async () => {
    server.use(
      http.get("http://localhost:4010/health", () => {
        return HttpResponse.error();
      })
    );
    await expect(checkApiHealth("http://localhost:4010")).resolves.toMatchObject({
      ok: false,
    });
  });
});
