/**
 * CONTRACT-009b — Tests pour mock Prism multi-module + fumée Schemathesis
 *
 * Critère 5 : Prism démarre sur les 7 bundles et répond à un exemple par module (2xx)
 * Critère 6 : La fumée Schemathesis passe contre le mock core (exécution réelle via Docker)
 *
 * TDD : ces tests sont écrits AVANT l'implémentation (rouge → vert).
 */

import { describe, it, expect } from "vitest";
import { spawn, execSync, execFileSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const CONTRACTS_DIR = resolve(__dirname, "..");
const BUNDLED_DIR = resolve(CONTRACTS_DIR, "generated/bundled");
const PRISM_BIN = resolve(CONTRACTS_DIR, "node_modules/.bin/prism");

// Ports par défaut (critère 5 : documentation dans .env.example)
// Typage explicite avec les clés connues pour éviter number|undefined avec noUncheckedIndexedAccess
const MODULE_PORTS = {
  core: Number(process.env.MOCK_CORE_PORT ?? 4010),
  public: Number(process.env.MOCK_PUBLIC_PORT ?? 4011),
  agents: Number(process.env.MOCK_AGENTS_PORT ?? 4012),
  admin: Number(process.env.MOCK_ADMIN_PORT ?? 4013),
  reporting: Number(process.env.MOCK_REPORTING_PORT ?? 4014),
  notifications: Number(process.env.MOCK_NOTIFICATIONS_PORT ?? 4015),
  ai: Number(process.env.MOCK_AI_PORT ?? 4016),
} satisfies Record<string, number>;

// Endpoint GET 2xx avec exemple pour chaque module
// Note : les UUID/patterns doivent être valides pour que Prism passe la validation de requête
const MODULE_SMOKE_ENDPOINTS = {
  core: "/auth/me",                                               // pas de params requis
  public: "/public/tickets/V9k2mXpLqRwZsYn8fBjH3",             // trackingId nanoid(21) valide
  agents: "/agents/550e8400-e29b-41d4-a716-446655440000",       // UUID valide
  admin: "/audit-logs",                                          // pas de params requis
  reporting: "/health",                                          // endpoint public sans auth
  notifications: "/notifications/log",                           // pas de params requis
  ai: "/ai/anomalies",                                          // pas de query params requis
} satisfies Record<string, string>;

/** Attend que le port soit prêt (polling HTTP) */
async function waitForPort(port: number, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/__health`, {
        signal: AbortSignal.timeout(500),
      });
      // Prism n'a pas de /health natif — on accepte tout code, même 404
      void res;
      return;
    } catch {
      // Port pas encore prêt — on réessaie
    }
    // Essayer un vrai endpoint aussi
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`, {
        signal: AbortSignal.timeout(500),
      });
      void res;
      return;
    } catch {
      // continue
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Port ${port} not ready after ${timeoutMs}ms`);
}

/** Démarre un mock Prism sur un port donné, retourne le processus */
function startPrismMock(
  module: string,
  port: number
): ReturnType<typeof spawn> {
  const bundlePath = resolve(BUNDLED_DIR, `${module}.yaml`);
  const proc = spawn(PRISM_BIN, ["mock", "--port", String(port), bundlePath], {
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });
  return proc;
}

/** Tue proprement un processus Prism */
function stopPrism(proc: ReturnType<typeof spawn>): void {
  try {
    proc.kill("SIGTERM");
  } catch {
    // Peut déjà être terminé
  }
}

// ─── Critère 5 : Prism démarre et répond 2xx sur les 7 modules ────────────────

describe("CONTRACT-009: mock Prism démarre sur les 7 bundles (critère 5)", () => {
  it("CONTRACT-009: @stoplight/prism-cli est installé dans node_modules", () => {
    expect(
      existsSync(PRISM_BIN),
      `prism binaire introuvable : ${PRISM_BIN}`
    ).toBe(true);
  });

  it("CONTRACT-009: les 7 bundles YAML existent dans generated/bundled/", () => {
    for (const module of Object.keys(MODULE_PORTS)) {
      const bundlePath = resolve(BUNDLED_DIR, `${module}.yaml`);
      expect(
        existsSync(bundlePath),
        `Bundle manquant : ${bundlePath}`
      ).toBe(true);
    }
  });

  // Test individuel par module pour localiser précisément les échecs
  for (const [module, port] of Object.entries(MODULE_PORTS)) {
    it(
      `CONTRACT-009: mock Prism — module '${module}' démarre sur port ${port} et répond 2xx`,
      async () => {
        const bundlePath = resolve(BUNDLED_DIR, `${module}.yaml`);
        expect(existsSync(bundlePath), `Bundle manquant : ${bundlePath}`).toBe(true);
        expect(existsSync(PRISM_BIN), `prism binaire introuvable : ${PRISM_BIN}`).toBe(true);

        const proc = startPrismMock(module, port);

        let prismError = "";
        proc.stderr?.on("data", (d: Buffer) => {
          prismError += d.toString();
        });

        try {
          // Attendre que Prism soit prêt (jusqu'à 20s)
          await waitForPort(port, 20_000);

          // Appel smoke GET sur l'endpoint exemple du module
          const endpoint =
            (MODULE_SMOKE_ENDPOINTS as Record<string, string | undefined>)[module] ?? "/";
          const url = `http://127.0.0.1:${port}${endpoint}`;

          const res = await fetch(url, {
            headers: {
              Accept: "application/json",
              // Prism en mode mock peut nécessiter authorization pour certains endpoints
              Authorization: "Bearer smoke-test-token",
            },
            signal: AbortSignal.timeout(5_000),
          });

          expect(
            res.status,
            `module '${module}' GET ${endpoint} → HTTP ${res.status} (attendu 2xx)\nPrism stderr: ${prismError}`
          ).toBeGreaterThanOrEqual(200);
          expect(
            res.status,
            `module '${module}' GET ${endpoint} → HTTP ${res.status} (attendu 2xx)`
          ).toBeLessThan(300);
        } finally {
          stopPrism(proc);
          // Attendre que le port soit libéré
          await new Promise((r) => setTimeout(r, 500));
        }
      },
      45_000 // timeout généreux
    );
  }
});

