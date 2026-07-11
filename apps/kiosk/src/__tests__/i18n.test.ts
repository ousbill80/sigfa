/**
 * KIOSK-001 — Tests TDD pour i18n (next-intl routing + messages)
 * Écrits AVANT l'implémentation (phase rouge).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const MESSAGES_DIR = resolve(__dirname, "../../messages");

// Charger les fichiers de messages
function loadMessages(locale: string): Record<string, unknown> {
  try {
    const content = readFileSync(
      resolve(MESSAGES_DIR, `${locale}.json`),
      "utf-8"
    );
    return JSON.parse(content) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function getAllKeys(
  obj: Record<string, unknown>,
  prefix = ""
): string[] {
  const keys: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "object" && v !== null && !Array.isArray(v)) {
      keys.push(...getAllKeys(v as Record<string, unknown>, fullKey));
    } else {
      keys.push(fullKey);
    }
  }
  return keys;
}

describe("KIOSK-001: i18n", () => {
  const SUPPORTED_LOCALES = ["fr", "dioula", "baoule", "en"];

  it("KIOSK-001: tous les fichiers de messages ont les mêmes clés", () => {
    const allMessages = SUPPORTED_LOCALES.map((locale) => ({
      locale,
      messages: loadMessages(locale),
    }));

    // Vérifier que tous les fichiers existent et ont des clés
    for (const { locale, messages } of allMessages) {
      expect(
        Object.keys(messages).length,
        `Fichier messages/${locale}.json doit exister et avoir des clés`
      ).toBeGreaterThan(0);
    }

    // Comparer les clés entre toutes les locales
    const referenceKeys = getAllKeys(allMessages[0]!.messages).sort();

    for (const { locale, messages } of allMessages.slice(1)) {
      const localeKeys = getAllKeys(messages).sort();
      expect(
        localeKeys,
        `Les clés de ${locale}.json doivent correspondre à celles de fr.json`
      ).toEqual(referenceKeys);
    }
  });

  it("KIOSK-001: next-intl routing supporte fr, dioula, baoule, en", async () => {
    const { routing } = await import("../i18n/routing.js");

    expect(routing.locales).toContain("fr");
    expect(routing.locales).toContain("dioula");
    expect(routing.locales).toContain("baoule");
    expect(routing.locales).toContain("en");
    expect(routing.defaultLocale).toBe("fr");
  });
});
