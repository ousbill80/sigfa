/**
 * Schemathesis — périmètre CRUD admin API-008 (core.yaml + admin.yaml).
 *
 * Démarre l'API réelle (PG16 + Redis Testcontainers), seed une banque/agence/
 * service/guichet/file, puis lance Schemathesis contre :
 *   - core.yaml : /banks/{id}, /agencies*, /services*, /counters*, /queues*
 *   - admin.yaml : /agencies/{id}/hours, /banks/{id}/thresholds, /banks/{id}/sms-templates
 *
 * HORS périmètre (exclus) : /banks/{id}/theme*, /clone-from, /kiosk-access,
 * /data/*, /audit-logs (API-009/011), /agents/import.
 *
 * Jeton BANK_ADMIN scopé sur la banque seedée (couvre les routes bank/agency ;
 * les routes platform /banks GET/POST retournent 403 non-5xx, ce qui satisfait
 * la vérification not_a_server_error).
 *
 * Nommage : `API-008: CRUD complet conforme LA LOI — Schemathesis PASS core+admin`.
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
let bankId: string;

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
  const fx = await seedBankAgency(h.db, "sth-admin");
  bankId = fx.bankId;
  // Seed service + guichet + file pour exercer les routes de lecture.
  const svc = await h.db.query(
    `INSERT INTO services (bank_id, agency_id, code, name) VALUES ($1,$2,'OC','O') RETURNING id`,
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
  // Seed une opération pour exercer GET/PATCH/DELETE /operations/{id} (MODEL-API-A).
  await h.db.query(
    `INSERT INTO operations (bank_id, agency_id, service_id, code, name, sla_minutes, display_order)
     VALUES ($1,$2,$3,'DEP','Dépôt',NULL,0)`,
    [fx.bankId, fx.agencyId, serviceId]
  );
  token = await forgeToken(
    h.jwtSecretBytes,
    "BANK_ADMIN",
    fx.directorId,
    fx.bankId,
    [fx.agencyId]
  );
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

async function runSchemathesis(
  contract: string,
  includeRegex: string,
  excludePaths: string[]
): Promise<{ exitCode: number; output: string }> {
  const contractPath = join(
    import.meta.dirname,
    `../../../../packages/contracts/generated/bundled/${contract}`
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
        --checks not_a_server_error`,
      { timeout: 240_000 }
    );
    output = result.stdout + result.stderr;
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; code?: number };
    output = (e.stdout ?? "") + (e.stderr ?? "");
    exitCode = e.code ?? 1;
  }
  return { exitCode, output };
}

describe("API-008: CRUD complet conforme LA LOI — Schemathesis PASS core+admin (hors 009/011)", () => {
  it("API-008: Schemathesis PASS core.yaml (banks/agencies/services/counters/queues)", async () => {
    if (!(await dockerAvailable())) {
      console.warn("[Schemathesis core] Docker indisponible — SKIP gracieux");
      return;
    }
    const { exitCode, output } = await runSchemathesis(
      "core.yaml",
      "^/(banks|agencies|services|counters|queues)",
      ["/tickets", "/auth"]
    );
    console.log("[Schemathesis core] Output:", output.slice(0, 2500));
    expect(exitCode).toBe(0);
  }, 300_000);

  it("MODEL-API-A: Schemathesis PASS core.yaml operations (CRUD /services/{id}/operations + /operations/{id})", async () => {
    if (!(await dockerAvailable())) {
      console.warn("[Schemathesis operations] Docker indisponible — SKIP gracieux");
      return;
    }
    const { exitCode, output } = await runSchemathesis(
      "core.yaml",
      "^/(services/[^/]+/operations|operations)",
      ["/tickets", "/auth"]
    );
    console.log("[Schemathesis operations] Output:", output.slice(0, 2500));
    expect(exitCode).toBe(0);
  }, 300_000);

  it("API-008: Schemathesis PASS admin.yaml (hours/thresholds/sms-templates, hors theme/data/audit)", async () => {
    if (!(await dockerAvailable())) {
      console.warn("[Schemathesis admin] Docker indisponible — SKIP gracieux");
      return;
    }
    const { exitCode, output } = await runSchemathesis(
      "admin.yaml",
      "^/(banks/[^/]+/(thresholds|sms-templates)|agencies/[^/]+/hours)$",
      [
        "/banks/{id}/theme",
        "/banks/{id}/theme/logo-upload-url",
        "/agencies/{id}/clone-from/{templateId}",
        "/agencies/{id}/kiosk-access",
        "/audit-logs",
        "/data/purge-phone",
        "/data/retention-policy",
      ]
    );
    console.log("[Schemathesis admin] Output:", output.slice(0, 2500));
    expect(exitCode).toBe(0);
    expect(bankId).toBeTruthy();
  }, 300_000);
});
