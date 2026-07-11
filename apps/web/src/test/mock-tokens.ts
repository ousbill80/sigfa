/**
 * Mock JWT tokens for tests (not real secrets).
 * @module test/mock-tokens
 */

/** A valid AGENT token (exp far in future, not real) */
export const AGENT_TOKEN =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9." +
  btoa(JSON.stringify({ sub: "u1", role: "AGENT", tenantId: "t1", exp: 9999999999 })).replace(/=/g, "") +
  ".mock";

/** A MANAGER token */
export const MANAGER_TOKEN =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9." +
  btoa(JSON.stringify({ sub: "u2", role: "MANAGER", tenantId: "t1", exp: 9999999999 })).replace(/=/g, "") +
  ".mock";

/** An AUDITOR token */
export const AUDITOR_TOKEN =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9." +
  btoa(JSON.stringify({ sub: "u3", role: "AUDITOR", tenantId: "t1", exp: 9999999999 })).replace(/=/g, "") +
  ".mock";

/** An SUPER_ADMIN token */
export const SUPER_ADMIN_TOKEN =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9." +
  btoa(JSON.stringify({ sub: "u4", role: "SUPER_ADMIN", tenantId: "t1", exp: 9999999999 })).replace(/=/g, "") +
  ".mock";

/** An expired token (exp = 0) */
export const EXPIRED_TOKEN =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9." +
  btoa(JSON.stringify({ sub: "u1", role: "AGENT", tenantId: "t1", exp: 1 })).replace(/=/g, "") +
  ".mock";
