/**
 * MSW 2.x Node server for tests.
 * @module test/msw-server
 */
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";

/** Default handlers — Prism mock base URL */
export const defaultHandlers = [
  http.get("http://localhost:4010/health", () => {
    return HttpResponse.json({ status: "ok" });
  }),
  http.post("http://localhost:4010/auth/login", () => {
    return HttpResponse.json({
      access_token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyXzEiLCJyb2xlIjoiQUdFTlQiLCJ0ZW5hbnRJZCI6InRlbmFudF8xIiwiZXhwIjo5OTk5OTk5OTk5fQ.mock_sig",
      refresh_token: "refresh_mock_token",
      expires_in: 900,
    });
  }),
  http.post("http://localhost:4010/auth/refresh", () => {
    return HttpResponse.json({
      access_token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyXzEiLCJyb2xlIjoiQUdFTlQiLCJ0ZW5hbnRJZCI6InRlbmFudF8xIiwiZXhwIjo5OTk5OTk5OTk5fQ.new_mock_sig",
      refresh_token: "new_refresh_mock_token",
      expires_in: 900,
    });
  }),
];

export const server = setupServer(...defaultHandlers);
