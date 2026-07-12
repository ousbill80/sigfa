/**
 * MSW 2.x Node server for tests.
 *
 * S4 (Boucle 2 F4) : les handlers auth parlent la forme CONTRAT
 * (`packages/contracts/openapi/core.yaml` — AuthTokens/RefreshRequest en
 * camelCase : accessToken/refreshToken/expiresIn). Le snake_case était un
 * désalignement qui posait des cookies `undefined` contre l'API réelle.
 * @module test/msw-server
 */
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";

/** AuthTokens de contrat retournés par le mock login (camelCase = LA LOI). */
export const MOCK_AUTH_TOKENS = {
  accessToken:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyXzEiLCJyb2xlIjoiQUdFTlQiLCJ0ZW5hbnRJZCI6InRlbmFudF8xIiwiZXhwIjo5OTk5OTk5OTk5fQ.mock_sig",
  refreshToken: "refresh_mock_token",
  expiresIn: 900,
} as const;

/** AuthTokens retournés par le mock refresh (rotation). */
export const MOCK_REFRESHED_TOKENS = {
  accessToken:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyXzEiLCJyb2xlIjoiQUdFTlQiLCJ0ZW5hbnRJZCI6InRlbmFudF8xIiwiZXhwIjo5OTk5OTk5OTk5fQ.new_mock_sig",
  refreshToken: "new_refresh_mock_token",
  expiresIn: 900,
} as const;

/** Default handlers — Prism mock base URL */
export const defaultHandlers = [
  http.get("http://localhost:4010/health", () => {
    return HttpResponse.json({ status: "ok" });
  }),
  http.post("http://localhost:4010/auth/login", () => {
    return HttpResponse.json(MOCK_AUTH_TOKENS);
  }),
  http.post("http://localhost:4010/auth/refresh", () => {
    return HttpResponse.json(MOCK_REFRESHED_TOKENS);
  }),
];

export const server = setupServer(...defaultHandlers);
