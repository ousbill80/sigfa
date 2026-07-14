/**
 * Tests for agency-label (WEB-002-HDR) — résolution SERVEUR du nom d'agence
 * de rattachement via GET /agencies/{id} (contrat core 1.1.0, AGENT minimum).
 * @module lib/agency-label.test
 */
import { describe, it, expect, vi } from "vitest";
import { resolveAgencyLabel, apiV1Base, type AgencySession } from "./agency-label";

/** Session vérifiée factice. */
function session(agencyIds: string[]): AgencySession {
  return { token: "signed.jwt.token", claims: { agencyIds } };
}

/** Fetch factice répondant 200 { name }. */
function okFetch(name: string): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ id: "a-1", name }),
  }) as unknown as typeof fetch;
}

describe("agency-label — agence de rattachement du bandeau session (WEB-002-HDR)", () => {
  it("WEB-002-HDR: 1 agence → nom résolu via GET /agencies/{id} avec Bearer serveur (S2)", async () => {
    const fetchImpl = okFetch("Agence Plateau");
    const label = await resolveAgencyLabel(session(["agency-1"]), fetchImpl);
    expect(label).toBe("Agence Plateau");
    expect(fetchImpl).toHaveBeenCalledWith(
      `${apiV1Base()}/agencies/agency-1`,
      { headers: { authorization: "Bearer signed.jwt.token" } }
    );
  });

  it("WEB-002-HDR: plusieurs agences → la première + « +N »", async () => {
    const label = await resolveAgencyLabel(
      session(["agency-1", "agency-2", "agency-3"]),
      okFetch("Agence Plateau")
    );
    expect(label).toBe("Agence Plateau +2");
  });

  it("WEB-002-HDR: 0 agence (bank admin) → null sans AUCUN appel réseau", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const label = await resolveAgencyLabel(session([]), fetchImpl);
    expect(label).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("WEB-002-HDR: fail-soft — HTTP non-ok → null (le bandeau ne casse jamais)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: { code: "FORBIDDEN" } }),
    }) as unknown as typeof fetch;
    expect(await resolveAgencyLabel(session(["agency-1"]), fetchImpl)).toBeNull();
  });

  it("WEB-002-HDR: fail-soft — erreur réseau ou nom absent/vide → null", async () => {
    const throwing = vi.fn().mockRejectedValue(new Error("ECONNREFUSED")) as unknown as typeof fetch;
    expect(await resolveAgencyLabel(session(["agency-1"]), throwing)).toBeNull();

    const noName = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: "a-1", name: "" }),
    }) as unknown as typeof fetch;
    expect(await resolveAgencyLabel(session(["agency-1"]), noName)).toBeNull();
  });

  it("WEB-002-HDR: apiV1Base — origine de NEXT_PUBLIC_API_URL + /api/v1 (même dérivation que le proxy /api/rt)", () => {
    expect(apiV1Base({ NEXT_PUBLIC_API_URL: "http://localhost:4010" })).toBe(
      "http://localhost:4010/api/v1"
    );
    expect(apiV1Base({ NEXT_PUBLIC_API_URL: "https://api.sigfa.ci/api/v1" })).toBe(
      "https://api.sigfa.ci/api/v1"
    );
    expect(apiV1Base({})).toBe("http://localhost:4010/api/v1");
  });
});
