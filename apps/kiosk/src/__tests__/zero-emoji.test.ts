/**
 * ICONS-001 (kiosk) — garde « zéro emoji » sur la borne.
 *
 * Décision produit : JAMAIS d'emoji dans l'interface (produit bancaire
 * premium). Ce test balaye récursivement `apps/kiosk/src` (ts/tsx/css) et
 * `apps/kiosk/messages` (json) et échoue si un caractère des plans
 * emoji/pictogrammes apparaît. Les remplacements passent par le set
 * d'icônes SIGFA (`@sigfa/ui` — SigfaIcon duotone).
 */
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

/** Plages Unicode interdites : emoji, pictogrammes, dingbats, variantes. */
const EMOJI_PATTERN =
  /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]|\u{FE0F}/u;

/**
 * Pour les messages i18n on interdit AUSSI les flèches typographiques
 * (← → etc.) : tout pictogramme passe par une icône SIGFA, jamais par
 * un glyphe texte.
 */
const MESSAGES_PATTERN =
  /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{2190}-\u{21FF}]|\u{FE0F}/u;

/** Extensions de sources balayées côté src. */
const SOURCE_EXT = /\.(ts|tsx|css)$/;

function collectFiles(dir: string, pattern: RegExp): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectFiles(full, pattern));
    } else if (pattern.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function findOffenders(
  files: string[],
  root: string,
  forbidden: RegExp,
): string[] {
  const offenders: string[] = [];
  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    const match = forbidden.exec(text);
    if (match) {
      const line = text.slice(0, match.index).split("\n").length;
      offenders.push(
        `${path.relative(root, file)}:${line} contient "${match[0]}"`,
      );
    }
  }
  return offenders;
}

const kioskRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

describe("ICONS-001: zéro emoji sur la borne kiosk", () => {
  it("aucune source ts/tsx/css de apps/kiosk/src ne contient d'emoji", () => {
    const files = collectFiles(path.join(kioskRoot, "src"), SOURCE_EXT);
    expect(files.length).toBeGreaterThan(10);
    const offenders = findOffenders(files, kioskRoot, EMOJI_PATTERN);
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("aucun fichier messages/*.json ne contient d'emoji ni de flèche", () => {
    const files = collectFiles(path.join(kioskRoot, "messages"), /\.json$/);
    expect(files.length).toBeGreaterThanOrEqual(2);
    const offenders = findOffenders(files, kioskRoot, MESSAGES_PATTERN);
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});
