import { defineConfig } from "vitest/config";
import { resolve } from "path";

// Leçon f1 : fournir `coverage.exclude` REMPLACE les defaults vitest (defaultCoverageExcludes).
// On les ré-inclut ici explicitement pour ne pas perdre l'exclusion de node_modules, test files, etc.
// Même pattern que apps/kiosk/vitest.config.ts et packages/contracts/vitest.config.ts.
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
  resolve: {
    alias: {
      // Correspond aux paths TypeScript : src/* → ./src/*
      src: resolve(import.meta.dirname, "src"),
      // Le package @sigfa/contracts n'expose pas ses événements en sous-chemin
      // via son champ `exports` (`.` → dist/index.js). Pour les tests de PARITÉ
      // (le contrat = source de vérité), on alias le sous-chemin d'événements
      // vers la source TS du contrat. Aucune modification de packages/**.
      "@sigfa/contracts/events/realtime.js": resolve(
        import.meta.dirname,
        "../../packages/contracts/events/realtime.ts"
      ),
    },
  },
  test: {
    // Clés crypto de test : le barrel @sigfa/database (importé par les routeurs
    // admin API-008 via insertAuditEntry) charge le module crypto avec fail-fast
    // sur les clés au chargement. Fournies ici pour tout le suite de tests API.
    env: {
      PHONE_ENCRYPTION_KEY:
        "1111111111111111111111111111111111111111111111111111111111111111",
      PHONE_HASH_KEY:
        "2222222222222222222222222222222222222222222222222222222222222222",
    },
    // Les beforeAll démarrent des conteneurs Testcontainers (PostgreSQL 16 + Redis 7) —
    // sur un runner CI plus lent, le pull d'image + démarrage dépasse 5 s par défaut.
    // Leçon : .claude/lessons/etat-local-residuel-masque-la-ci.md
    testTimeout: 120_000,
    hookTimeout: 180_000,
    coverage: {
      provider: "v8",
      reporter: ["json", "text", "html"],
      reportsDirectory: "./coverage",
      thresholds: {
        lines: 85,
        functions: 85,
        branches: 80,
        statements: 85,
      },
      // `include` scope la couverture aux fichiers projet uniquement — sans cela,
      // vitest instrumente node_modules, dist/, etc. et les métriques sont faussées.
      // `.tsx` inclus pour les gabarits React Email (NOTIF-004).
      include: ["src/**/*.ts", "src/**/*.tsx"],
      exclude: [
        ...vitestDefaultCoverageExcludes,
        // API-specific exclusions
        "src/index.ts", // Point d'entrée serveur — non testable unitairement (démarre le serveur)
        "src/routes/admin-test-harness.ts", // Support de test partagé API-008 (Testcontainers)
        "src/services/rt002-test-harness.ts", // Support de test partagé RT-002 (Testcontainers realtime)
        "src/routes/model-api-b.harness.ts", // Support de test partagé MODEL-API-B (Testcontainers)
      ],
    },
  },
});
