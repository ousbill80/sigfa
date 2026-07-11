// commitlint.config.mjs — INFRA-004
// Configuration commitlint pour le projet SIGFA.
// Étend @commitlint/config-conventional (Conventional Commits v1.0.0).

/** @type {import('@commitlint/types').UserConfig} */
const config = {
  extends: ["@commitlint/config-conventional"],
  rules: {
    // Longueur maximale de la ligne de titre : 100 caractères
    "header-max-length": [2, "always", 100],
    // Types autorisés (Conventional Commits standard)
    "type-enum": [
      2,
      "always",
      [
        "feat",
        "fix",
        "docs",
        "style",
        "refactor",
        "perf",
        "test",
        "build",
        "ci",
        "chore",
        "revert",
      ],
    ],
    // Le type doit être en minuscules
    "type-case": [2, "always", "lower-case"],
    // Le scope est facultatif mais doit être en minuscules s'il est présent
    "scope-case": [2, "always", "lower-case"],
    // La description ne doit pas commencer par une majuscule
    "subject-case": [0],
    // La description ne doit pas se terminer par un point
    "subject-full-stop": [2, "never", "."],
    // La description est obligatoire
    "subject-empty": [2, "never"],
  },
};

export default config;
