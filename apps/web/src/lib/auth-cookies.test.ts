// @vitest-environment node
/**
 * Tests for lib/auth-cookies — S4: cookies httpOnly posés depuis les
 * AuthTokens camelCase du contrat.
 * @module lib/auth-cookies.test
 */
import { describe, it, expect } from "vitest";
import { NextResponse } from "next/server";
import { setAuthCookies, clearAuthCookies, REFRESH_COOKIE_MAX_AGE } from "./auth-cookies";

describe("S4: setAuthCookies — forme contrat (camelCase)", () => {
  it("pose access_token/refresh_token httpOnly avec maxAge = expiresIn", () => {
    const response = setAuthCookies(NextResponse.json({ ok: true }), {
      accessToken: "access.jwt.value",
      refreshToken: "refresh.jwt.value",
      expiresIn: 900,
    });
    const access = response.cookies.get("access_token");
    const refresh = response.cookies.get("refresh_token");
    expect(access?.value).toBe("access.jwt.value");
    expect(access?.httpOnly).toBe(true);
    expect(access?.sameSite).toBe("lax");
    expect(access?.maxAge).toBe(900);
    expect(access?.path).toBe("/");
    expect(refresh?.value).toBe("refresh.jwt.value");
    expect(refresh?.httpOnly).toBe(true);
    expect(refresh?.maxAge).toBe(REFRESH_COOKIE_MAX_AGE);
  });
});

describe("WEB-002-HDR: clearAuthCookies — purge de session", () => {
  it("vide access_token et refresh_token avec maxAge 0 (httpOnly, path /)", () => {
    const response = clearAuthCookies(NextResponse.json({ ok: true }));
    for (const name of ["access_token", "refresh_token"] as const) {
      const cookie = response.cookies.get(name);
      expect(cookie?.value).toBe("");
      expect(cookie?.maxAge).toBe(0);
      expect(cookie?.httpOnly).toBe(true);
      expect(cookie?.path).toBe("/");
    }
  });
});
