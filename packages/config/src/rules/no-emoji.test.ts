/**
 * Tests de la règle `sigfa/no-emoji` (exigence PO « n'utilise jamais d'émoticône »).
 *
 * NB : ce fichier de test ne contient AUCUN caractère emoji brut — les cas de
 * test construisent les caractères via des séquences d'échappement \u{...},
 * qui produisent le caractère réel dans la chaîne passée à ESLint.
 */
import { describe, it, expect } from "vitest";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint, RuleTester } from "eslint";

import { noEmojiRule, sigfaPlugin } from "./no-emoji.js";
import { parseForESLint, plainTextParser } from "./plain-text-parser.js";
import {
  noEmojiConfigs,
  TEMP_NO_EMOJI_EXEMPT_PATHS,
} from "./no-emoji.config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(__dirname, "../__fixtures__/no-emoji");
const CONFIG_ROOT = resolve(__dirname, "../../");

// Même politique que eslint.test.ts (INFRA-007: T8) : l'API ESLint peut être
// lente sur les runners CI — timeout explicite, pas de hausse globale.
const ESLINT_TIMEOUT = 30_000;

// ─── Tests unitaires de la règle (RuleTester) ────────────────────────────────

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: "module",
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

describe("sigfa/no-emoji — RuleTester", () => {
  it("distingue emojis interdits et caractères FR légitimes", () => {
    ruleTester.run("no-emoji", noEmojiRule, {
      valid: [
        // Caractères français légitimes — jamais de faux positif.
        `const s = "éàçùî — « guillemets », point médian · tiret – suspension…";`,
        // Flèche U+2192 et traits de boîte U+2500 (hors plages interdites).
        `const f = "file \u{2192} guichet"; // \u{2500}\u{2500}\u{2500} section`,
        // Une séquence d'échappement en source reste autorisée (regex de nettoyage).
        `const re = /[\\u{1F000}-\\u{1FAFF}]/gu;`,
        // Exemption temporaire par chemin (apps/kiosk).
        {
          code: `const legacy = "\u{2713} ticket";`,
          filename: "/repo/apps/kiosk/src/screens/accueil.ts",
          options: [{ ignorePaths: ["apps/kiosk/"] }],
        },
        // Exemption Windows : les antislashs sont normalisés avant comparaison.
        {
          code: `const legacy = "\u{2713}";`,
          filename: "C:\\repo\\apps\\kiosk\\src\\a.ts",
          options: [{ ignorePaths: ["apps/kiosk/"] }],
        },
      ],
      invalid: [
        // Emoji plein U+1F600 dans un littéral.
        {
          code: `const x = "\u{1F600}";`,
          errors: [{ messageId: "forbidden", data: { code: "1F600" } }],
        },
        // Coche U+2713 — INTERDITE (pictogramme remplaçable par IconValider).
        {
          code: `const check = "\u{2713}";`,
          errors: [{ messageId: "forbidden", data: { code: "2713" } }],
        },
        // U+26A0 + sélecteur de variante U+FE0F : deux caractères, deux erreurs.
        {
          code: `const warn = "\u{26A0}\u{FE0F}";`,
          errors: [
            { messageId: "forbidden", data: { code: "26A0" } },
            { messageId: "forbidden", data: { code: "FE0F" } },
          ],
        },
        // Drapeau régional (U+1F1EB U+1F1F7) : deux indicateurs, deux erreurs.
        {
          code: `const flag = "\u{1F1EB}\u{1F1F7}";`,
          errors: [
            { messageId: "forbidden", data: { code: "1F1EB" } },
            { messageId: "forbidden", data: { code: "1F1F7" } },
          ],
        },
        // Plage U+2B00–U+2BFF (flèches/étoiles pictographiques).
        {
          code: `const star = "\u{2B50}";`,
          errors: [{ messageId: "forbidden", data: { code: "2B50" } }],
        },
        // Template literal.
        {
          code: "const t = `statut \u{2705} terminé`;",
          errors: [{ messageId: "forbidden", data: { code: "2705" } }],
        },
        // Texte JSX.
        {
          code: `const C = () => <span>\u{2713}</span>;`,
          errors: [{ messageId: "forbidden", data: { code: "2713" } }],
        },
        // Commentaire (le scan porte sur le texte source complet).
        {
          code: `// erreur \u{274C} bloquante\nconst ok = 1;`,
          errors: [{ messageId: "forbidden", data: { code: "274C" } }],
        },
        // Un chemin hors exemption reste flagué même avec ignorePaths.
        {
          code: `const x = "\u{1F3E6}";`,
          filename: "/repo/apps/web/src/a.ts",
          options: [{ ignorePaths: ["apps/kiosk/"] }],
          errors: [{ messageId: "forbidden", data: { code: "1F3E6" } }],
        },
      ],
    });
    // RuleTester lève en cas d'échec — arrivée ici = succès.
    expect(true).toBe(true);
  });

  it("le message d'erreur pointe vers SigfaIcon de @sigfa/ui, en français", () => {
    const message = noEmojiRule.meta?.messages?.forbidden ?? "";
    expect(message).toContain("SigfaIcon");
    expect(message).toContain("@sigfa/ui");
    expect(message).toContain("interdit");
  });
});

