/**
 * Token refresh API route — silent token refresh using refresh_token cookie.
 * @module app/api/auth/refresh/route
 */
import { NextRequest, NextResponse } from "next/server";

const API_URL = process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:4010";

/** POST /api/auth/refresh */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const refreshToken = request.cookies.get("refresh_token")?.value;

  if (!refreshToken) {
    return NextResponse.json({ error: "No refresh token" }, { status: 401 });
  }

  try {
    const upstream = await fetch(`${API_URL}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });

    if (!upstream.ok) {
      // Refresh failed — clear cookies and signal re-login
      const response = NextResponse.json({ error: "Refresh failed" }, { status: 401 });
      response.cookies.delete("access_token");
      response.cookies.delete("refresh_token");
      return response;
    }

    const data = (await upstream.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };

    const response = NextResponse.json({ ok: true });

    response.cookies.set("access_token", data.access_token, {
      httpOnly: true,
      secure: process.env["NODE_ENV"] === "production",
      sameSite: "lax",
      maxAge: data.expires_in,
      path: "/",
    });

    response.cookies.set("refresh_token", data.refresh_token, {
      httpOnly: true,
      secure: process.env["NODE_ENV"] === "production",
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60,
      path: "/",
    });

    return response;
  } catch {
    return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
  }
}
