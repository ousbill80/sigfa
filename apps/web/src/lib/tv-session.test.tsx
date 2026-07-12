/**
 * Tests for the TV display-token session (RT-003 durcissement).
 *
 * `/tv/{agencyId}` mints a public DISPLAY token via `POST /tv/session { agencyId }`
 * (route publique, aucun Bearer agent, aucune PII) and hands it to the socket
 * handshake. On échec (404 `AGENCY_NOT_FOUND`, réseau, 429) → repli offline :
 * `status="error"`, aucun token, aucun crash. Le token n'est PAS renouvelable
 * (aucun refresh) ; il est re-minté au reload/expiration (TTL 12 h).
 *
 * @module lib/tv-session.test
 */
import { describe, it, expect } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "../test/msw-server";
import {
  parseRetryAfterSeconds,
  TV_SESSION_PATH,
  useTvSession,
} from "./tv-session";

const AGENCY_ID = "33333333-3333-4333-a333-333333333333";
const API = "http://localhost:4010";

function sessionOk(): {
  accessToken: string;
  expiresIn: number;
  agencyId: string;
  role: "DISPLAY";
} {
  return {
    accessToken: "eyJhbGciOiJIUzI1NiJ9.display.sig",
    expiresIn: 43200,
    agencyId: AGENCY_ID,
    role: "DISPLAY",
  };
}

// MSW est démarré/arrêté par le setup global (src/test/setup.ts) ; on ne fait
// que surcharger les handlers par test via server.use().

describe("parseRetryAfterSeconds (backoff 429)", () => {
  it("RT-003: lit details.retryAfterSeconds du corps d'erreur", () => {
    expect(parseRetryAfterSeconds(null, { details: { retryAfterSeconds: 42 } })).toBe(42);
  });

  it("RT-003: lit l'en-tête Retry-After (secondes) à défaut du corps", () => {
    expect(parseRetryAfterSeconds("30", undefined)).toBe(30);
  });

  it("RT-003: le corps prime sur l'en-tête", () => {
    expect(parseRetryAfterSeconds("30", { details: { retryAfterSeconds: 5 } })).toBe(5);
  });

  it("RT-003: valeur absente/non-numérique → null", () => {
    expect(parseRetryAfterSeconds(null, undefined)).toBeNull();
    expect(parseRetryAfterSeconds("abc", {})).toBeNull();
  });
});

describe("useTvSession", () => {
  it("RT-003: mode off → idle, aucun appel réseau, aucun token", async () => {
    let called = false;
    server.use(
      http.post(`${API}${TV_SESSION_PATH}`, () => {
        called = true;
        return HttpResponse.json(sessionOk(), { status: 201 });
      }),
    );
    const { result } = renderHook(() =>
      useTvSession({ agencyId: AGENCY_ID, mode: "off", apiBase: API }),
    );
    // Laisser un tick pour prouver l'absence d'appel.
    await new Promise((r) => setTimeout(r, 50));
    expect(result.current.status).toBe("idle");
    expect(result.current.accessToken).toBeUndefined();
    expect(called).toBe(false);
  });

  it("RT-003: mode real → token DISPLAY obtenu (status ready, token exposé)", async () => {
    let body: unknown = null;
    let hadAuthHeader = false;
    server.use(
      http.post(`${API}${TV_SESSION_PATH}`, async ({ request }) => {
        body = await request.json();
        hadAuthHeader = request.headers.has("authorization");
        return HttpResponse.json(sessionOk(), { status: 201 });
      }),
    );
    const { result } = renderHook(() =>
      useTvSession({ agencyId: AGENCY_ID, mode: "real", apiBase: API }),
    );
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.accessToken).toBe("eyJhbGciOiJIUzI1NiJ9.display.sig");
    // Aucun Bearer agent : c'est une route publique.
    expect(hadAuthHeader).toBe(false);
    // Forme UNIQUE contractualisée du corps.
    expect(body).toEqual({ agencyId: AGENCY_ID });
  });

  it("RT-003: échec 404 AGENCY_NOT_FOUND → status error, aucun token (repli offline)", async () => {
    server.use(
      http.post(`${API}${TV_SESSION_PATH}`, () =>
        HttpResponse.json({ error: { code: "AGENCY_NOT_FOUND" } }, { status: 404 }),
      ),
    );
    const { result } = renderHook(() =>
      useTvSession({ agencyId: AGENCY_ID, mode: "real", apiBase: API }),
    );
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.accessToken).toBeUndefined();
  });

  it("RT-003: échec réseau → status error, pas de crash", async () => {
    server.use(
      http.post(`${API}${TV_SESSION_PATH}`, () => HttpResponse.error()),
    );
    const { result } = renderHook(() =>
      useTvSession({ agencyId: AGENCY_ID, mode: "real", apiBase: API }),
    );
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.accessToken).toBeUndefined();
  });

  it("RT-003: 429 puis 201 → backoff respecté (Retry-After) puis token obtenu", async () => {
    let attempts = 0;
    server.use(
      http.post(`${API}${TV_SESSION_PATH}`, () => {
        attempts += 1;
        if (attempts === 1) {
          return HttpResponse.json(
            { error: { code: "TOO_MANY_REQUESTS", details: { retryAfterSeconds: 0.05 } } },
            { status: 429, headers: { "Retry-After": "0.05" } },
          );
        }
        return HttpResponse.json(sessionOk(), { status: 201 });
      }),
    );
    const { result } = renderHook(() =>
      useTvSession({ agencyId: AGENCY_ID, mode: "real", apiBase: API }),
    );
    await waitFor(() => expect(result.current.status).toBe("ready"), { timeout: 3000 });
    expect(attempts).toBeGreaterThanOrEqual(2);
    expect(result.current.accessToken).toBe("eyJhbGciOiJIUzI1NiJ9.display.sig");
  });
});
