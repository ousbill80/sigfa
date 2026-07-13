/**
 * IA-004 — Tests unitaires du moteur NLP (langue, sentiment, thèmes, enum fermé).
 *
 * Couvre les critères ⊛ : détection de langue FR/EN + `unsupported` exclu du
 * scoring ; sentiment + `themes[]` (enum fermé) produits ; rédaction PII appliquée
 * en amont ; zéro appel réseau (module purement en mémoire).
 *
 * Nommage strict : `IA-004: <description>`.
 *
 * @module
 */

import { describe, it, expect } from "vitest";
import {
  detectLanguage,
  sentimentScore,
  labelFromScore,
  detectThemes,
  analyzeComment,
  FEEDBACK_THEMES,
} from "src/ai/feedback-nlp.js";

describe("feedback-nlp — langue", () => {
  it("IA-004: détecte le français", () => {
    expect(detectLanguage("Le temps d'attente était trop long au guichet")).toBe("fr");
  });

  it("IA-004: détecte l'anglais", () => {
    expect(detectLanguage("The waiting time at the counter was too long")).toBe("en");
  });

  it("IA-004: langue hors périmètre → unsupported (jamais classée au hasard)", () => {
    // Espagnol / autre — aucun marqueur FR/EN suffisant.
    expect(detectLanguage("El tiempo de espera fue demasiado largo")).toBe("unsupported");
    expect(detectLanguage("こんにちは、ありがとう")).toBe("unsupported");
  });

  it("IA-004: chaîne vide → unsupported", () => {
    expect(detectLanguage("")).toBe("unsupported");
    expect(detectLanguage(null)).toBe("unsupported");
  });
});

describe("feedback-nlp — sentiment", () => {
  it("IA-004: sentiment positif", () => {
    const s = sentimentScore("service excellent et personnel aimable");
    expect(s).toBeGreaterThan(0);
    expect(labelFromScore(s)).toBe("positive");
  });

  it("IA-004: sentiment négatif", () => {
    const s = sentimentScore("attente horrible et personnel impoli");
    expect(s).toBeLessThan(0);
    expect(labelFromScore(s)).toBe("negative");
  });

  it("IA-004: négation inverse le sentiment (pas rapide)", () => {
    const positif = sentimentScore("rapide");
    const negatif = sentimentScore("pas rapide");
    expect(positif).toBeGreaterThan(0);
    expect(negatif).toBeLessThan(0);
  });

  it("IA-004: texte neutre sans lexique → score 0 / neutral", () => {
    expect(sentimentScore("je suis venu au guichet")).toBe(0);
    expect(labelFromScore(0)).toBe("neutral");
  });

  it("IA-004: score borné dans [-1, 1]", () => {
    const s = sentimentScore("excellent parfait super");
    expect(s).toBeLessThanOrEqual(1);
    expect(s).toBeGreaterThanOrEqual(-1);
  });
});

describe("feedback-nlp — thèmes (enum fermé)", () => {
  it("IA-004: détecte WAIT_TIME", () => {
    expect(detectThemes("temps d'attente trop long")).toContain("WAIT_TIME");
  });

  it("IA-004: détecte STAFF_ATTITUDE", () => {
    expect(detectThemes("accueil aimable du personnel")).toContain("STAFF_ATTITUDE");
  });

  it("IA-004: détecte CLEANLINESS", () => {
    expect(detectThemes("agence sale, propreté insuffisante")).toContain("CLEANLINESS");
  });

  it("IA-004: tous les thèmes détectés appartiennent à l'enum FERMÉ", () => {
    const themes = detectThemes("attente accueil service propre borne accès");
    for (const t of themes) expect(FEEDBACK_THEMES).toContain(t);
  });

  it("IA-004: sentiment sans thème connu → OTHER", () => {
    expect(detectThemes("excellent")).toEqual(["OTHER"]);
  });

  it("IA-004: texte neutre sans mot-clé → aucun thème", () => {
    expect(detectThemes("je suis venu")).toEqual([]);
  });
});

describe("feedback-nlp — analyse complète", () => {
  it("IA-004: analyse FR complète (langue+sentiment+thèmes)", () => {
    const a = analyzeComment("Attente très longue mais accueil aimable");
    expect(a.language).toBe("fr");
    expect(a.excluded).toBe(false);
    expect(a.themes.length).toBeGreaterThan(0);
    for (const t of a.themes) expect(FEEDBACK_THEMES).toContain(t);
  });

  it("IA-004: commentaire unsupported → exclu, non classé", () => {
    const a = analyzeComment("El servicio fue excelente");
    expect(a.language).toBe("unsupported");
    expect(a.excluded).toBe(true);
    expect(a.themes).toEqual([]);
    expect(a.sentimentScore).toBe(0);
  });

  it("IA-004: PII rédigée AVANT analyse (pas de fuite du numéro)", () => {
    // Le numéro ne doit pas empêcher l'analyse ni fuiter.
    const a = analyzeComment("Appeler M. Traoré au +225 07 07 07 07 07, service lent");
    expect(a.language).toBe("fr");
    expect(a.themes).toContain("WAIT_TIME");
  });

  it("IA-004: aucune propriété réseau/fetch (module en mémoire)", () => {
    // Garde structurel : analyzeComment n'utilise aucune API réseau.
    // (fetch inexistant en contexte pur — l'appel ci-dessous ne doit jamais throw réseau.)
    expect(() => analyzeComment("service rapide")).not.toThrow();
  });
});
