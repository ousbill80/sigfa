/**
 * Tests unitaires de l'allow-list réseau cross-tenant — NET-001-API.
 *
 * Vérifie la FRONTIÈRE D'ANONYMISATION : la sérialisation ne produit QUE des clés
 * en allow-list (compteurs/agrégats), JAMAIS de PII, quelles que soient les entrées
 * brutes (même si on tente d'injecter des champs PII via un objet enrichi).
 *
 * @module
 */

import { describe, it, expect } from "vitest";
import {
  toBankAggregate,
  toNetworkAggregate,
  toNetworkOverview,
  deriveHealth,
  deriveUptimePercent,
  BANK_AGGREGATE_ALLOWED_KEYS,
  NETWORK_OVERVIEW_ALLOWED_KEYS,
  FORBIDDEN_PII_KEY_PATTERNS,
  type RawBankAggregate,
  type RawNetworkAggregate,
} from "./network-overview-allowlist.js";

/** Collecte récursivement toutes les clés d'un objet (profondeur incluse). */
function allKeysDeep(value: unknown, acc: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) allKeysDeep(item, acc);
  } else if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      acc.push(k);
      allKeysDeep(v, acc);
    }
  }
  return acc;
}

const rawBank: RawBankAggregate = {
  bankId: "11111111-1111-4111-a111-111111111111",
  bankLabel: "Banque Test",
  agencyCount: 24,
  kiosksOnline: 40,
  kiosksOffline: 2,
  totalTickets: 45230,
};

const rawNetwork: RawNetworkAggregate = {
  totalTickets: 284560,
  avgTma: 13.4,
  avgTmt: 9.1,
  avgTts: 22.5,
  avgTauxAbandon: 6.2,
  avgTauxSLA: 79.8,
  avgOccupation: 66.3,
  agencyCount: 187,
  bankCount: 12,
};

describe("NET-001: allow-list réseau — zéro PII, agrégats/compteurs uniquement", () => {
  it("NET-001: toBankAggregate ne produit QUE les clés en allow-list (aucune clé hors liste)", () => {
    const out = toBankAggregate(rawBank);
    expect(new Set(Object.keys(out))).toEqual(new Set(BANK_AGGREGATE_ALLOWED_KEYS));
  });

  it("NET-001: réponse network-overview = agrégats/compteurs — assertion allow-list : aucun phone, tracking_id, feedback, display_number, nom agent/conseiller", () => {
    const banks = [toBankAggregate(rawBank)];
    const aggregate = toNetworkAggregate(rawNetwork);
    const body = toNetworkOverview("2026-07", aggregate, banks, new Date("2026-07-11T09:00:00Z"));
    const keys = allKeysDeep(body).map((k) => k.toLowerCase());
    for (const forbidden of FORBIDDEN_PII_KEY_PATTERNS) {
      expect(
        keys.some((k) => k.includes(forbidden)),
        `Clé PII/métier interdite présente dans la réponse : ${forbidden}`
      ).toBe(false);
    }
    // Top-level strictement en allow-list.
    expect(new Set(Object.keys(body))).toEqual(new Set(NETWORK_OVERVIEW_ALLOWED_KEYS));
  });

  it("NET-001: une ligne brute enrichie de PII ne fuite AUCUN champ interdit (construction additive)", () => {
    // Simule une ligne SQL polluée par erreur : phone/tracking/display_number/agent.
    const polluted = {
      ...rawBank,
      phone_encrypted: "xxxx",
      tracking_id: "TRK-1",
      display_number: "A-042",
      agent_name: "Jean Dupont",
      feedback: "super",
    } as RawBankAggregate & Record<string, unknown>;
    const out = toBankAggregate(polluted);
    const keys = allKeysDeep(out).map((k) => k.toLowerCase());
    for (const forbidden of FORBIDDEN_PII_KEY_PATTERNS) {
      expect(keys.some((k) => k.includes(forbidden))).toBe(false);
    }
    expect(new Set(Object.keys(out))).toEqual(new Set(BANK_AGGREGATE_ALLOWED_KEYS));
  });

  it("NET-001: deriveHealth — VERT ≤2% muettes, ORANGE ≤10%, ROUGE au-delà, VERT si parc vide", () => {
    expect(deriveHealth(50, 1)).toBe("VERT"); // ~2%
    expect(deriveHealth(90, 8)).toBe("ORANGE"); // ~8%
    expect(deriveHealth(50, 20)).toBe("ROUGE"); // ~28%
    expect(deriveHealth(0, 0)).toBe("VERT"); // parc vide
  });

  it("NET-001: deriveUptimePercent — 100% parc vide, ratio online sinon", () => {
    expect(deriveUptimePercent(0, 0)).toBe(100);
    expect(deriveUptimePercent(40, 10)).toBe(80);
    expect(deriveUptimePercent(3, 1)).toBe(75);
  });

  it("NET-001: compteurs bornés — valeurs négatives/NaN → 0, pourcentages plafonnés à 100", () => {
    const out = toBankAggregate({
      bankId: "b",
      bankLabel: "L",
      agencyCount: -5,
      kiosksOnline: Number.NaN,
      kiosksOffline: -1,
      totalTickets: -10,
    });
    expect(out.agencyCount).toBe(0);
    expect(out.kiosksOnline).toBe(0);
    expect(out.kiosksOffline).toBe(0);
    expect(out.totalTickets).toBe(0);
    const agg = toNetworkAggregate({ ...rawNetwork, avgTauxSLA: 150, avgTma: -3 });
    expect(agg.avgTauxSLA).toBe(100);
    expect(agg.avgTma).toBe(0);
  });

  it("NET-001: toBankAggregate expose bankId + bankLabel (identité commerciale autorisée, pas une PII)", () => {
    const out = toBankAggregate(rawBank);
    expect(out.bankId).toBe(rawBank.bankId);
    expect(out.bankLabel).toBe(rawBank.bankLabel);
  });
});
