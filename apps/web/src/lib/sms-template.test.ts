/**
 * Tests for sms-template (WEB-006) — variable rendering + contract validation.
 * @module lib/sms-template.test
 */
import { describe, it, expect } from "vitest";
import {
  extractVariables,
  unknownVariables,
  isTemplateValid,
  renderPreview,
  ALLOWED_VARIABLES,
} from "./sms-template";

describe("sms-template — preview & variables", () => {
  it("WEB-006: templates SMS — variables {{ticket}} rendues en preview", () => {
    // La variable ticket du contrat est {{number}} (numéro de ticket).
    const content = "Votre ticket {{number}} est enregistré. Position : {{position}}. Attente : {{estimate}} min.";
    const preview = renderPreview(content);
    // La valeur d'exemple remplace la variable dans la preview rendue.
    expect(preview).toContain("A-047");
    expect(preview).toContain("3");
    expect(preview).toContain("12");
    // Plus aucune accolade de variable connue ne subsiste.
    expect(preview).not.toContain("{{number}}");
    expect(preview).not.toContain("{{position}}");
    expect(preview).not.toContain("{{estimate}}");
  });

  it("WEB-006: variables autorisées = {{number}}, {{position}}, {{estimate}} (LOI du contrat)", () => {
    expect([...ALLOWED_VARIABLES]).toEqual(["number", "position", "estimate"]);
    expect(extractVariables("{{number}} {{position}} {{estimate}}")).toEqual([
      "number",
      "position",
      "estimate",
    ]);
  });

  it("WEB-006: variable hors contrat ({{agentName}}) détectée → invalide (bloque l'envoi 422)", () => {
    const content = "Bonjour {{agentName}}, ticket {{number}}.";
    expect(unknownVariables(content)).toEqual(["agentName"]);
    expect(isTemplateValid(content)).toBe(false);
    // La preview laisse la variable inconnue verbatim (signalée par ailleurs).
    expect(renderPreview(content)).toContain("{{agentName}}");
  });

  it("WEB-006: template valide seulement si 1–160 caractères et variables autorisées", () => {
    expect(isTemplateValid("Ticket {{number}} prêt.")).toBe(true);
    expect(isTemplateValid("")).toBe(false);
    expect(isTemplateValid("a".repeat(161))).toBe(false);
  });
});
