/**
 * Tests for admin-errors (WEB-006) — 409 code → human message, no raw code.
 * @module lib/admin-errors.test
 */
import { describe, it, expect } from "vitest";
import {
  translateApiError,
  GENERIC_CONFLICT_MESSAGE,
  GENERIC_ERROR_MESSAGE,
} from "./admin-errors";

describe("admin-errors — traduction", () => {
  it("WEB-006: 409 API → message humain sans code d'erreur", () => {
    const msg = translateApiError({ error: { code: "SERVICE_CODE_EXISTS", message: "raw" } }, true);
    expect(msg).toBe("Ce code de service existe déjà dans cette agence.");
    // Le code brut n'apparaît jamais dans le message rendu.
    expect(msg).not.toContain("SERVICE_CODE_EXISTS");
    expect(msg).not.toContain("_");
  });

  it("WEB-006: agence avec tickets ouverts (409) → message humain", () => {
    const msg = translateApiError({ error: { code: "AGENCY_HAS_OPEN_TICKETS" } }, true);
    expect(msg).toContain("tickets ouverts");
    expect(msg).not.toContain("AGENCY_HAS_OPEN_TICKETS");
  });

  it("MODEL-WEB-A: OPERATION_CODE_DUPLICATE (409) → message humain dédié", () => {
    const msg = translateApiError({ error: { code: "OPERATION_CODE_DUPLICATE" } }, true);
    expect(msg).toBe("Ce code d'opération existe déjà pour ce service.");
    expect(msg).not.toContain("OPERATION_CODE_DUPLICATE");
    expect(msg).not.toContain("_");
  });

  it("MODEL-WEB-A: OPERATION_NOT_FOUND / SERVICE_NOT_FOUND → message humain sans code brut", () => {
    const op = translateApiError({ error: { code: "OPERATION_NOT_FOUND" } }, false);
    expect(op).toContain("opération");
    expect(op).not.toContain("OPERATION_NOT_FOUND");
    const svc = translateApiError({ error: { code: "SERVICE_NOT_FOUND" } }, false);
    expect(svc).toContain("service");
    expect(svc).not.toContain("SERVICE_NOT_FOUND");
  });

  it("WEB-006: code inconnu → fallback humain 409 (jamais le code brut)", () => {
    const msg = translateApiError({ error: { code: "SOME_UNKNOWN_CODE" } }, true);
    expect(msg).toBe(GENERIC_CONFLICT_MESSAGE);
    expect(msg).not.toContain("SOME_UNKNOWN_CODE");
  });

  it("WEB-006: erreur non-409 sans code → message d'erreur générique", () => {
    expect(translateApiError(null, false)).toBe(GENERIC_ERROR_MESSAGE);
    expect(translateApiError(undefined, false)).toBe(GENERIC_ERROR_MESSAGE);
  });
});
