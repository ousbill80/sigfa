/**
 * Login API route — validates credentials and sets httpOnly JWT cookies.
 * @module app/api/auth/login/route
 */
import { NextRequest, NextResponse } from "next/server";

const API_URL = process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:4010";

/** POST /api/auth/login */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = (await request.json()) as { email?: string; password?: string };
    const { email, password } = body;

    if (!email || !password) {
      return NextResponse.json({ error: "Email and password required" }, { status: 400 });
    }

    // Forward to upstream API (Prism mock or real backend)
    const upstream = await fetch(`${API_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    if (!upstream.ok) {
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }

    const data = (await upstream.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };

    const response = NextResponse.json({ ok: true });

    // Set httpOnly cookies
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
      maxAge: 7 * 24 * 60 * 60, // 7 days
      path: "/",
    });

    return response;
  } catch {
    return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
  }
}
