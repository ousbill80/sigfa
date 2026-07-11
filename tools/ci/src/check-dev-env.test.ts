/**
 * INFRA-002: Tests Vitest + execa pour check-dev-env.sh et docker-compose.yml
 *
 * Suite de tests TDD — RED d'abord, puis implémentation.
 *
 * Critères couverts :
 *   - INFRA-002: docker compose config valide (exit 0), zéro warning
 *   - INFRA-002: images présentes + up -d postgres redis → healthy < 60s
 *   - INFRA-002: down puis up sans -v → données conservées
 *   - INFRA-002: POSTGRES_PORT surchargé via .env → service écoute sur le nouveau port
 *   - INFRA-002: grep du compose → zéro secret littéral hors interpolation ${...}
 *   - INFRA-002: compose config atteste node:22-slim, bind mount, depends_on service_healthy, command pnpm --filter dev
 *   - INFRA-002: check-dev-env.sh vert sur environnement nominal, rouge si service down
 *   - INFRA-002: .env.example enrichi des 8 variables commentées
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execa } from "execa";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

const REPO_ROOT = resolve(import.meta.dirname, "../../../");
const COMPOSE_FILE = resolve(REPO_ROOT, "docker-compose.yml");
const ENV_EXAMPLE = resolve(REPO_ROOT, ".env.example");
const CHECK_SCRIPT = resolve(REPO_ROOT, "scripts/check-dev-env.sh");

// Unique project name to avoid collision with parallel worktrees
const PROJECT = "wt-infra-002-test";

async function composeCmd(args: string[], opts: Record<string, unknown> = {}) {
  return execa(
    "docker",
    ["compose", "-f", COMPOSE_FILE, "-p", PROJECT, ...args],
    {
      cwd: REPO_ROOT,
      reject: false,
      env: { ...process.env },
      ...opts,
    }
  );
}

// ---------------------------------------------------------------------------
// INFRA-002: docker compose config valide (exit 0), zéro warning
// ---------------------------------------------------------------------------
describe("INFRA-002: docker compose config valide (exit 0), zéro warning", () => {
  it("docker compose config exits 0", async () => {
    const result = await composeCmd(["config"]);
    expect(result.exitCode, `stderr: ${result.stderr}`).toBe(0);
  });

  it("docker compose config produit zéro warning sur stderr", async () => {
    const result = await composeCmd(["config"]);
    const warnings = result.stderr
      .split("\n")
      .filter((l) => l.toLowerCase().includes("warn"));
    expect(warnings, `Warnings trouvés: ${warnings.join("; ")}`).toHaveLength(
      0
    );
  });
});

// ---------------------------------------------------------------------------
// INFRA-002: grep du compose → zéro secret littéral hors interpolation ${...}
// ---------------------------------------------------------------------------
describe("INFRA-002: grep du compose → zéro secret littéral hors ${...}", () => {
  it("docker-compose.yml n'a aucun mot de passe en dur hors interpolation", () => {
    const content = readFileSync(COMPOSE_FILE, "utf-8");
    // Une valeur de secret "en dur" = POSTGRES_PASSWORD suivi de `: valeur_literale`
    // sans interpolation ${...}. On cherche les lignes qui contiennent
    // POSTGRES_PASSWORD: <quelque-chose-qui-ne-commence-pas-par-$>
    const lines = content.split("\n");
    const hardcodedLines = lines.filter((line) => {
      // On cherche UNIQUEMENT les lignes où POSTGRES_PASSWORD est la clé
      // (pas dans une valeur comme DATABASE_URL: ...${POSTGRES_PASSWORD:-sigfa}...)
      // Pattern : indentation + POSTGRES_PASSWORD: valeur
      const match = line.match(/^\s+POSTGRES_PASSWORD\s*:\s*(.+)/);
      if (!match) return false;
      const value = match[1].trim();
      // La valeur est littérale si elle ne commence pas par ${ (interpolation)
      return !value.startsWith("${");
    });
    expect(
      hardcodedLines,
      `Secrets littéraux trouvés:\n${hardcodedLines.join("\n")}`
    ).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// INFRA-002: compose config atteste node:22-slim, bind mount, depends_on service_healthy, command pnpm --filter dev
// ---------------------------------------------------------------------------
describe("INFRA-002: compose config atteste structure services applicatifs", () => {
  let configOutput: string;

  beforeAll(async () => {
    const result = await composeCmd(["config"]);
    configOutput = result.stdout + result.stderr;
  });

  it("api utilise image node:22-slim", () => {
    expect(configOutput).toMatch(/node:22-slim/);
  });

  it("services applicatifs ont des bind mounts du monorepo", () => {
    // Bind mount : source pointe vers le répertoire racine du repo
    expect(configOutput).toMatch(/bind/);
  });

  it("services api/web/kiosk ont depends_on avec condition service_healthy", () => {
    expect(configOutput).toMatch(/service_healthy/);
  });

  it("command pnpm --filter @sigfa/api dev présente", () => {
    // docker compose config expande la commande en tableau YAML multi-lignes
    // On vérifie les éléments individuellement dans le bloc de config api
    expect(configOutput).toMatch(/@sigfa\/api/);
    // La commande inclut pnpm et dev dans le service api
    const apiSection = configOutput.match(
      /api:[\s\S]*?(?=\n  [a-z]|$)/
    )?.[0] ?? "";
    expect(apiSection).toMatch(/pnpm/);
    expect(apiSection).toMatch(/@sigfa\/api/);
    expect(apiSection).toMatch(/\bdev\b/);
  });

  it("command pnpm --filter @sigfa/web dev présente", () => {
    expect(configOutput).toMatch(/@sigfa\/web/);
    const webSection = configOutput.match(
      /web:[\s\S]*?(?=\nvolumes:|$)/
    )?.[0] ?? "";
    expect(webSection).toMatch(/pnpm/);
    expect(webSection).toMatch(/@sigfa\/web/);
    expect(webSection).toMatch(/\bdev\b/);
  });

  it("command pnpm --filter @sigfa/kiosk dev présente", () => {
    expect(configOutput).toMatch(/@sigfa\/kiosk/);
    const kioskSection = configOutput.match(
      /kiosk:[\s\S]*?(?=\n  [a-z]|$)/
    )?.[0] ?? "";
    expect(kioskSection).toMatch(/pnpm/);
    expect(kioskSection).toMatch(/@sigfa\/kiosk/);
    expect(kioskSection).toMatch(/\bdev\b/);
  });
});

// ---------------------------------------------------------------------------
// INFRA-002: .env.example enrichi des 8 variables commentées
// ---------------------------------------------------------------------------
describe("INFRA-002: .env.example contient les 8 variables commentées", () => {
  let envContent: string;

  beforeAll(() => {
    envContent = readFileSync(ENV_EXAMPLE, "utf-8");
  });

  const requiredVars = [
    "POSTGRES_PORT",
    "POSTGRES_DB",
    "POSTGRES_USER",
    "POSTGRES_PASSWORD",
    "REDIS_PORT",
    "API_PORT",
    "WEB_PORT",
    "KIOSK_PORT",
  ];

  for (const varName of requiredVars) {
    it(`${varName} est présente dans .env.example`, () => {
      expect(envContent).toMatch(new RegExp(varName));
    });
  }
});

// ---------------------------------------------------------------------------
// INFRA-002: check-dev-env.sh existe et est exécutable
// ---------------------------------------------------------------------------
describe("INFRA-002: check-dev-env.sh existe", () => {
  it("le fichier scripts/check-dev-env.sh existe", () => {
    expect(existsSync(CHECK_SCRIPT)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tests d'intégration Docker (nécessitent les services en cours d'exécution)
// Ces tests sont optionnellement skippés si SKIP_DOCKER_TESTS=1
// ---------------------------------------------------------------------------
const skipDocker = process.env["SKIP_DOCKER_TESTS"] === "1";

describe.skipIf(skipDocker)(
  "INFRA-002: images présentes + up -d postgres redis → healthy < 60s",
  () => {
    beforeAll(async () => {
      // S'assurer que les services sont arrêtés proprement avant de démarrer
      await composeCmd(["down", "-v"]);
    }, 30000);

    afterAll(async () => {
      await composeCmd(["down", "-v"]);
    }, 30000);

    it("postgres et redis atteignent l'état healthy en moins de 60s", async () => {
      const startTime = Date.now();

      // Démarrer uniquement postgres et redis
      const upResult = await composeCmd(["up", "-d", "postgres", "redis"]);
      expect(
        upResult.exitCode,
        `up stderr: ${upResult.stderr}`
      ).toBe(0);

      // Attendre que les deux services soient healthy (max 60s)
      let bothHealthy = false;
      while (Date.now() - startTime < 60000) {
        const psResult = await composeCmd(["ps", "--format", "json"]);
        if (psResult.exitCode === 0 && psResult.stdout) {
          try {
            // docker compose ps --format json peut retourner plusieurs lignes JSON
            const lines = psResult.stdout.trim().split("\n").filter(Boolean);
            const services = lines.map((l) => JSON.parse(l));
            const postgresHealthy = services.some(
              (s: { Service?: string; Health?: string }) =>
                s.Service?.includes("postgres") && s.Health === "healthy"
            );
            const redisHealthy = services.some(
              (s: { Service?: string; Health?: string }) =>
                s.Service?.includes("redis") && s.Health === "healthy"
            );
            if (postgresHealthy && redisHealthy) {
              bothHealthy = true;
              break;
            }
          } catch {
            // JSON parse error, continuer
          }
        }
        await new Promise((r) => setTimeout(r, 2000));
      }

      const elapsed = Date.now() - startTime;
      expect(
        bothHealthy,
        `Services non healthy après ${elapsed}ms`
      ).toBe(true);
      expect(elapsed).toBeLessThan(60000);
    }, 75000);

    it("pg_isready répond OK", async () => {
      const result = await execa(
        "docker",
        [
          "compose",
          "-f", COMPOSE_FILE,
          "-p", PROJECT,
          "exec",
          "-T",
          "postgres",
          "pg_isready",
          "-U", "sigfa",
        ],
        { cwd: REPO_ROOT, reject: false }
      );
      expect(result.exitCode, `stderr: ${result.stderr}`).toBe(0);
    }, 15000);

    it("redis répond PONG au PING", async () => {
      const result = await execa(
        "docker",
        [
          "compose",
          "-f", COMPOSE_FILE,
          "-p", PROJECT,
          "exec",
          "-T",
          "redis",
          "redis-cli",
          "ping",
        ],
        { cwd: REPO_ROOT, reject: false }
      );
      expect(result.exitCode, `stderr: ${result.stderr}`).toBe(0);
      expect(result.stdout.trim()).toBe("PONG");
    }, 15000);
  }
);

describe.skipIf(skipDocker)(
  "INFRA-002: down puis up sans -v → données conservées",
  () => {
    beforeAll(async () => {
      await composeCmd(["down", "-v"]);
      await composeCmd(["up", "-d", "postgres", "redis"]);
      // Attendre que postgres soit healthy
      let healthy = false;
      for (let i = 0; i < 30; i++) {
        const psResult = await composeCmd(["ps", "--format", "json"]);
        if (psResult.exitCode === 0 && psResult.stdout) {
          try {
            const lines = psResult.stdout.trim().split("\n").filter(Boolean);
            const services = lines.map((l) => JSON.parse(l));
            healthy = services.some(
              (s: { Service?: string; Health?: string }) =>
                s.Service?.includes("postgres") && s.Health === "healthy"
            );
            if (healthy) break;
          } catch {
            // continue
          }
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
    }, 90000);

    afterAll(async () => {
      await composeCmd(["down", "-v"]);
    }, 30000);

    it("une donnée écrite avant down est toujours lisible après up", async () => {
      // Écrire une donnée dans postgres
      const writeResult = await execa(
        "docker",
        [
          "compose",
          "-f", COMPOSE_FILE,
          "-p", PROJECT,
          "exec",
          "-T",
          "postgres",
          "psql",
          "-U", "sigfa",
          "-d", "sigfa",
          "-c",
          "CREATE TABLE IF NOT EXISTS infra002_test (val TEXT); INSERT INTO infra002_test VALUES ('persistence-check');",
        ],
        { cwd: REPO_ROOT, reject: false }
      );
      expect(writeResult.exitCode, `write stderr: ${writeResult.stderr}`).toBe(0);

      // Down sans -v
      await composeCmd(["down"]);

      // Up de nouveau
      await composeCmd(["up", "-d", "postgres"]);

      // Attendre healthy
      let healthy = false;
      for (let i = 0; i < 30; i++) {
        const psResult = await composeCmd(["ps", "--format", "json"]);
        if (psResult.exitCode === 0 && psResult.stdout) {
          try {
            const lines = psResult.stdout.trim().split("\n").filter(Boolean);
            const services = lines.map((l) => JSON.parse(l));
            healthy = services.some(
              (s: { Service?: string; Health?: string }) =>
                s.Service?.includes("postgres") && s.Health === "healthy"
            );
            if (healthy) break;
          } catch {
            // continue
          }
        }
        await new Promise((r) => setTimeout(r, 2000));
      }

      // Lire la donnée
      const readResult = await execa(
        "docker",
        [
          "compose",
          "-f", COMPOSE_FILE,
          "-p", PROJECT,
          "exec",
          "-T",
          "postgres",
          "psql",
          "-U", "sigfa",
          "-d", "sigfa",
          "-t",
          "-c",
          "SELECT val FROM infra002_test WHERE val = 'persistence-check';",
        ],
        { cwd: REPO_ROOT, reject: false }
      );
      expect(readResult.exitCode, `read stderr: ${readResult.stderr}`).toBe(0);
      expect(readResult.stdout).toMatch(/persistence-check/);
    }, 120000);
  }
);

describe.skipIf(skipDocker)(
  "INFRA-002: POSTGRES_PORT surchargé via .env → service écoute sur le nouveau port",
  () => {
    afterAll(async () => {
      await composeCmd(["down", "-v"]);
    }, 30000);

    it("surcharge POSTGRES_PORT=5499 → postgres écoute sur 5499", async () => {
      // Démarrer postgres avec port surchargé via env
      await composeCmd(["down", "-v"]);

      const upResult = await execa(
        "docker",
        [
          "compose",
          "-f", COMPOSE_FILE,
          "-p", PROJECT,
          "up", "-d", "postgres",
        ],
        {
          cwd: REPO_ROOT,
          reject: false,
          env: { ...process.env, POSTGRES_PORT: "5499" },
        }
      );
      expect(upResult.exitCode, `up stderr: ${upResult.stderr}`).toBe(0);

      // Attendre healthy
      let healthy = false;
      for (let i = 0; i < 30; i++) {
        const psResult = await execa(
          "docker",
          ["compose", "-f", COMPOSE_FILE, "-p", PROJECT, "ps", "--format", "json"],
          { cwd: REPO_ROOT, reject: false, env: { ...process.env, POSTGRES_PORT: "5499" } }
        );
        if (psResult.exitCode === 0 && psResult.stdout) {
          try {
            const lines = psResult.stdout.trim().split("\n").filter(Boolean);
            const services = lines.map((l) => JSON.parse(l));
            healthy = services.some(
              (s: { Service?: string; Health?: string }) =>
                s.Service?.includes("postgres") && s.Health === "healthy"
            );
            if (healthy) break;
          } catch {
            // continue
          }
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
      expect(healthy, "postgres non healthy avec port surchargé").toBe(true);

      // Vérifier que le port 5499 est bien bindé
      const portResult = await execa(
        "docker",
        ["compose", "-f", COMPOSE_FILE, "-p", PROJECT, "port", "postgres", "5432"],
        { cwd: REPO_ROOT, reject: false, env: { ...process.env, POSTGRES_PORT: "5499" } }
      );
      expect(portResult.stdout).toMatch(/5499/);
    }, 90000);
  }
);

describe.skipIf(skipDocker)(
  "INFRA-002: check-dev-env.sh vert sur environnement nominal, rouge si service down",
  () => {
    beforeAll(async () => {
      await composeCmd(["down", "-v"]);
      await composeCmd(["up", "-d", "postgres", "redis"]);
      // Attendre healthy
      for (let i = 0; i < 30; i++) {
        const psResult = await composeCmd(["ps", "--format", "json"]);
        if (psResult.exitCode === 0 && psResult.stdout) {
          try {
            const lines = psResult.stdout.trim().split("\n").filter(Boolean);
            const services = lines.map((l) => JSON.parse(l));
            const ok = services.every(
              (s: { Health?: string }) => !s.Health || s.Health === "healthy"
            );
            if (ok && services.length >= 2) break;
          } catch {
            // continue
          }
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
    }, 90000);

    afterAll(async () => {
      await composeCmd(["down", "-v"]);
    }, 30000);

    it("check-dev-env.sh exit 0 quand les services sont healthy", async () => {
      const result = await execa("bash", [CHECK_SCRIPT], {
        cwd: REPO_ROOT,
        reject: false,
        env: {
          ...process.env,
          COMPOSE_FILE: COMPOSE_FILE,
          COMPOSE_PROJECT_NAME: PROJECT,
        },
      });
      expect(result.exitCode, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
    }, 30000);

    it("check-dev-env.sh exit non-0 avec message clair si services down", async () => {
      // Arrêter les services
      await composeCmd(["stop", "postgres", "redis"]);

      const result = await execa("bash", [CHECK_SCRIPT], {
        cwd: REPO_ROOT,
        reject: false,
        env: {
          ...process.env,
          COMPOSE_FILE: COMPOSE_FILE,
          COMPOSE_PROJECT_NAME: PROJECT,
        },
      });
      expect(result.exitCode).not.toBe(0);
      const output = result.stdout + result.stderr;
      // Doit contenir un message explicatif (pas juste un code d'erreur)
      expect(output.length).toBeGreaterThan(10);
    }, 30000);
  }
);
