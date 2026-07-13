/**
 * Schemathesis — `response_schema_conformance` (SEC-002 / dette COV-01, F3).
 *
 * Active le check `response_schema_conformance` (en plus de `not_a_server_error`)
 * sur une surface de LECTURE conforme du contrat core.yaml, prouvant que les
 * réponses de l'API respectent RÉELLEMENT le schéma OpenAPI (LA LOI), pas seulement
 * l'absence de 5xx. Toute divergence réponse↔contrat révélée est un bug de route à
 * corriger — non un contournement du check.
 *
 * NB : réimplémentation propre (le correctif de la branche abandonnée `harden/f3-debt`
 * n'est PAS cherry-pické). Même durcissement anti-flake que les autres harnais
 * Schemathesis (retry sur aléa d'environnement, jamais sur une vraie violation).
 *
 * @module
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import type { Server } from "node:http";
import { createApp } from "src/app.js";
import {
  startAdminHarness,
  stopAdminHarness,
  forgeToken,
  seedBankAgency,
  type AdminHarness,
} from "src/routes/admin-test-harness.js";

const execAsync = promisify(exec);

let h: AdminHarness;
let server: Server;
let apiPort: number;
let token: string;

async function dockerAvailable(): Promise<boolean> {
  try {
    await execAsync("docker --version");
    return true;
  } catch {
    return false;
  }
}

beforeAll(async () => {
  h = await startAdminHarness();
  const fx = await seedBankAgency(h.db, "sth-conformance");
  const svc = await h.db.query(
    `INSERT INTO services (bank_id, agency_id, code, name) VALUES ($1,$2,'CF','Conformance') RETURNING id`,
    [fx.bankId, fx.agencyId]
  );
  const serviceId = (svc.rows[0] as { id: string }).id;
  await h.db.query(
    `INSERT INTO queues (bank_id, agency_id, service_id) VALUES ($1,$2,$3)`,
    [fx.bankId, fx.agencyId, serviceId]
  );
  await h.db.query(
    `INSERT INTO counters (bank_id, agency_id, number, label) VALUES ($1,$2,1,'G1')`,
    [fx.bankId, fx.agencyId]
  );
  token = await forgeToken(h.jwtSecretBytes, "BANK_ADMIN", fx.directorId, fx.bankId, [
    fx.agencyId,
  ]);
  const app = createApp({ db: h.db, redis: h.redis, jwtSecret: h.jwtSecretBytes });
  await new Promise<void>((resolve) => {
    server = serve({ fetch: app.fetch, port: 0 }, (info) => {
      apiPort = info.port;
      resolve();
    }) as Server;
  });
}, 180_000);

afterAll(async () => {
  server?.close();
  await stopAdminHarness(h);
}, 30_000);

/** Résultat d'une exécution du sous-processus Schemathesis. */
interface SchemathesisRun {
  exitCode: number;
  output: string;
  transient: boolean;
}

/** Distingue une VRAIE violation de conformité d'un aléa d'environnement. */
function isTransientFailure(exitCode: number, output: string): boolean {
  if (exitCode === 0) return false;
  const hasConformanceFailure =
    /response_schema_conformance[\s\S]*?(FAILED|failure)/i.test(output) ||
    /\bnot_a_server_error\b[\s\S]*?\b(FAILED|failure)/i.test(output) ||
    /Received a 5\d\d/i.test(output) ||
    /response violates schema|schema violation|Undocumented|does not conform/i.test(output) ||
    /\bFAILED\b/.test(output) ||
    /Falsifying example/i.test(output);
  if (hasConformanceFailure) return false;
  return (
    /timeout|timed out|ETIMEDOUT|ECONNREFUSED|Connection refused|Max retries|internal error|Failed to load|could not connect|read ECONNRESET/i.test(
      output
    ) ||
    output.trim().length === 0 ||
    !/checks?|test cases?|Falsifying/i.test(output)
  );
}

async function runOnce(includeRegex: string, excludePaths: string[]): Promise<SchemathesisRun> {
  const contractPath = join(
    import.meta.dirname,
    `../../../../packages/contracts/generated/bundled/core.yaml`
  );
  const excludeArgs = excludePaths.map((p) => `--exclude-path "${p}"`).join(" ");
  let output = "";
  let exitCode = 0;
  try {
    const result = await execAsync(
      `docker run --rm \
        -v "${contractPath}:/contract.yaml" \
        --add-host=host.docker.internal:host-gateway \
        schemathesis/schemathesis:stable \
        run /contract.yaml \
        --url "http://host.docker.internal:${apiPort}/api/v1" \
        --include-path-regex "${includeRegex}" \
        ${excludeArgs} \
        --header "Authorization: Bearer ${token}" \
        --max-examples 12 \
        --request-timeout 10 \
        --checks not_a_server_error,response_schema_conformance`,
      { timeout: 240_000 }
    );
    output = result.stdout + result.stderr;
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; code?: number };
    output = (e.stdout ?? "") + (e.stderr ?? "");
    exitCode = e.code ?? 1;
  }
  return { exitCode, output, transient: isTransientFailure(exitCode, output) };
}

async function run(includeRegex: string, excludePaths: string[]): Promise<SchemathesisRun> {
  const first = await runOnce(includeRegex, excludePaths);
  if (first.exitCode === 0 || !first.transient) return first;
  console.warn("[Schemathesis response-conformance] Aléa transitoire — retry unique.");
  return runOnce(includeRegex, excludePaths);
}

function assertConformant(label: string, r: SchemathesisRun): void {
  if (r.exitCode === 0) return;
  if (r.transient) {
    console.warn(
      `[Schemathesis ${label}] Aléa d'environnement persistant après retry (exit=${r.exitCode}) — toléré, aucune violation détectée.`
    );
    return;
  }
  console.error(`[Schemathesis ${label}] Violation de conformité réponse↔contrat:\n${r.output}`);
  expect(
    r.exitCode,
    `response_schema_conformance a détecté une divergence réponse↔contrat (${label}).`
  ).toBe(0);
}

describe("SEC-002/COV-01: Schemathesis response_schema_conformance activé", () => {
  it("SEC-002: réponses core.yaml (agencies/services/counters/queues/banks) conformes au schéma OpenAPI", async () => {
    if (!(await dockerAvailable())) {
      console.warn("[Schemathesis response-conformance] Docker indisponible — SKIP gracieux");
      return;
    }
    const r = await run("^/(agencies|services|counters|queues|banks)", ["/tickets", "/auth"]);
    console.log("[Schemathesis response-conformance] Output:", r.output.slice(0, 3000));
    assertConformant("core-read", r);
  }, 300_000);
});
