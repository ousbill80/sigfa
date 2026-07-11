import { defineConfig } from "vitest/config";

// Defaults vitest/coverage (remplacés si on fournit `exclude`, donc on les ré-inclut
// explicitement pour ne pas perdre l'exclusion des test files, config files, etc.)
const vitestDefaultCoverageExcludes = [
  "coverage/**",
  "dist/**",
  "**/node_modules/**",
  "**/[.]**",
  "packages/*/test?(s)/**",
  "**/*.d.ts",
  "**/virtual:*",
  "**/__x00__*",
  "**/\0*",
  "cypress/**",
  "test?(s)/**",
  "test?(-*).?(c|m)[jt]s?(x)",
  "**/*{.,-}{test,spec,bench,benchmark}?(-d).?(c|m)[jt]s?(x)",
  "**/__tests__/**",
  "**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build,eslint,prettier}.config.*",
  "**/vitest.{workspace,projects}.[jt]s?(on)",
  "**/.{eslint,mocha,prettier}rc.{?(c|m)js,yml}",
];

export default defineConfig({
  test: {
    // Exclure les tests runtime lourds (Prism + Schemathesis Docker) du gate rapide.
    //
    // Justification : mock-prism.test.ts spawne 7 serveurs Prism + 1 conteneur Docker
    // Schemathesis. Sur un runner CI 2 cœurs, la contention CPU provoque des timeouts
    // intermittents ("Port 4012 not ready") qui font échouer le gate de manière opaque.
    // Ces tests sont exécutés séparément via `test:runtime` (vitest.runtime.config.ts)
    // sur un job CI isolé avec Docker disponible.
    //
    // Ref leçon : .claude/lessons/etat-local-residuel-masque-la-ci.md
    // Pattern : cf. KIOSK test:visual (séparation gate rapide / tests lourds).
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      // Tests runtime lourds — séparés du gate couverture (T8 contention CI)
      "src/mock-prism.test.ts",
    ],
    hookTimeout: 150_000, // generate (redocly + openapi-typescript × 7) peut prendre > 60s
    testTimeout: 300_000, // Docker (oasdiff) + generate peut prendre > 60s par test
    coverage: {
      provider: "v8",
      reporter: ["json"],
      reportsDirectory: "./coverage",
      // Exclure generated/ et scripts/ des métriques de couverture — CONTRACT-009a / CONTRACT-009 retry
      //
      // Note : fournir `exclude` remplace les defaults vitest ; on les ré-inclut ici pour conserver
      // l'exclusion des test files, config files, etc. (voir vitestDefaultCoverageExcludes).
      //
      // Justification generated/** : types TypeScript générés par openapi-typescript — non testables
      // directement (pur typage, zéro runtime), déjà couverts structurellement par bundle-generate.test.ts.
      //
      // Justification scripts/** : ces fichiers (bundle.mjs, generate.mjs, mock.mjs) sont exécutés
      // exclusivement via des sous-processus (execSync/execa) dans les tests end-to-end.
      // L'instrumentation V8 ne peut pas les couvrir car ils tournent dans un processus fils
      // séparé. Ils sont testés de bout en bout par les suites structurelles (bundle-generate.test.ts,
      // contract-diff.test.ts) qui valident leurs artefacts produits.
      //
      // Justification mock-prism.test.ts (et scripts mock/schemathesis) : exclus du gate rapide
      // pour isoler la contention CI (T8) — voir exclude test ci-dessus.
      // Ref : .claude/lessons/etat-local-residuel-masque-la-ci.md
      exclude: [
        ...vitestDefaultCoverageExcludes,
        "generated/**",
        "scripts/**",
        // Scripts mock/schemathesis exercés uniquement par les tests runtime (mock-prism.test.ts)
        // L'instrumentation V8 ne couvre pas les processus fils (prism, docker).
        // Ces fichiers sont exclus du gate couverture unitaire — T8 contention CI.
        "src/mock-prism.test.ts",
      ],
    },
  },
});
