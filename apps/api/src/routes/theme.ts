/**
 * Routes theming banque — API-009 (admin.yaml).
 *
 * - GET   /banks/:id/theme                 — thème (requestedColors + appliedColors + welcomeMessages).
 * - PATCH /banks/:id/theme                 — met à jour requestedColors/welcomeMessages ;
 *   `appliedColors` recalculées avec correction de contraste WCAG ≥4.5:1.
 * - GET   /banks/:id/theme/logo-upload-url — URL présignée R2 (503 si R2 non configuré).
 *
 * Le thème est persisté dans la colonne `banks.theme` (JSONB). Les couleurs
 * appliquées ne sont JAMAIS fournies par le client : elles dérivent toujours des
 * `requestedColors` via `correctContrast` (module WCAG dédié testé).
 *
 * @module
 */

import { Hono } from "hono";
import { z } from "zod";
import type { Client } from "pg";
import type { Redis } from "ioredis";
import { SigfaError } from "src/lib/errors.js";
import type { TenantContext } from "src/middleware/tenant.js";
import {
  paramUuid,
  errorResponse,
  parseJson,
  parseStrict,
  requireBankId,
} from "src/lib/admin-helpers.js";
import { recordAudit, buildDiff, extractIp } from "src/lib/audit-context.js";
import { correctContrast } from "src/lib/wcag-contrast.js";
import {
  getR2Config,
  presignLogoPut,
  PRESIGN_EXPIRES_IN,
} from "src/lib/r2-presign.js";

/** Variables de contexte Hono du routeur theming. */
interface ThemeEnv {
  Variables: {
    db: Client;
    redis: Redis;
    jwtSecret: Uint8Array;
    tenant: TenantContext;
  };
}

/** Types MIME acceptés pour le logo (LA LOI). */
const ACCEPTED_LOGO_TYPES = ["image/png", "image/svg+xml", "image/jpeg"] as const;

/** Ensemble de couleurs (LA LOI ColorSet, additionalProperties: false). */
const colorSetSchema = z
  .object({
    primary: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
    secondary: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
    background: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  })
  .strict();

/** Messages de bienvenue (LA LOI WelcomeMessages). */
const welcomeMessagesSchema = z
  .object({
    fr: z.string().max(200),
    dioula: z.string().max(200).optional(),
    baoule: z.string().max(200).optional(),
    en: z.string().max(200).optional(),
  })
  .strict();

/** Corps de PATCH /banks/:id/theme (LA LOI UpdateBankThemeRequest). */
const updateThemeSchema = z
  .object({
    requestedColors: colorSetSchema.optional(),
    welcomeMessages: welcomeMessagesSchema.optional(),
  })
  .strict();

/** Couleurs par défaut si aucune n'a jamais été soumise. */
const DEFAULT_COLORS = {
  primary: "#003f7f",
  secondary: "#e8a000",
  background: "#ffffff",
} as const;

/** Forme du thème persisté dans `banks.theme`. */
interface StoredTheme {
  logoUrl?: string | null;
  requestedColors?: z.infer<typeof colorSetSchema>;
  welcomeMessages?: z.infer<typeof welcomeMessagesSchema>;
}

/**
 * Crée le routeur theming (monté sous /api/v1).
 *
 * @returns Routeur Hono des routes theming API-009
 */
export function createThemeRouter(): Hono<ThemeEnv> {
  const router = new Hono<ThemeEnv>();
  registerGetTheme(router);
  registerPatchTheme(router);
  registerLogoUploadUrl(router);
  return router;
}

/** Charge le thème stocké d'une banque du tenant, ou 404. */
async function loadTheme(db: Client, bankId: string): Promise<StoredTheme> {
  const res = await db.query(
    `SELECT theme FROM banks WHERE id = $1 AND deleted_at IS NULL`,
    [bankId]
  );
  const row = res.rows[0] as { theme: StoredTheme } | undefined;
  if (!row) throw new SigfaError("NOT_FOUND", "Banque introuvable.", 404);
  return row.theme ?? {};
}

/** Applique la correction de contraste à chaque couleur de premier plan. */
function applyContrast(
  requested: z.infer<typeof colorSetSchema>
): z.infer<typeof colorSetSchema> {
  return {
    primary: correctContrast(requested.primary, requested.background),
    secondary: correctContrast(requested.secondary, requested.background),
    background: requested.background.toLowerCase(),
  };
}

