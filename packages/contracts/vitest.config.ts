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
    // Timeout généreux (30 s) pour absorber la contention CI 2 cœurs sous couverture v8.
    // Les tests d'inventaire (CONTRACT-009, ~l.295/314/332) sont de la pure I/O+parse synchrone
    // déterministe : ils ne doivent JAMAIS être limités par le défaut vitest de 5 s, qui provoque
    // des « Test timed out in 5000ms » intermittents (VERT en local, FLAKY en CI 2 cœurs).
    // Classe timeout CI — ref leçon : .claude/lessons/etat-local-residuel-masque-la-ci.md
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Exclure les tests runtime lourds du gate couverture rapide.
    //
    // Tests exclus et leur justification (T8 contention CI) :
    //
    //   mock-prism.test.ts       — spawne 7 serveurs Prism + 1 conteneur Docker Schemathesis
    //   contract-diff.test.ts    — spawne Docker (oasdiff) ~16s ; aussi check-generated-sync qui
    //                              relance `pnpm generate` (redocly + openapi-typescript × 7)
    //   bundle-determinism.test.ts — spawne `pnpm generate` 2× pour vérifier le déterminisme
    //
    // Sur un runner CI 2 cœurs + instrumentation couverture, ces opérations provoquent des
    // timeouts intermittents qui font échouer le gate de manière opaque.
    // Ces tests sont exécutés via `test:runtime` (vitest.runtime.config.ts) sur un job CI dédié.
    //
    // Ref leçon : .claude/lessons/etat-local-residuel-masque-la-ci.md
    // Pattern : cf. KIOSK test:visual (séparation gate rapide / tests lourds).
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      // Tests runtime lourds — séparés du gate couverture (T8 contention CI)
      "src/mock-prism.test.ts",
      "src/contract-diff.test.ts",
      "src/bundle-determinism.test.ts",
    ],
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
      // séparé. Ils sont testés de bout en bout par les suites runtime (bundle-determinism.test.ts,
      // contract-diff.test.ts, mock-prism.test.ts) qui valident leurs artefacts produits.
      //
      // Justification src/mock-prism.test.ts, src/contract-diff.test.ts,
      //               src/bundle-determinism.test.ts : exclus du gate rapide pour isoler la
      // contention CI (T8) — voir exclude test ci-dessus. Testés par test:runtime.
      // Ref : .claude/lessons/etat-local-residuel-masque-la-ci.md
      exclude: [
        ...vitestDefaultCoverageExcludes,
        "generated/**",
        "scripts/**",
        // Fichiers de configuration Vitest (ex. vitest.runtime.config.ts) : non testables,
        // le pattern vitest default ne couvre que vitest.config.* (nom simple).
        // vitest.*.config.ts (ex. vitest.runtime.config.ts) doit être exclu explicitement.
        "vitest.*.config.ts",
        // Fichiers exercés uniquement par les tests runtime (docker, generate, prism)
        // L'instrumentation V8 ne couvre pas les processus fils.
        // Testés de bout en bout via test:runtime — T8 contention CI.
        "src/mock-prism.test.ts",
        "src/contract-diff.test.ts",
        "src/bundle-determinism.test.ts",
      ],
    },
  },
});
