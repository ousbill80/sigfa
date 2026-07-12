/**
 * Routes devices push — API-011 (notifications.yaml).
 *
 * - `POST   /notifications/devices`            — enregistrement IDEMPOTENT d'un token
 *   push (AUTHENTICATED, scope bank). Premier enregistrement → `201`, ré-enregistrement
 *   du MÊME token → `200` (upsert `ON CONFLICT (device_token)`), même `deviceId`.
 * - `DELETE /notifications/devices/{deviceId}` — révocation OWNERSHIP : un device ne
 *   peut être supprimé que par sa banque propriétaire (sinon `404 DEVICE_NOT_FOUND`).
 *
 * Le reste du module notifications (envois, opt-in/out, log) est hors périmètre (F6).
 *
 * @module
 */

import { Hono } from "hono";
import { z } from "zod";
import type { Client } from "pg";
import type { Redis } from "ioredis";
import { SigfaError } from "src/lib/errors.js";
import type { TenantContext } from "src/middleware/tenant.js";
import { errorResponse, paramUuid, parseJson, parseStrict, requireBankId } from "src/lib/admin-helpers.js";

/** Variables de contexte Hono du routeur devices. */
interface DeviceEnv {
  Variables: {
    db: Client;
    redis: Redis;
    jwtSecret: Uint8Array;
    tenant: TenantContext;
  };
}

/** Plateformes push (LA LOI `PushPlatform`). */
const PUSH_PLATFORMS = ["IOS", "ANDROID", "EXPO"] as const;

/** Corps de POST /notifications/devices (LA LOI). */
const registerSchema = z
  .object({
    deviceToken: z.string().min(1).max(512),
    platform: z.enum(PUSH_PLATFORMS),
  })
  .strict();

/** Ligne brute projetée de `notification_devices`. */
interface DeviceRow {
  id: string;
  device_token: string;
  platform: string;
  registered_at: Date;
  inserted: boolean;
}

/**
 * Crée le routeur devices (monté sous /api/v1).
 *
 * @returns Routeur Hono des routes devices API-011
 */
export function createDeviceRouter(): Hono<DeviceEnv> {
  const router = new Hono<DeviceEnv>();
  registerDevice(router);
  deleteDevice(router);
  return router;
}

/** Enregistre POST /notifications/devices (idempotent 201/200). */
function registerDevice(router: Hono<DeviceEnv>): void {
  router.post("/notifications/devices", async (c) => {
    const db = c.get("db");
    const tenant = c.get("tenant");
    try {
      const bankId = requireBankId(tenant);
      const input = parseStrict(registerSchema, await parseJson(c));
      const row = await upsertDevice(db, bankId, input.deviceToken, input.platform);
      return c.json(toDeviceRegistration(row), row.inserted ? 201 : 200);
    } catch (err) {
      return errorResponse(c, err);
    }
  });
}

/**
 * Upsert idempotent d'un device par token (globalement unique). `inserted` vaut
 * `true` uniquement à la première insertion (`xmax = 0` sur la ligne renvoyée) et
 * `false` sur un ré-enregistrement — ce qui pilote le code HTTP 201 vs 200.
 *
 * @param db          - Client PG
 * @param bankId      - Banque propriétaire
 * @param deviceToken - Token push (unique global)
 * @param platform    - Plateforme push
 * @returns Ligne du device + drapeau `inserted`
 */
async function upsertDevice(
  db: Client,
  bankId: string,
  deviceToken: string,
  platform: string
): Promise<DeviceRow> {
  const res = await db.query(
    `INSERT INTO notification_devices (bank_id, device_token, platform)
     VALUES ($1, $2, $3::push_platform)
     ON CONFLICT (device_token)
       DO UPDATE SET bank_id = EXCLUDED.bank_id,
                     platform = EXCLUDED.platform,
                     last_seen = now(),
                     revoked_at = NULL
     RETURNING id, device_token, platform, created_at AS registered_at,
               (xmax = 0) AS inserted`,
    [bankId, deviceToken, platform]
  );
  return res.rows[0] as DeviceRow;
}

/** Enregistre DELETE /notifications/devices/:deviceId (ownership). */
function deleteDevice(router: Hono<DeviceEnv>): void {
  router.delete("/notifications/devices/:deviceId", async (c) => {
    const db = c.get("db");
    const tenant = c.get("tenant");
    try {
      const deviceId = paramUuid(c, "deviceId");
      const bankId = requireBankId(tenant);
      const res = await db.query(
        `DELETE FROM notification_devices WHERE id = $1 AND bank_id = $2 RETURNING id`,
        [deviceId, bankId]
      );
      if (res.rows.length === 0) {
        throw new SigfaError("DEVICE_NOT_FOUND", "Device introuvable.", 404);
      }
      return c.json({ success: true }, 200);
    } catch (err) {
      return errorResponse(c, err);
    }
  });
}

/**
 * Projette une ligne device vers la ressource `DeviceRegistration` de LA LOI.
 *
 * @param row - Ligne du device
 * @returns Ressource conforme au contrat
 */
function toDeviceRegistration(row: DeviceRow): Record<string, unknown> {
  return {
    deviceId: row.id,
    deviceToken: row.device_token,
    platform: row.platform,
    registeredAt: row.registered_at.toISOString(),
  };
}
