// @ts-check
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import nextPlugin from "@next/eslint-plugin-next";
import { noEmojiConfigs } from "@sigfa/config/eslint-no-emoji";

/** @type {import('eslint').Linter.Config[]} */
const eslintConfig = [
  // Parseur TypeScript pour que les .ts/.tsx soient réellement analysés
  // (sans lui, ESLint 9 ignore ces fichiers ou échoue en parsing espree).
  {
    files: ["**/*.{ts,tsx,mts,cts}"],
    languageOptions: { parser: tseslint.parser },
  },
  // Plugins référencés par des directives eslint-disable existantes dans src/
  // (sévérité `warn`, comme dans leurs presets respectifs).
  {
    files: ["**/*.{ts,tsx,mts,cts}"],
    plugins: { "react-hooks": reactHooks, "@next/next": nextPlugin },
    rules: {
      "react-hooks/exhaustive-deps": "warn",
      "@next/next/no-img-element": "warn",
    },
  },
  // Règle anti-emoji monorepo (exigence PO) — partagée depuis @sigfa/config.
  ...noEmojiConfigs,
  {
    rules: {
      // Forbid relative parent imports — use @/ alias paths instead
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["../*"],
              message:
                "Relative parent imports are forbidden. Use absolute src/ paths instead.",
            },
          ],
        },
      ],
    },
  },
];

export default eslintConfig;
