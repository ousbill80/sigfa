/**
 * ICONS-001 — garde « zéro emoji » sur les sources de @sigfa/ui.
 *
 * Décision produit : JAMAIS d'emoji dans l'interface (produit bancaire
 * premium). Ce test balaye récursivement `packages/ui/src` (ts/tsx/css) et
 * échoue si un caractère des plans emoji/pictogrammes apparaît dans une
 * source. Les remplacements passent par le set d'icônes SIGFA.
 */
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

/** Plages Unicode interdites : emoji, pictogrammes, dingbats, variantes. */
const EMOJI_PATTERN =
  /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]|\u{FE0F}/u;

/** Extensions de sources balayées. */
const SOURCE_EXT = /\.(ts|tsx|css)$/;

function collectSources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectSources(full));
    } else if (SOURCE_EXT.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

describe("ICONS-001: zéro emoji dans @sigfa/ui", () => {
  const srcRoot = path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    "..",
    "..",
  );

  it("aucune source ts/tsx/css du package ne contient d'emoji", () => {
    const files = collectSources(srcRoot);
    expect(files.length).toBeGreaterThan(10);
    const offenders: string[] = [];
    for (const file of files) {
      const text = fs.readFileSync(file, "utf8");
      const match = EMOJI_PATTERN.exec(text);
      if (match) {
        const line = text.slice(0, match.index).split("\n").length;
        offenders.push(
          `${path.relative(srcRoot, file)}:${line} contient "${match[0]}"`,
        );
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});
