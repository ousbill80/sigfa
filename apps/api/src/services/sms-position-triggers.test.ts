/**
 * Tests unitaires — décision d'enfilement SMS de progression (NOTIF-002).
 * Nommage strict : `NOTIF-002: <description>`.
 */

import { describe, it, expect } from "vitest";
import {
  decidePositionSms,
  DEFAULT_SMS_NEAR_THRESHOLD,
  NEAR_SUPPRESSION_WINDOW_MS,
  type PositionSmsType,
} from "src/services/sms-position-triggers.js";

/** Contexte de base sans envoi préalable. */
function ctx(over: Partial<{
  nearThreshold: number;
  alreadyHandled: PositionSmsType[];
  suppressionWindowMs: number;
}> = {}) {
  return {
    nearThreshold: over.nearThreshold ?? DEFAULT_SMS_NEAR_THRESHOLD,
    alreadyHandled: new Set(over.alreadyHandled ?? []),
    ...(over.suppressionWindowMs !== undefined
      ? { suppressionWindowMs: over.suppressionWindowMs }
      : {}),
  };
}

describe("decidePositionSms", () => {
  it("NOTIF-002: position atteint le seuil (3) → POSITION_NEAR (une seule fois)", () => {
    expect(decidePositionSms({ ticketId: "t", position: 3 }, ctx())).toEqual([
      "POSITION_NEAR",
    ]);
  });

  it("NOTIF-002: POSITION_NEAR déjà géré → aucun renvoi (une fois par ticket à vie)", () => {
    const out = decidePositionSms(
      { ticketId: "t", position: 3 },
      ctx({ alreadyHandled: ["POSITION_NEAR"] })
    );
    expect(out).toEqual([]);
  });

  it("NOTIF-002: position 1 → POSITION_NEXT", () => {
    expect(decidePositionSms({ ticketId: "t", position: 1 }, ctx())).toEqual([
      "POSITION_NEXT",
    ]);
  });

  it("NOTIF-002: POSITION_NEXT déjà géré → aucun renvoi", () => {
    const out = decidePositionSms(
      { ticketId: "t", position: 1 },
      ctx({ alreadyHandled: ["POSITION_NEXT"] })
    );
    expect(out).toEqual([]);
  });

  it("NOTIF-002: hors zone proche (position 5, seuil 3) → rien", () => {
    expect(decidePositionSms({ ticketId: "t", position: 5 }, ctx())).toEqual([]);
  });

  it("NOTIF-002: NEAR supprimé si NEXT attendu < 60 s (D3)", () => {
    const out = decidePositionSms(
      { ticketId: "t", position: 3, estimatedMsToNext: 30_000 },
      ctx()
    );
    expect(out).toEqual([]);
  });

  it("NOTIF-002: NEAR conservé si NEXT attendu ≥ 60 s", () => {
    const out = decidePositionSms(
      { ticketId: "t", position: 3, estimatedMsToNext: NEAR_SUPPRESSION_WINDOW_MS },
      ctx()
    );
    expect(out).toEqual(["POSITION_NEAR"]);
  });

  it("NOTIF-002: suppression NEAR ignorée si NEXT déjà géré (évite blocage définitif)", () => {
    const out = decidePositionSms(
      { ticketId: "t", position: 3, estimatedMsToNext: 10_000 },
      ctx({ alreadyHandled: ["POSITION_NEXT"] })
    );
    expect(out).toEqual(["POSITION_NEAR"]);
  });

  it("NOTIF-002: seuil banque configurable (5)", () => {
    expect(
      decidePositionSms({ ticketId: "t", position: 5 }, ctx({ nearThreshold: 5 }))
    ).toEqual(["POSITION_NEAR"]);
  });
});
