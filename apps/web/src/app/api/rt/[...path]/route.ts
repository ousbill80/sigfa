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
 * Depuis le fix « /dashboard vide » (S3), `/api/rt` est la porte API UNIQUE du
 * navigateur (lib/browser-api) dans les DEUX modes RT-001b :
 * - mode real : upstream = origine de `NEXT_PUBLIC_API_URL` + `/api/v1` ;
 * - mode off  : upstream = base mock Prism VERBATIM (les bundles Prism servent
 *   les chemins nus, sans préfixe /api/v1).
 *
 * @module app/api/rt/[...path]/route
 */
import { NextRequest, NextResponse } from "next/server";
import { resolveRealtimeMode, restApiBase } from "@/lib/realtime-env";

/**
 * Base upstream selon le mode (RT-001b).
 * - real : origine de l'env + préfixe /api/v1 (dérivation miroir de
 *   lib/agency-label#apiV1Base) ;
 * - off  : base d'env verbatim (mock Prism, chemins nus).
 */
function upstreamBase(): string {
  const raw = restApiBase().replace(/\/+$/, "");
  if (resolveRealtimeMode() !== "real") return raw;
  try {
    return `${new URL(raw).origin}/api/v1`;
  } catch {
    return raw;
  }
}

/**
 * Bearer factice du mode mock : les bundles OpenAPI sécurisés (Boucle 2)
 * imposent le scheme bearer — Prism valide sa PRÉSENCE, jamais sa valeur.
 * JAMAIS utilisé en mode real (le proxy y relaie le cookie vérifié ou rien).
 */
const MOCK_BEARER = "prism-mock";

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
  const target = `${upstreamBase()}/${path.join("/")}${search}`;

  const headers = new Headers();
  for (const h of FORWARD_HEADERS) {
    const v = request.headers.get(h);
    if (v) headers.set(h, v);
  }
  if (token) {
    headers.set("authorization", `Bearer ${token}`);
  } else if (resolveRealtimeMode() !== "real") {
    headers.set("authorization", `Bearer ${MOCK_BEARER}`);
  }

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