// ─── Parseur texte-brut (JSON de messages) ───────────────────────────────────

describe("plain-text-parser", () => {
  it("produit un Program vide couvrant tout le texte", () => {
    const text = '{\n  "a": "b"\n}\n';
    const { ast } = parseForESLint(text);
    expect(ast).toMatchObject({ type: "Program", body: [], tokens: [] });
    expect(ast.range).toEqual([0, text.length]);
    expect(ast.loc.start).toEqual({ line: 1, column: 0 });
    expect(ast.loc.end.line).toBe(4);
  });

  it("expose le format parseur attendu par languageOptions.parser", () => {
    expect(plainTextParser.parseForESLint).toBe(parseForESLint);
    expect(plainTextParser.meta?.name).toBeDefined();
  });
});

// ─── Intégration : config partagée complète sur fixtures ────────────────────

describe("sigfa/no-emoji — intégration config partagée", () => {
  async function lint(file: string): Promise<ESLint.LintResult[]> {
    const eslint = new ESLint({
      overrideConfigFile: resolve(CONFIG_ROOT, "eslint.config.js"),
    });
    return eslint.lintFiles([file]);
  }

  function emojiErrors(results: ESLint.LintResult[]) {
    return results
      .flatMap((r) => r.messages)
      .filter((m) => m.ruleId === "sigfa/no-emoji");
  }

  it("flague un emoji dans un littéral .ts", { timeout: ESLINT_TIMEOUT }, async () => {
    const errors = emojiErrors(await lint(resolve(FIXTURES, "bad-emoji-literal.ts")));
    expect(errors).toHaveLength(1);
    expect(errors[0]?.severity).toBe(2);
    expect(errors[0]?.message).toContain("SigfaIcon");
  });

  it("flague la coche U+2713 dans du JSX .tsx", { timeout: ESLINT_TIMEOUT }, async () => {
    const errors = emojiErrors(await lint(resolve(FIXTURES, "bad-emoji-jsx.tsx")));
    expect(errors).toHaveLength(1);
  });

  it("flague les pictogrammes dans un template literal", { timeout: ESLINT_TIMEOUT }, async () => {
    const errors = emojiErrors(await lint(resolve(FIXTURES, "bad-emoji-template.ts")));
    // U+26A0 + U+FE0F + U+2705 = 3 caractères interdits.
    expect(errors).toHaveLength(3);
  });

  it("flague un emoji dans un JSON de messages", { timeout: ESLINT_TIMEOUT }, async () => {
    const errors = emojiErrors(await lint(resolve(FIXTURES, "messages/bad-fr.json")));
    expect(errors).toHaveLength(1);
    expect(errors[0]?.severity).toBe(2);
  });

  it("accepte un JSON de messages français sans emoji", { timeout: ESLINT_TIMEOUT }, async () => {
    const results = await lint(resolve(FIXTURES, "messages/good-fr.json"));
    // Aucune erreur du tout : le parseur texte-brut ne déclenche aucune règle AST.
    expect(results.flatMap((r) => r.messages)).toHaveLength(0);
  });

  it("aucun faux positif sur les caractères français", { timeout: ESLINT_TIMEOUT }, async () => {
    const errors = emojiErrors(await lint(resolve(FIXTURES, "good-french.ts")));
    expect(errors).toHaveLength(0);
  });

  it("exemption temporaire apps/kiosk active dans la config partagée", { timeout: ESLINT_TIMEOUT }, async () => {
    const errors = emojiErrors(
      await lint(resolve(FIXTURES, "apps/kiosk/exempt-emoji.ts")),
    );
    expect(errors).toHaveLength(0);
  });

  it("l'exemption couvre exactement apps/kiosk (TODO à lever après migration icônes)", () => {
    expect(TEMP_NO_EMOJI_EXEMPT_PATHS).toEqual(["apps/kiosk/"]);
    // Le fragment expose bien les deux blocs (sources + JSON de messages).
    expect(noEmojiConfigs).toHaveLength(2);
    expect(noEmojiConfigs[1]?.files).toContain("**/messages/**/*.json");
    expect(noEmojiConfigs[0]?.plugins?.sigfa).toBe(sigfaPlugin);
  });
});
