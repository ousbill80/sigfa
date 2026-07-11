import { describe, it, expect } from "vitest";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(__dirname, "__fixtures__");
const CONFIG_ROOT = resolve(__dirname, "../");

// INFRA-007: T8 — timeout explicite 30s par test car l'API ESLint peut prendre 1-10s
// sur des runners GitHub (type-checking TypeScript complet). Pas de hausse globale du monorepo.
const ESLINT_TIMEOUT = 30_000;

describe("ESLint config — @sigfa/config", () => {
  async function lint(file: string): Promise<ESLint.LintResult[]> {
    const eslint = new ESLint({
      overrideConfigFile: resolve(CONFIG_ROOT, "eslint.config.js"),
    });
    return eslint.lintFiles([file]);
  }

  it("flags explicit any", { timeout: ESLINT_TIMEOUT }, async () => {
    const results = await lint(resolve(FIXTURES, "bad-any.ts"));
    const messages = results.flatMap((r) => r.messages);
    const anyError = messages.find((m) => m.ruleId === "@typescript-eslint/no-explicit-any");
    expect(anyError).toBeDefined();
    expect(anyError?.severity).toBe(2);
  });

  it("flags @ts-ignore", { timeout: ESLINT_TIMEOUT }, async () => {
    const results = await lint(resolve(FIXTURES, "bad-ts-ignore.ts"));
    const messages = results.flatMap((r) => r.messages);
    const tsIgnoreError = messages.find((m) => m.ruleId === "@typescript-eslint/ban-ts-comment");
    expect(tsIgnoreError).toBeDefined();
    expect(tsIgnoreError?.severity).toBe(2);
  });

  it("flags parent imports (../) via no-restricted-imports", { timeout: ESLINT_TIMEOUT }, async () => {
    const results = await lint(resolve(FIXTURES, "bad-parent-import.ts"));
    const messages = results.flatMap((r) => r.messages);
    // no-restricted-imports catches parent imports reliably without requiring file resolution
    const parentImportError = messages.find(
      (m) =>
        m.ruleId === "no-restricted-imports" ||
        m.ruleId === "import/no-relative-parent-imports",
    );
    expect(parentImportError).toBeDefined();
    expect(parentImportError?.severity).toBe(2);
  });

  it("accepts sibling imports (./)", { timeout: ESLINT_TIMEOUT }, async () => {
    const results = await lint(resolve(FIXTURES, "good-imports.ts"));
    const messages = results.flatMap((r) => r.messages);
    // No parent-import related errors
    const parentImportError = messages.find(
      (m) =>
        m.ruleId === "no-restricted-imports" ||
        m.ruleId === "import/no-relative-parent-imports",
    );
    expect(parentImportError).toBeUndefined();
  });
});
