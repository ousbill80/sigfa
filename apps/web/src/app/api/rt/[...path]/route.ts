/**
 * Proxy authentifié same-origin (RT-003) — `/api/rt/*` → API réelle `/api/v1/*`.
 *
 * Le token JWT web vit dans un cookie httpOnly (invisible au JS client). Les
 * surfaces authentifiées (dashboard agent) ne peuvent donc pas porter le Bearer
 * elles-mêmes. Ce route handler serveur relaie chaque appel de CONTRAT verbatim
 * vers l'API réelle en injectant `Authorization: Bearer <access_token>` depuis le
 * cookie. Aucune route hors contrat n'est fabriquée : le chemin est repris tel
 * quel sous `/api/v1` (C1). Les en-têtes de contrat (X-Idempotency-Key) sont
 * transmis.
 *
 * @module app/api/rt/[...path]/route
 */
import { NextRequest, NextResponse } from "next/server";

/** Origine de l'API réelle (racine, on préfixe /api/v1 nous-mêmes). */
function apiOrigin(): string {
  const raw = process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:4010";
  try {
    return new URL(raw).origin;
  } catch {
    return raw;
  }
}

/** En-têtes de contrat autorisés à traverser le proxy. */
const FORWARD_HEADERS = ["content-type", "x-idempotency-key"] as const;

/**
 * Relaie une requête vers l'API réelle en injectant le Bearer du cookie.
 * @param request - Requête entrante same-origin.
 * @param path    - Segments du chemin de contrat (sous /api/v1).
 * @returns Réponse de l'API réelle (statut + corps relayés).
 */
async function proxy(request: NextRequest, path: string[]): Promise<NextResponse> {
  const token = request.cookies.get("access_token")?.value;
  const search = request.nextUrl.search;
  const target = `${apiOrigin()}/api/v1/${path.join("/")}${search}`;

  const headers = new Headers();
  for (const h of FORWARD_HEADERS) {
    const v = request.headers.get(h);
    if (v) headers.set(h, v);
  }
  if (token) headers.set("authorization", `Bearer ${token}`);

  const method = request.method;
  const body =
    method === "GET" || method === "HEAD" ? undefined : await request.text();

  try {
    const upstream = await fetch(target, {
      method,
      headers,
      ...(body !== undefined && body.length > 0 ? { body } : {}),
    });
    const text = await upstream.text();
    return new NextResponse(text, {
      status: upstream.status,
      headers: {
        "content-type": upstream.headers.get("content-type") ?? "application/json",
      },
    });
  } catch {
    return NextResponse.json({ error: "UPSTREAM_UNAVAILABLE" }, { status: 502 });
  }
}

/** GET proxy. */
export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ path: string[] }> }
): Promise<NextResponse> {
  return proxy(request, (await ctx.params).path);
}

/** POST proxy. */
export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ path: string[] }> }
): Promise<NextResponse> {
  return proxy(request, (await ctx.params).path);
}

/** PATCH proxy. */
export async function PATCH(
  request: NextRequest,
  ctx: { params: Promise<{ path: string[] }> }
): Promise<NextResponse> {
  return proxy(request, (await ctx.params).path);
}

/** DELETE proxy. */
export async function DELETE(
  request: NextRequest,
  ctx: { params: Promise<{ path: string[] }> }
): Promise<NextResponse> {
  return proxy(request, (await ctx.params).path);
}
