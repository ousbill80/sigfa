/**
 * Tests unitaires — NOTIF-003 : NLU d'intention par RÈGLES/mots-clés (PAS d'IA).
 *
 * Nommage strict : `NOTIF-003: <description>`.
 *
 * @module
 */

import { describe, it, expect } from "vitest";
import {
  classifyIntent,
  buildHelpMessage,
  normalizeInbound,
  type WhatsAppMenuMapping,
} from "src/services/whatsapp/whatsapp-intent.js";

const SVC = "88888888-8888-4888-a888-888888888888";
const mapping: WhatsAppMenuMapping[] = [
  { keyword: "1", serviceId: SVC },
  { keyword: "DEPOT", serviceId: "99999999-9999-4999-a999-999999999999" },
];

describe("whatsapp-intent (règles, pas d'IA)", () => {
  it("NOTIF-003: menu numéroté exact « 1 » → TAKE_TICKET vers son service (C4)", () => {
    expect(classifyIntent("1", mapping)).toEqual({ kind: "TAKE_TICKET", serviceId: SVC });
  });

  it("NOTIF-003: mot-clé menu insensible à la casse « depot » → TAKE_TICKET", () => {
    expect(classifyIntent("Je veux DEPOT svp", mapping)).toEqual({
      kind: "TAKE_TICKET",
      serviceId: "99999999-9999-4999-a999-999999999999",
    });
  });

  it("NOTIF-003: « état de mon ticket » → CHECK_STATUS", () => {
    expect(classifyIntent("quel est l'état de mon ticket ?", mapping)).toEqual({
      kind: "CHECK_STATUS",
    });
  });

  it("NOTIF-003: « position » (EN/FR) → CHECK_STATUS", () => {
    expect(classifyIntent("my position please", mapping)).toEqual({ kind: "CHECK_STATUS" });
  });

  it("NOTIF-003: « prendre un ticket » sans service résolu → HELP (jamais de service deviné)", () => {
    expect(classifyIntent("je veux prendre un ticket", mapping)).toEqual({ kind: "HELP" });
  });

  it("NOTIF-003: message ambigu/non reconnu → HELP", () => {
    expect(classifyIntent("bonjour ça va ?", mapping)).toEqual({ kind: "HELP" });
  });

  it("NOTIF-003: message vide → HELP", () => {
    expect(classifyIntent("   ", mapping)).toEqual({ kind: "HELP" });
  });

  it("NOTIF-003: message d'aide FR liste les mots-clés du menu + « état »", () => {
    const help = buildHelpMessage("FR", mapping);
    expect(help).toContain("1");
    expect(help).toContain("DEPOT");
    expect(help.toLowerCase()).toContain("état");
  });

  it("NOTIF-003: message d'aide EN mentionne status et les mots-clés", () => {
    const help = buildHelpMessage("EN", mapping);
    expect(help.toLowerCase()).toContain("status");
    expect(help).toContain("DEPOT");
  });

  it("NOTIF-003: aide sans mapping → message dégradé (aucun service disponible)", () => {
    expect(buildHelpMessage("FR", []).toLowerCase()).toContain("aucun service");
    expect(buildHelpMessage("EN", []).toLowerCase()).toContain("no service");
  });

  it("NOTIF-003: normalizeInbound compacte casse/espaces", () => {
    expect(normalizeInbound("  Prendre   UN Ticket ")).toBe("prendre un ticket");
  });
});
