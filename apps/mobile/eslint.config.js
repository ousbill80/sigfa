import baseConfig from "@sigfa/config/eslint";

// Override: allow relative parent imports in test files only
// Tests must import app screens and src modules with relative paths
const testOverride = {
  files: ["__tests__/**/*.{ts,tsx}", "**/*.test.{ts,tsx}", "**/*.spec.{ts,tsx}"],
  rules: {
    "import/no-relative-parent-imports": "off",
    "no-restricted-imports": "off",
  },
};

export default [...baseConfig, testOverride];