/** Compose la ressource BankTheme (LA LOI) depuis le thème stocké. */
function composeTheme(stored: StoredTheme): Record<string, unknown> {
  const requestedColors = stored.requestedColors ?? { ...DEFAULT_COLORS };
  return {
    logoUrl: stored.logoUrl ?? null,
    requestedColors,
    appliedColors: applyContrast(requestedColors),
    welcomeMessages: stored.welcomeMessages ?? { fr: "Bienvenue" },
  };
}

/** Enregistre GET /banks/:id/theme. */
function registerGetTheme(router: Hono<ThemeEnv>): void {
  router.get("/banks/:id/theme", async (c) => {
    const db = c.get("db");
    try {
      const id = paramUuid(c, "id");
      requireBankId(c.get("tenant"));
      const stored = await loadTheme(db, id);
      return c.json(composeTheme(stored), 200);
    } catch (err) {
      return errorResponse(c, err);
    }
  });
}

/** Enregistre PATCH /banks/:id/theme (recalcul appliedColors) + audit. */
function registerPatchTheme(router: Hono<ThemeEnv>): void {
  router.patch("/banks/:id/theme", async (c) => {
    const db = c.get("db");
    const tenant = c.get("tenant");
    try {
      const id = paramUuid(c, "id");
      requireBankId(tenant);
      const input = parseStrict(updateThemeSchema, await parseJson(c));
      const before = await loadTheme(db, id);
      const merged: StoredTheme = {
        ...before,
        ...(input.requestedColors ? { requestedColors: input.requestedColors } : {}),
        ...(input.welcomeMessages ? { welcomeMessages: input.welcomeMessages } : {}),
      };
      await db.query(
        `UPDATE banks SET theme = $2::jsonb, updated_at = now()
          WHERE id = $1 AND deleted_at IS NULL`,
        [id, JSON.stringify(merged)]
      );
      await recordAudit({
        db,
        tenant,
        action: "PATCH /banks/:id/theme",
        entityType: "bank_theme",
        entityId: id,
        ip: extractIp((n) => c.req.header(n)),
        diff: buildDiff(
          { requestedColors: before.requestedColors ?? null },
          { requestedColors: merged.requestedColors ?? null }
        ),
      });
      return c.json(composeTheme(merged), 200);
    } catch (err) {
      return errorResponse(c, err);
    }
  });
}

/** Enregistre GET /banks/:id/theme/logo-upload-url (presign R2 ou 503). */
function registerLogoUploadUrl(router: Hono<ThemeEnv>): void {
  router.get("/banks/:id/theme/logo-upload-url", async (c) => {
    try {
      const id = paramUuid(c, "id");
      requireBankId(c.get("tenant"));
      const contentType = assertContentType(c.req.query("contentType"));
      const config = getR2Config();
      if (!config) {
        throw new SigfaError(
          "R2_NOT_CONFIGURED",
          "Stockage R2 non configuré (dev). Upload de logo indisponible.",
          503
        );
      }
      const presignedUrl = presignLogoPut({
        config,
        objectKey: `logos/${id}/logo.${extensionFor(contentType)}`,
      });
      return c.json(
        {
          presignedUrl,
          expiresIn: PRESIGN_EXPIRES_IN,
          maxSizeBytes: 2_000_000,
          minDimensionsPx: 200,
        },
        200
      );
    } catch (err) {
      return errorResponse(c, err);
    }
  });
}

/** Valide le contentType (422 UNSUPPORTED_MEDIA_TYPE si hors liste). */
function assertContentType(value: string | undefined): string {
  if (!value || !ACCEPTED_LOGO_TYPES.includes(value as (typeof ACCEPTED_LOGO_TYPES)[number])) {
    throw new SigfaError(
      "UNSUPPORTED_MEDIA_TYPE",
      "Type MIME non accepté. Formats valides : image/png, image/svg+xml, image/jpeg.",
      422,
      { accepted: [...ACCEPTED_LOGO_TYPES] }
    );
  }
  return value;
}

/** Extension de fichier associée au type MIME du logo. */
function extensionFor(contentType: string): string {
  if (contentType === "image/svg+xml") return "svg";
  if (contentType === "image/jpeg") return "jpg";
  return "png";
}
