// @ts-check
/** @type {import('eslint').Linter.Config[]} */
const eslintConfig = [
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
