/**
 * Tests d'intégration — GET /agencies/{id}/kiosks/status (ADM-003a, admin.yaml).
 *
 * Testcontainers PG16 réel + bus de capture. Couvre :
 *  - statut dérivé À LA LECTURE (ONLINE/DEGRADED/SILENT/NEVER_SEEN) depuis last_seen ;
 *  - RBAC AGENCY_DIRECTOR+ : AGENT → 403 ;
 *  - tenant-isolation : agence d'un autre tenant → 403 opaque (hors scope) ;
 *  - alerte « muette » débouncée émise vers la room STAFF (kiosk:silent) ;
 *  - reprise heartbeat → kiosk:recovered.
 *
 * Nommage strict `ADM-003a: …`.
 *
 * @module
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { serve } from "@hono/node-server";
import type { Server } from "node:http";
import { createApp } from "src/app.js";
import { createCaptureBus, type CaptureBus } from "src/services/realtime.js";
import {
  startAdminHarness,
  stopAdminHarness,
  forgeToken,
  seedBankAgency,
  type AdminHarness,
  type BankFixture,
} from "src/routes/admin-test-harness.js";

let h: AdminHarness;
let server: Server;
let baseUrl: string;
let bus: CaptureBus;
let bankA: BankFixture;
let bankB: BankFixture;
let directorAToken: string;
let agentAToken: string;
let directorBToken: string;

/**
 * Insère une borne avec un `last_seen` donné (secondes dans le passé, ou null).
 *
 * @param fx           - Fixture banque/agence
 * @param secondsAgo   - Ancienneté du dernier heartbeat (null = jamais vue)
 * @param printerStatus - Statut imprimante
 * @returns id de la borne
 */
async function seedKiosk(
  fx: BankFixture,
  secondsAgo: number | null,
  printerStatus = "OK"
): Promise<string> {
  const lastSeen = secondsAgo === null ? "NULL" : `now() - interval '${secondsAgo} seconds'`;
  const res = await h.db.query(
    `INSERT INTO kiosks (bank_id, agency_id, label, credentials_hash, printer_status, last_seen)
     VALUES ($1, $2, 'B', 'x', $3::printer_status, ${lastSeen}) RETURNING id`,
    [fx.bankId, fx.agencyId, printerStatus]
  );
  return (res.rows[0] as { id: string }).id;
}

beforeAll(async () => {
  h = await startAdminHarness();
  bankA = await seedBankAgency(h.db, "adm003a-a");
  bankB = await seedBankAgency(h.db, "adm003a-b");
  directorAToken = await forgeToken(
    h.jwtSecretBytes,
    "AGENCY_DIRECTOR",
    bankA.directorId,
    bankA.bankId,
    [bankA.agencyId]
  );
  agentAToken = await forgeToken(
    h.jwtSecretBytes,
    "AGENT",
    bankA.directorId,
    bankA.bankId,
    [bankA.agencyId]
  );
  directorBToken = await forgeToken(
    h.jwtSecretBytes,
    "AGENCY_DIRECTOR",
    bankB.directorId,
    bankB.bankId,
    [bankB.agencyId]
  );
  bus = createCaptureBus();
  const app = createApp({ db: h.db, redis: h.redis, jwtSecret: h.jwtSecretBytes, bus });
  await new Promise<void>((resolve) => {
    server = serve({ fetch: app.fetch, port: 0 }, (info) => {
      baseUrl = `http://127.0.0.1:${info.port}/api/v1`;
      resolve();
    }) as Server;
  });
});

afterAll(async () => {
  server?.close();
  await stopAdminHarness(h);
});

beforeEach(async () => {
  await h.db.query("DELETE FROM kiosks");
  bus.events.length = 0;
});

/** Appelle GET /agencies/:id/kiosks/status avec un token donné. */
async function getStatus(agencyId: string, token: string): Promise<Response> {
  return fetch(`${baseUrl}/agencies/${agencyId}/kiosks/status`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

describe("ADM-003a: GET /agencies/{id}/kiosks/status — supervision borne", () => {
  it("ADM-003a: statut dérivé à la lecture — ONLINE/DEGRADED/SILENT/NEVER_SEEN", async () => {
    const online = await seedKiosk(bankA, 10); // < 60 s → ONLINE
    const degraded = await seedKiosk(bankA, 75); // ∈ [60,90) → DEGRADED
    const silent = await seedKiosk(bankA, 600); // ≥ 90 s → SILENT
    const neverSeen = await seedKiosk(bankA, null); // last_seen null → NEVER_SEEN

    const res = await getStatus(bankA.agencyId, directorAToken);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      kiosks: { kioskId: string; status: string; lastSeen: string | null }[];
    };
    const byId = new Map(body.kiosks.map((k) => [k.kioskId, k]));
    expect(byId.get(online)?.status).toBe("ONLINE");
    expect(byId.get(degraded)?.status).toBe("DEGRADED");
    expect(byId.get(silent)?.status).toBe("SILENT");
    expect(byId.get(neverSeen)?.status).toBe("NEVER_SEEN");
    expect(byId.get(neverSeen)?.lastSeen).toBeNull();
  });

  it("ADM-003a: imprimante KO avec heartbeat récent → DEGRADED (anomalie signalée)", async () => {
    const id = await seedKiosk(bankA, 10, "ERROR");
    const res = await getStatus(bankA.agencyId, directorAToken);
    const body = (await res.json()) as { kiosks: { kioskId: string; status: string }[] };
    expect(body.kiosks.find((k) => k.kioskId === id)?.status).toBe("DEGRADED");
  });

  it("ADM-003a: RBAC — AGENT refusé (403), AGENCY_DIRECTOR autorisé", async () => {
    await seedKiosk(bankA, 10);
    expect((await getStatus(bankA.agencyId, agentAToken)).status).toBe(403);
    expect((await getStatus(bankA.agencyId, directorAToken)).status).toBe(200);
  });

  it("ADM-003a: tenant-isolation — agence d'un autre tenant → 403 (hors scope)", async () => {
    await seedKiosk(bankB, 10);
    const res = await getStatus(bankB.agencyId, directorAToken);
    expect(res.status).toBe(403);
  });

  it("ADM-003a: bascule SILENT → kiosk:silent débouncé vers la room STAFF (une fois)", async () => {
    await seedKiosk(bankA, 600); // SILENT
    await getStatus(bankA.agencyId, directorAToken);
    await getStatus(bankA.agencyId, directorAToken); // débounce : pas de doublon
    const silent = bus.ofType("kiosk:silent");
    expect(silent).toHaveLength(1);
    expect(silent[0]?.agencyId).toBe(bankA.agencyId);
    expect(silent[0]?.payload).toMatchObject({ status: "SILENT" });
  });

  it("ADM-003a: reprise heartbeat après silence → kiosk:recovered", async () => {
    const id = await seedKiosk(bankA, 600); // SILENT
    await getStatus(bankA.agencyId, directorAToken); // ouvre l'épisode
    // La borne réémet un heartbeat récent.
    await h.db.query(`UPDATE kiosks SET last_seen = now() WHERE id = $1`, [id]);
    await getStatus(bankA.agencyId, directorAToken); // ferme l'épisode
    expect(bus.ofType("kiosk:recovered")).toHaveLength(1);
    expect(bus.ofType("kiosk:recovered")[0]?.payload).toMatchObject({ status: "ONLINE" });
  });

  it("ADM-003a: agence inconnue (UUID non existant) → 200 liste vide (jamais 500)", async () => {
    const res = await getStatus(bankB.agencyId, directorBToken);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { kiosks: unknown[] };
    expect(body.kiosks).toEqual([]);
  });
});
