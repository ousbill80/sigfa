/**
 * Schemathesis — périmètre onboarding & plateforme API-009 (admin.yaml).
 *
 * Démarre l'API réelle (PG16 + Redis Testcontainers), seed une banque/agence,
 * puis lance Schemathesis contre les routes 009 d'admin.yaml :
 *   - /banks/{id}/theme, /banks/{id}/theme/logo-upload-url
 *   - /agencies/{id}/clone-from/{templateId}, /agencies/{id}/kiosk-access
 *   - /data/purge-phone, /data/retention-policy
 *
 * La partie public (session borne / heartbeat) relève d'API-011 côté cible.
 * Jeton BANK_ADMIN scopé sur la banque seedée (couvre bank + agency).
 *
 * Nommage : `API-009: Schemathesis PASS (admin onboarding/theme/data)`.
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
  const fx = await seedBankAgency(h.db, "sth-onb");
  bankId = fx.bankId;
  // Thème initial + politique de rétention pour exercer les lectures.
  await h.db.query(`UPDATE banks SET theme=$2::jsonb WHERE id=$1`, [
    fx.bankId,
    JSON.stringify({
      requestedColors: { primary: "#003f7f", secondary: "#e8a000", background: "#ffffff" },
      welcomeMessages: { fr: "Bienvenue" },
    }),
  ]);
  await h.db.query(
    `INSERT INTO retention_policies (bank_id, phone_retention_months) VALUES ($1, 13)`,
    [fx.bankId]
  );
  token = await forgeToken(h.jwtSecretBytes, "BANK_ADMIN", fx.directorId, fx.bankId, [fx.agencyId]);
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

describe("API-009: Schemathesis PASS (admin onboarding/theme/data)", () => {
  it("API-009: Schemathesis PASS admin.yaml (theme/clone/kiosk-access/data)", async () => {
    if (!(await dockerAvailable())) {
      console.warn("[Schemathesis 009] Docker indisponible — SKIP gracieux");
      return;
    }
    const contractPath = join(
      import.meta.dirname,
      "../../../../packages/contracts/generated/bundled/admin.yaml"
    );
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
          --include-path-regex "^/(banks/[^/]+/theme|agencies/[^/]+/(clone-from|kiosk-access)|data/)" \
          --header "Authorization: Bearer ${token}" \
          --header "X-Idempotency-Key: sth-idem-key" \
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
    console.log("[Schemathesis 009] Output:", output.slice(0, 2500));
    expect(exitCode).toBe(0);
    expect(bankId).toBeTruthy();
  }, 300_000);
});