// ─── Critère 6 : Fumée Schemathesis contre le mock core ───────────────────────

describe("CONTRACT-009: fumée Schemathesis contre mock core (critère 6)", () => {
  const HARNESS_SCRIPT = resolve(
    CONTRACTS_DIR,
    "../testing/src/contract/run-schemathesis.sh"
  );
  const SCHEMATHESIS_SMOKE_SCRIPT = resolve(
    CONTRACTS_DIR,
    "scripts/schemathesis-smoke.sh"
  );
  const CORE_PORT = MODULE_PORTS.core;
  const CORE_BUNDLE = resolve(BUNDLED_DIR, "core.yaml");

  it("CONTRACT-009: le harness F0 run-schemathesis.sh existe et est exécutable", () => {
    expect(
      existsSync(HARNESS_SCRIPT),
      `Harness F0 introuvable : ${HARNESS_SCRIPT}`
    ).toBe(true);
  });

  it("CONTRACT-009: schemathesis-smoke.sh existe dans packages/contracts/scripts/", () => {
    expect(
      existsSync(SCHEMATHESIS_SMOKE_SCRIPT),
      `Script schemathesis-smoke.sh manquant : ${SCHEMATHESIS_SMOKE_SCRIPT}`
    ).toBe(true);
  });

  it(
    "CONTRACT-009: Schemathesis (fumée) passe contre le mock Prism du module core",
    async () => {
      // Vérifier Docker disponible
      let dockerAvailable = false;
      try {
        execSync("docker --version", { stdio: "pipe" });
        dockerAvailable = true;
      } catch {
        // Docker non disponible
      }

      if (!dockerAvailable) {
        console.warn(
          "CONTRACT-009 [SKIP-Docker]: Docker non disponible — test Schemathesis ignoré"
        );
        return;
      }

      expect(existsSync(CORE_BUNDLE), `Bundle core manquant : ${CORE_BUNDLE}`).toBe(true);

      // Démarrer le mock Prism core
      const proc = startPrismMock("core", CORE_PORT);
      let prismOutput = "";
      proc.stdout?.on("data", (d: Buffer) => { prismOutput += d.toString(); });
      proc.stderr?.on("data", (d: Buffer) => { prismOutput += d.toString(); });

      try {
        await waitForPort(CORE_PORT, 20_000);

        // Lancer Schemathesis via Docker contre le mock
        // macOS : le mock est joint via host.docker.internal (pas localhost)
        const schemaUrl = `http://host.docker.internal:${CORE_PORT}`;

        let schemaResult = "";
        let schemaExitCode = 0;

        // Sur macOS, docker-credential-desktop peut être un lien brisé — on désactive le credsStore
        const dockerEnv = { ...process.env };
        if (!dockerEnv.DOCKER_CONFIG) {
          const tmpConfig = "/tmp/sigfa-docker-nocreds";
          const { mkdirSync: mkd, writeFileSync: wf, existsSync: ex } = await import("node:fs");
          if (!ex(tmpConfig)) mkd(tmpConfig, { recursive: true });
          wf(`${tmpConfig}/config.json`, JSON.stringify({ auths: {} }));
          dockerEnv.DOCKER_CONFIG = tmpConfig;
        }

        try {
          const result = execFileSync("docker", [
            "run",
            "--rm",
            // Monter le bundle YAML en lecture seule
            "-v",
            `${CORE_BUNDLE}:/contract.yaml:ro`,
            // Ajouter host.docker.internal pour macOS
            "--add-host=host.docker.internal:host-gateway",
            "schemathesis/schemathesis",
            "run",
            "/contract.yaml",
            "--url",
            schemaUrl,
            // Limiter à la fumée : 1 exemple par opération max (schemathesis v4+)
            "--max-examples=1",
            "--checks=not_a_server_error",
          ], {
            stdio: "pipe",
            timeout: 120_000,
            env: dockerEnv,
          });
          schemaResult = result.toString();
        } catch (err: unknown) {
          const e = err as { status?: number; stdout?: Buffer; stderr?: Buffer; message?: string };
          schemaExitCode = e.status ?? 1;
          schemaResult = [
            e.stdout?.toString() ?? "",
            e.stderr?.toString() ?? "",
            e.message ?? "",
          ].join("\n");
        }

        // Journaliser le résultat Schemathesis pour le rapport
        console.info(`CONTRACT-009 Schemathesis output:\n${schemaResult}`);

        // La fumée doit passer (exit 0) OU signaler des non-conformités précises
        // Si Schemathesis détecte un échec réel (non-conformité mock↔schéma), on le rapporte
        // sans masquer — voir notes_for_orchestrator
        expect(
          schemaExitCode,
          `Schemathesis a détecté des non-conformités mock↔schéma (exit ${schemaExitCode}).\n` +
          `Détail : ${schemaResult.slice(0, 2000)}\n` +
          `Prism : ${prismOutput.slice(0, 500)}`
        ).toBe(0);
      } finally {
        stopPrism(proc);
        await new Promise((r) => setTimeout(r, 500));
      }
    },
    120_000 // timeout Docker généreux
  );

  it(
    "CONTRACT-010: fumée Schemathesis contre le mock core — zéro warning de mismatch sur la phase examples (preuve)",
    async () => {
      // Critère CONTRACT-010 : les warnings 'Schema validation mismatch' de la phase examples
      // doivent disparaître après correction des exemples UUID (bank_01 → UUIDs v4).
      // Note : la phase fuzzing peut toujours générer des warnings (données aléatoires rejetées
      // par Prism) — c'est attendu. Le critère porte sur la phase --phases=examples uniquement.
      let dockerAvailable = false;
      try {
        execSync("docker --version", { stdio: "pipe" });
        dockerAvailable = true;
      } catch {
        // Docker non disponible
      }

      if (!dockerAvailable) {
        console.warn(
          "CONTRACT-010 [SKIP-Docker]: Docker non disponible — test Schemathesis ignoré"
        );
        return;
      }

      expect(existsSync(CORE_BUNDLE), `Bundle core manquant : ${CORE_BUNDLE}`).toBe(true);

      const proc = startPrismMock("core", CORE_PORT + 1);
      let prismOutput = "";
      proc.stdout?.on("data", (d: Buffer) => { prismOutput += d.toString(); });
      proc.stderr?.on("data", (d: Buffer) => { prismOutput += d.toString(); });

      try {
        await waitForPort(CORE_PORT + 1, 20_000);

        const schemaUrl = `http://host.docker.internal:${CORE_PORT + 1}`;

        const dockerEnv = { ...process.env };
        if (!dockerEnv.DOCKER_CONFIG) {
          const tmpConfig = "/tmp/sigfa-docker-nocreds";
          const { mkdirSync: mkd, writeFileSync: wf, existsSync: ex } = await import("node:fs");
          if (!ex(tmpConfig)) mkd(tmpConfig, { recursive: true });
          wf(`${tmpConfig}/config.json`, JSON.stringify({ auths: {} }));
          dockerEnv.DOCKER_CONFIG = tmpConfig;
        }

        let schemaResult = "";
        let schemaExitCode2 = 0;
        try {
          const result = execFileSync("docker", [
            "run", "--rm",
            "-v", `${CORE_BUNDLE}:/contract.yaml:ro`,
            "--add-host=host.docker.internal:host-gateway",
            "schemathesis/schemathesis",
            "run", "/contract.yaml",
            "--url", schemaUrl,
            "--checks=not_a_server_error",
            // Limiter à la phase examples : vérifie que les exemples du spec passent
            "--phases=examples",
          ], {
            stdio: "pipe",
            timeout: 120_000,
            env: dockerEnv,
          });
          schemaResult = result.toString();
        } catch (err: unknown) {
          const e = err as { status?: number; stdout?: Buffer; stderr?: Buffer; message?: string };
          schemaExitCode2 = e.status ?? 1;
          schemaResult = [
            e.stdout?.toString() ?? "",
            e.stderr?.toString() ?? "",
            e.message ?? "",
          ].join("\n");
        }

        console.info(`CONTRACT-010 Schemathesis examples-only output:\n${schemaResult}`);

        // Phase examples : zéro warning "Schema validation mismatch"
        expect(
          schemaResult,
          "CONTRACT-010 : la phase examples ne doit PAS contenir de 'Schema validation mismatch'"
        ).not.toContain("Schema validation mismatch");

        // Exit 0 (les warnings 'Missing authentication' n'affectent pas l'exit code)
        expect(
          schemaExitCode2,
          `Schemathesis examples phase échouée (exit ${schemaExitCode2}).\nDétail : ${schemaResult.slice(0, 2000)}\nPrism : ${prismOutput.slice(0, 500)}`
        ).toBe(0);
      } finally {
        stopPrism(proc);
        await new Promise((r) => setTimeout(r, 500));
      }
    },
    120_000
  );
});
