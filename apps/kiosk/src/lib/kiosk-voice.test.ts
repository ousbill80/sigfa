/**
 * KIOSK-008 — Tests TDD pour la logique de synthèse vocale + accessibilité.
 * Écrits AVANT l'implémentation (phase rouge).
 *
 * Couvre les critères EARS purs (indépendants du rendu React) :
 *   - registre SIGFA du texte annoncé,
 *   - mapping locale → BCP-47,
 *   - sélection de voix avec fallback FR (locale sans voix native),
 *   - rate ralentie en mode accessibilité,
 *   - facteurs de font-size et de timeout en accessibilité.
 */
import { describe, it, expect } from "vitest";
import {
  buildVoiceAnnouncement,
  localeToBcp47,
  pickVoiceForLocale,
  voiceRate,
  accessibilityFontSizePx,
  accessibilityTimeoutMs,
  ticketReturnDelayMs,
  A11Y_BASE_FONT_PX,
  A11Y_LINE_HEIGHT,
  NOMINAL_TICKET_RETURN_MS,
  A11Y_TICKET_RETURN_MS,
} from "@/lib/kiosk-voice";

/** Fabrique une voix minimale conforme à SpeechSynthesisVoice. */
function makeVoice(lang: string, name = lang): SpeechSynthesisVoice {
  return {
    lang,
    name,
    default: false,
    localService: true,
    voiceURI: name,
  };
}

describe("KIOSK-008: registre SIGFA du texte annoncé", () => {
  it("KIOSK-008: texte annoncé suit le registre SIGFA (FR)", () => {
    const text = buildVoiceAnnouncement(
      { displayNumber: "A007", position: 4, estimatedWaitMinutes: 12 },
      (key, vars) => {
        expect(key).toBe("voiceAnnounce");
        expect(vars).toEqual({
          displayNumber: "A007",
          position: 4,
          minutes: 12,
        });
        return "Ticket A007. Vous êtes 4e dans la file. Environ 12 minutes.";
      }
    );
    expect(text).toContain("A007");
    expect(text).toContain("4");
    expect(text).toContain("12");
  });
});

describe("KIOSK-008: mapping locale → BCP-47", () => {
  it("KIOSK-008: fr → fr-FR, en → en-US", () => {
    expect(localeToBcp47("fr")).toBe("fr-FR");
    expect(localeToBcp47("en")).toBe("en-US");
  });

  it("KIOSK-008: locale sans voix native → fallback fr-FR", () => {
    // Décision PO : plus de Dioula/Baoulé. Toute locale hors table (ex. langue
    // ivoirienne sans TTS) retombe explicitement sur le repli FR.
    expect(localeToBcp47("es")).toBe("fr-FR");
    expect(localeToBcp47("de")).toBe("fr-FR");
  });

  it("KIOSK-008: locale inconnue → fallback fr-FR", () => {
    expect(localeToBcp47("xx")).toBe("fr-FR");
  });
});

describe("KIOSK-008: sélection de voix avec fallback FR", () => {
  it("KIOSK-008: voix de la locale cible sélectionnée si disponible (en)", () => {
    const voices = [makeVoice("fr-FR"), makeVoice("en-US")];
    const v = pickVoiceForLocale("en", voices);
    expect(v?.lang).toBe("en-US");
  });

  it("KIOSK-008: locale sans voix native → fallback voix FR", () => {
    const voices = [makeVoice("fr-FR"), makeVoice("en-US")];
    const v = pickVoiceForLocale("es", voices);
    expect(v?.lang).toBe("fr-FR");
  });

  it("KIOSK-008: seconde locale sans voix native → fallback voix FR", () => {
    const voices = [makeVoice("fr-FR"), makeVoice("en-US")];
    const v = pickVoiceForLocale("de", voices);
    expect(v?.lang).toBe("fr-FR");
  });

  it("KIOSK-008: aucune voix disponible → null, sans lever d'erreur", () => {
    expect(pickVoiceForLocale("es", [])).toBeNull();
  });

  it("KIOSK-008: correspondance de préfixe de langue (fr matche fr-CA)", () => {
    const voices = [makeVoice("fr-CA")];
    const v = pickVoiceForLocale("fr", voices);
    expect(v?.lang).toBe("fr-CA");
  });
});

describe("KIOSK-008: rate ralentie en mode accessibilité", () => {
  it("KIOSK-008: rate = 1 en nominal", () => {
    expect(voiceRate(false)).toBe(1);
  });

  it("KIOSK-008: rate = 0.8 en accessibilité", () => {
    expect(voiceRate(true)).toBe(0.8);
  });
});

describe("KIOSK-008: font-size accessibilité", () => {
  it("KIOSK-008: base 28 px × 1.2 = 33.6 px (≥ 34 px arrondi supérieur)", () => {
    expect(A11Y_BASE_FONT_PX).toBe(28);
    expect(A11Y_LINE_HEIGHT).toBe(1.2);
    const computed = accessibilityFontSizePx();
    // 28 × 1.2 = 33.6 → arrondi supérieur = 34, doit être ≥ 34
    expect(computed).toBeGreaterThanOrEqual(34);
  });
});

describe("KIOSK-008: timeout doublé en accessibilité", () => {
  it("KIOSK-008: timeout nominal inchangé", () => {
    expect(accessibilityTimeoutMs(30000, false)).toBe(30000);
  });

  it("KIOSK-008: timeout doublé en accessibilité", () => {
    expect(accessibilityTimeoutMs(30000, true)).toBe(60000);
  });
});

describe("KIOSK-008: retour accueil Moment Ticket", () => {
  it("KIOSK-008: 4 s en nominal", () => {
    expect(NOMINAL_TICKET_RETURN_MS).toBe(4000);
    expect(ticketReturnDelayMs(false)).toBe(4000);
  });

  it("KIOSK-008: 8 s en accessibilité", () => {
    expect(A11Y_TICKET_RETURN_MS).toBe(8000);
    expect(ticketReturnDelayMs(true)).toBe(8000);
  });
});
