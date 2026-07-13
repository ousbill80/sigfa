/**
 * Tests unitaires — rendu templates SMS + fallback (NOTIF-002).
 * Nommage strict : `NOTIF-002: <description>`.
 */

import { describe, it, expect } from "vitest";
import {
  resolveTemplate,
  renderTemplateBody,
  renderSmsTemplate,
  TemplateRenderError,
  type TemplateSource,
} from "src/services/sms-templates-render.js";

/** Source de templates paramétrable en test. */
function source(map: {
  bank?: Record<string, string>;
  global?: Record<string, string>;
}): TemplateSource {
  return {
    loadBankTemplate: (_bankId, type, lang) =>
      Promise.resolve(map.bank?.[`${type}:${lang}`]),
    loadGlobalFallback: (type) => Promise.resolve(map.global?.[type]),
  };
}

describe("resolveTemplate — fallback banque→FR banque→FR global", () => {
  const key = { bankId: "b1", type: "TICKET_CONFIRMATION", lang: "EN" as const };

  it("NOTIF-002: template banque dans la langue demandée retenu en priorité", async () => {
    const s = source({ bank: { "TICKET_CONFIRMATION:EN": "Ticket {{number}}" } });
    const r = await resolveTemplate(s, key);
    expect(r).toEqual({ body: "Ticket {{number}}", lang: "EN" });
  });

  it("NOTIF-002: fallback sur le FR de la banque si la langue demandée manque", async () => {
    const s = source({ bank: { "TICKET_CONFIRMATION:FR": "Billet {{number}}" } });
    const r = await resolveTemplate(s, key);
    expect(r).toEqual({ body: "Billet {{number}}", lang: "FR" });
  });

  it("NOTIF-002: fallback sur le FR GLOBAL seedé en dernier recours", async () => {
    const s = source({ global: { TICKET_CONFIRMATION: "Global {{number}}" } });
    const r = await resolveTemplate(s, key);
    expect(r).toEqual({ body: "Global {{number}}", lang: "FR_GLOBAL" });
  });

  it("NOTIF-002: jamais de corps vide — un body vide est ignoré comme absent", async () => {
    const s = source({
      bank: { "TICKET_CONFIRMATION:EN": "   ", "TICKET_CONFIRMATION:FR": "" },
      global: { TICKET_CONFIRMATION: "Global {{number}}" },
    });
    const r = await resolveTemplate(s, key);
    expect(r.lang).toBe("FR_GLOBAL");
  });

  it("NOTIF-002: aucun template nulle part → TemplateRenderError (jamais corps vide)", async () => {
    await expect(resolveTemplate(source({}), key)).rejects.toBeInstanceOf(TemplateRenderError);
  });
});

describe("renderTemplateBody — substitution stricte", () => {
  it("NOTIF-002: substitue les variables fournies", () => {
    const out = renderTemplateBody("N°{{number}} pos {{position}} ~{{estimate}}", {
      number: "A12",
      position: 3,
      estimate: "10 min",
    });
    expect(out).toBe("N°A12 pos 3 ~10 min");
  });

  it("NOTIF-002: variable manquante → TemplateRenderError (aucun texte cassé)", () => {
    expect(() => renderTemplateBody("pos {{position}}", {})).toThrow(TemplateRenderError);
  });

  it("NOTIF-002: variable inconnue → TemplateRenderError", () => {
    expect(() => renderTemplateBody("{{unknown}}", { number: "x" })).toThrow(
      TemplateRenderError
    );
  });

  it("NOTIF-002: tolère les espaces dans les accolades", () => {
    expect(renderTemplateBody("{{ number }}", { number: "Z9" })).toBe("Z9");
  });
});

describe("renderSmsTemplate — bout en bout", () => {
  it("NOTIF-002: résout + rend, retourne la langue effective", async () => {
    const s = source({ bank: { "TICKET_CONFIRMATION:FR": "N°{{number}}" } });
    const r = await renderSmsTemplate(
      s,
      { bankId: "b1", type: "TICKET_CONFIRMATION", lang: "FR" },
      { number: "B7" }
    );
    expect(r).toEqual({ body: "N°B7", lang: "FR" });
  });
});
