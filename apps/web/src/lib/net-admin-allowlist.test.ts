/**
 * Tests for net-admin-allowlist (NET-001-WEB) — the client double-defence.
 *
 * Proves the allow-list drops every non-whitelisted field (incl. PII) and that
 * the synthesis is derived only from whitelisted counters — a raw business row
 * or a leaked PII field never reaches the view model.
 * @module lib/net-admin-allowlist.test
 */
import { describe, it, expect } from "vitest";
import {
  sanitizeNetworkOverview,
  sanitizeBankRow,
  emptyNetworkView,
  BANK_ALLOWED_FIELDS,
  FORBIDDEN_PII_FIELDS,
  type NetworkBankRow,
} from "./net-admin-allowlist";

const BANK_A = "11111111-1111-4111-a111-111111111111";
const BANK_B = "22222222-2222-4222-a222-222222222222";

describe("NET-001: allow-list client (double défense)", () => {
  it("NET-001: allow-list rejette tout champ non whitelisté (PII jamais rendue même si présente en réponse)", () => {
    const raw = {
      bankId: BANK_A,
      bankLabel: "Banque Nationale",
      agencyCount: 24,
      kiosksOnline: 40,
      kiosksOffline: 2,
      totalTickets: 45230,
      uptimePercent: 99.4,
      health: "VERT",
      // Champs PII / métier injectés par erreur — DOIVENT être ignorés :
      phone: "+2250700000000",
      trackingId: "trk_secret",
      feedback: "client mécontent",
      displayNumber: "A042",
      agentName: "Kofi A.",
      conseiller: "Awa T.",
      tickets: [{ id: "t1" }],
    };
    const row = sanitizeBankRow(raw) as NetworkBankRow;
    const keys = Object.keys(row);
    // Le view model ne contient QUE les champs whitelistés.
    expect(keys.sort()).toEqual([...BANK_ALLOWED_FIELDS].sort());
    // Aucun champ PII interdit ne survit.
    for (const forbidden of FORBIDDEN_PII_FIELDS) {
      expect(keys).not.toContain(forbidden);
    }
    // Sérialisation complète : aucune trace de valeur PII.
    const serialized = JSON.stringify(row);
    expect(serialized).not.toContain("trk_secret");
    expect(serialized).not.toContain("Kofi");
    expect(serialized).not.toContain("mécontent");
  });

  it("NET-001: sanitizeNetworkOverview mappe agrégats/compteurs uniquement + synthèse dérivée", () => {
    const view = sanitizeNetworkOverview({
      period: "2026-07",
      generatedAt: "2026-07-12T09:00:00Z",
      aggregate: { totalTickets: 90000, agencyCount: 40, bankCount: 2 },
      banks: [
        { bankId: BANK_A, bankLabel: "Banque A", agencyCount: 24, kiosksOnline: 40, kiosksOffline: 2, totalTickets: 45230, uptimePercent: 99.4, health: "VERT", phone: "x" },
        { bankId: BANK_B, bankLabel: "Banque B", agencyCount: 16, kiosksOnline: 18, kiosksOffline: 6, totalTickets: 30100, uptimePercent: 91.2, health: "ROUGE" },
      ],
    });
    expect(view.period).toBe("2026-07");
    expect(view.banks).toHaveLength(2);
    expect(view.synthesis.bankCount).toBe(2);
    expect(view.synthesis.agencyCount).toBe(40);
    expect(view.synthesis.kiosksOnline).toBe(58);
    expect(view.synthesis.kiosksOffline).toBe(8);
    // taux muet = 8 / 66 = 12.1%
    expect(view.synthesis.mutedRatePercent).toBeCloseTo(12.1, 1);
    // 1 banque ROUGE => 1 incident ouvert.
    expect(view.synthesis.openIncidents).toBe(1);
    expect(JSON.stringify(view)).not.toContain("phone");
  });

  it("NET-001: banques sans identité (bankId/bankLabel manquants) sont écartées", () => {
    expect(sanitizeBankRow({ bankLabel: "X" })).toBeNull();
    expect(sanitizeBankRow({ bankId: BANK_A })).toBeNull();
    expect(sanitizeBankRow(null)).toBeNull();
    expect(sanitizeBankRow("nope")).toBeNull();
  });

  it("NET-001: forme inattendue → view vide et sûre (jamais d'exception)", () => {
    expect(sanitizeNetworkOverview(null)).toEqual(emptyNetworkView());
    expect(sanitizeNetworkOverview("garbage").banks).toHaveLength(0);
    const noBanks = sanitizeNetworkOverview({ period: "2026-07", generatedAt: "z" });
    expect(noBanks.banks).toHaveLength(0);
    expect(noBanks.synthesis.mutedRatePercent).toBe(0);
  });

  it("NET-001: uptime/health absents ou invalides → null (pas de valeur inventée)", () => {
    const row = sanitizeBankRow({
      bankId: BANK_A,
      bankLabel: "Banque A",
      uptimePercent: 250,
      health: "MYSTERE",
    }) as NetworkBankRow;
    expect(row.uptimePercent).toBeNull();
    expect(row.health).toBeNull();
    expect(row.agencyCount).toBe(0);
  });
});
