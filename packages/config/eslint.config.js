import js from "@eslint/js";
import tseslint from "typescript-eslint";
import importPlugin from "eslint-plugin-import";

const base = [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: {
      import: importPlugin,
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/ban-ts-comment": "error",
      "import/no-relative-parent-imports": "error",
      // Fallback enforcement that works independently of resolver
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["../*"],
              message: "Relative parent imports are forbidden. Use absolute src/ paths instead.",
            },
          ],
        },
      ],
    },
  },
];

export default base;
