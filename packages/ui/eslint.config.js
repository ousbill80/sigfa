import base from "@sigfa/config/eslint";
import globals from "globals";

/**
 * @sigfa/ui runs in the browser (React DOM) and its tests run in jsdom.
 * Extend the shared flat config with browser + test globals and disable the
 * core `no-undef` rule (TypeScript already checks identifiers, and it produces
 * false positives on DOM/React types under typescript-eslint).
 */
export default [
  ...base,
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      "no-undef": "off",
    },
  },
];
