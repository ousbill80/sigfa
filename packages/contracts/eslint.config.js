import baseConfig from "@sigfa/config/eslint";

export default [
  // Exclure generated/ (openapi-typescript, bundles) de l'analyse ESLint — CONTRACT-009a
  {
    ignores: ["generated/**"],
  },
  ...baseConfig,
];
