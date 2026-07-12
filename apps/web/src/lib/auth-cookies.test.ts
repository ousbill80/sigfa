// @vitest-environment node
/**
 * Tests for lib/auth-cookies — S4: cookies httpOnly posés depuis les
 * AuthTokens camelCase du contrat.
 * @module lib/auth-cookies.test
 */
import { describe, it, expect } from "vitest";
import { NextResponse } from "next/server";
import { setAuthCookies, REFRESH_COOKIE_MAX_AGE } from "./auth-cookies";

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
