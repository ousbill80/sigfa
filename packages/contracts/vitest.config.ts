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
      // mock-prism.test.ts, contract-diff.test.ts) qui valident leurs artefacts produits.
      exclude: [
        ...vitestDefaultCoverageExcludes,
        "generated/**",
        "scripts/**",
      ],
    },
  },
});
