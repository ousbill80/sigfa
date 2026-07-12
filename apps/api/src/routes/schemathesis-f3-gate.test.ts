/**
 * Schemathesis — GATE DE SORTIE F3 (API-011).
 *
 * Démarre l'API réelle (PG16 + Redis Testcontainers) puis lance Schemathesis
 * contre TOUS les modules implémentés en F3, `/ai/*` EXCLUS (F10, non implémentées) :
 *   - notifications.yaml : /notifications/devices (POST/DELETE) — module devices ;
 *   - reporting.yaml     : /health (public) + /kiosks/status (supervision) ;
 *   - public.yaml        : /kiosks/{kioskId}/heartbeat.
 *
 * Les modules core/public(tickets)/admin/agents sont déjà couverts par leurs propres
 * tests Schemathesis (API-008/009/010) et restent verts sur main. Ce fichier ajoute
 * la couverture des surfaces NOUVELLES d'API-011, complétant le gate F3.
 *
 * Vérifie l'absence de server error (5xx) sur toutes les entrées générées.
 * Nommage : `API-011: Schemathesis PASS ...`.
 *
 * @module
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import type { Server } from "node:http";
import { SignJWT } from "jose";
import { createApp } from "src/app.js";
import {
  startAdminHarness,
  stopAdminHarness,
  seedBankAgency,
  type AdminHarness,
} from "src/routes/admin-test-harness.js";

const execAsync = promisify(exec);

let h: AdminHarness;
let server: Server;
let apiPort: number;
let bankToken: string;
let kioskToken: string;

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
  const fx = await seedBankAgency(h.db, "sth-f3");
  const kiosk = await h.db.query(
    `INSERT INTO kiosks (bank_id, agency_id, label, credentials_hash, last_seen)
     VALUES ($1,$2,'B','x', now()) RETURNING id`,
    [fx.bankId, fx.agencyId]
  );
  const kioskId = (kiosk.rows[0] as { id: string }).id;
  bankToken = await new SignJWT({ role: "BANK_ADMIN", bankId: fx.bankId, agencyIds: [fx.agencyId] })
    .setProtectedHeader({ alg: "HS256" }).setSubject(fx.directorId).setIssuedAt().setExpirationTime("1h").sign(h.jwtSecretBytes);
  kioskToken = await new SignJWT({ role: "AUTHENTICATED", bankId: fx.bankId, agencyIds: [fx.agencyId], kioskId })
    .setProtectedHeader({ alg: "HS256" }).setSubject("kiosk").setIssuedAt().setExpirationTime("1h").sign(h.jwtSecretBytes);
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

/** Lance Schemathesis sur un contrat/filtre avec un jeton donné. */
async function runSchemathesis(
  contract: string,
  includeRegex: string,
  token: string
): Promise<{ exitCode: number; output: string }> {
  const contractPath = join(
    import.meta.dirname,
    `../../../../packages/contracts/generated/bundled/${contract}`
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
        --include-path-regex "${includeRegex}" \
        --header "Authorization: Bearer ${token}" \
        --max-examples 15 \
        --request-timeout 10000 \
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

describe("API-011: Schemathesis PASS gate F3 (modules implémentés, /ai exclus)", () => {
  it("API-011: Schemathesis PASS notifications-devices", async () => {
    if (!(await dockerAvailable())) {
      console.warn("[Schemathesis F3 devices] Docker indisponible — SKIP gracieux");
      return;
    }
    const { exitCode, output } = await runSchemathesis("notifications.yaml", "^/notifications/devices", bankToken);
    console.log("[Schemathesis F3 devices] Output:", output.slice(0, 2500));
    expect(exitCode).toBe(0);
  }, 300_000);

  it("API-011: Schemathesis PASS reporting health+kiosks-status (ai exclu de facto)", async () => {
    if (!(await dockerAvailable())) {
      console.warn("[Schemathesis F3 reporting] Docker indisponible — SKIP gracieux");
      return;
    }
    const { exitCode, output } = await runSchemathesis("reporting.yaml", "^/(health|kiosks/status)$", bankToken);
    console.log("[Schemathesis F3 reporting] Output:", output.slice(0, 2500));
    expect(exitCode).toBe(0);
  }, 300_000);

  it("API-011: Schemathesis PASS public heartbeat", async () => {
    if (!(await dockerAvailable())) {
      console.warn("[Schemathesis F3 heartbeat] Docker indisponible — SKIP gracieux");
      return;
    }
    const { exitCode, output } = await runSchemathesis("public.yaml", "^/kiosks/[^/]+/heartbeat$", kioskToken);
    console.log("[Schemathesis F3 heartbeat] Output:", output.slice(0, 2500));
    expect(exitCode).toBe(0);
  }, 300_000);
});
