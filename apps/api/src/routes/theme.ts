/**
 * Routes theming banque — API-009 / ADM-001a (admin.yaml, CONTRACT-013).
 *
 * - GET   /banks/:id/theme                 — thème (requestedColors + appliedColors + welcomeMessages).
 * - PATCH /banks/:id/theme                 — met à jour requestedColors/welcomeMessages ;
 *   `appliedColors` recalculées avec correction de contraste WCAG ≥4.5:1 côté serveur.
 * - POST  /banks/:id/theme/logo            — upload logo (multipart) → stockage objet MOCK ; 422 INVALID_LOGO.
 * - GET   /banks/:id/theme/logo-upload-url — URL présignée R2 (503 si R2 non configuré).
 * - GET   /public/banks/:id/theme          — projection publique (appliedColors/logo/messages), zéro PII.
 *
 * ## Sécurité (SEC-002)
 * TOUT accès DB tenant est routé via `withArmedTenant` (contexte RLS
 * `app.current_bank_id`) → cette route est classée **ARMED** dans
 * `tenant-armament-arch.test.ts`. La projection publique (`/public/banks/:id/theme`)
 * s'arme sur le `bankId` du chemin (route `NONE`, sans contexte tenant JWT).
 *
 * Le thème est persisté dans la colonne `banks.theme` (JSONB). Les couleurs
 * appliquées ne sont JAMAIS fournies par le client : elles dérivent toujours des
 * `requestedColors` via `correctContrast` (module WCAG dédié testé).
 *
 * ## Theming = habillage, JAMAIS structure (Loi 5)
 * Le corps PATCH est STRICT : tout champ hors {requestedColors, welcomeMessages}
 * → 422 `UNKNOWN_FIELD` (garde anti-structure). Une couleur hors format hexadécimal
 * → 422 `INVALID_BRAND`.
 *
 * @module
 */

import { Hono, type Context } from "hono";
import { z } from "zod";
import type { Client } from "pg";
import type { Redis } from "ioredis";
import { SigfaError } from "src/lib/errors.js";
import type { TenantContext } from "src/middleware/tenant.js";
import {
  paramUuid,
  errorResponse,
  parseJson,
  requireBankId,
} from "src/lib/admin-helpers.js";
import { recordAudit, buildDiff, extractIp } from "src/lib/audit-context.js";
import { correctContrast } from "src/lib/wcag-contrast.js";
import { withArmedTenant, asArmable } from "src/lib/armed-tenant.js";
import {
  getR2Config,
  presignLogoPut,
  PRESIGN_EXPIRES_IN,
} from "src/lib/r2-presign.js";
import {
  validateLogo,
  InvalidLogoError,
  logoObjectKey,
  defaultLogoStore,
  type LogoObjectStore,
} from "src/lib/logo-storage.js";

/** Variables de contexte Hono du routeur theming. */
interface ThemeEnv {
  Variables: {
    db: Client;
    redis: Redis;
    jwtSecret: Uint8Array;
    tenant: TenantContext;
  };
}

/** Types MIME acceptés pour l'URL présignée (LA LOI). */
const ACCEPTED_LOGO_TYPES = ["image/png", "image/svg+xml", "image/jpeg"] as const;

/** Regex hex `#RRGGBB` (validée séparément pour émettre INVALID_BRAND ciblé). */
const HEX_RE = /^#[0-9A-Fa-f]{6}$/;

/** Ensemble de couleurs (LA LOI ColorSet, additionalProperties: false). */
const colorSetSchema = z
  .object({
    primary: z.string().regex(HEX_RE),
    secondary: z.string().regex(HEX_RE),
    background: z.string().regex(HEX_RE),
  })
  .strict();

/**
 * Messages de bienvenue (LA LOI WelcomeMessages).
 * Décision PO 2026-07 : dioula et baoule retirés (contrat admin v2.0.0).
 */
const welcomeMessagesSchema = z
  .object({
    fr: z.string().max(200),
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

/** Clés autorisées dans le corps PATCH (garde anti-structure). */
const ALLOWED_PATCH_KEYS = new Set(["requestedColors", "welcomeMessages"]);

/** Clés autorisées dans un ColorSet (garde anti-structure sur les couleurs). */
const ALLOWED_COLOR_KEYS = new Set(["primary", "secondary", "background"]);

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
 * @param store - Magasin d'objets logo (défaut : MOCK en mémoire, F8)
 * @returns Routeur Hono des routes theming ADM-001a
 */
export function createThemeRouter(
  store: LogoObjectStore = defaultLogoStore
): Hono<ThemeEnv> {
  const router = new Hono<ThemeEnv>();
  registerGetTheme(router);
  registerPatchTheme(router);
  registerLogoUpload(router, store);
  registerLogoUploadUrl(router);
  registerPublicTheme(router);
  return router;
}

/** Charge le thème stocké d'une banque (armé sur bankId), ou 404. */
async function loadTheme(db: Client, bankId: string): Promise<StoredTheme> {
  return withArmedTenant(asArmable(db), bankId, async (conn) => {
    const res = await conn.query(
      `SELECT theme FROM banks WHERE id = $1 AND deleted_at IS NULL`,
      [bankId]
    );
    const row = res.rows[0] as { theme: StoredTheme } | undefined;
    if (!row) throw new SigfaError("NOT_FOUND", "Banque introuvable.", 404);
    return row.theme ?? {};
  });
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

/** Compose la projection PUBLIQUE (zéro PII, jamais de requestedColors internes). */
function composePublicTheme(stored: StoredTheme): Record<string, unknown> {
  const requestedColors = stored.requestedColors ?? { ...DEFAULT_COLORS };
  return {
    logoUrl: stored.logoUrl ?? null,
    appliedColors: applyContrast(requestedColors),
    welcomeMessages: stored.welcomeMessages ?? { fr: "Bienvenue" },
  };
}

/**
 * Valide STRICTEMENT le corps PATCH avec des codes ciblés (garde anti-structure) :
 *  - champ hors {requestedColors, welcomeMessages} → 422 UNKNOWN_FIELD ;
 *  - couleur hors format hexadécimal → 422 INVALID_BRAND ;
 *  - reste des violations de schéma → 422 UNPROCESSABLE_ENTITY.
 *
 * @param body - Corps JSON parsé (peut être null)
 * @returns Corps validé
 */
function parseThemeUpdate(body: unknown): z.infer<typeof updateThemeSchema> {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new SigfaError("UNPROCESSABLE_ENTITY", "Corps JSON attendu.", 422);
  }
  assertNoUnknownField(body as Record<string, unknown>);
  assertBrandFormat(body as Record<string, unknown>);
  const parsed = updateThemeSchema.safeParse(body);
  if (!parsed.success) {
    throw new SigfaError(
      "UNPROCESSABLE_ENTITY",
      "Requête invalide ou champ hors schéma.",
      422,
      { issues: parsed.error.issues }
    );
  }
  return parsed.data;
}

/** Rejette tout token de structure (clé racine ou clé couleur non autorisée). */
function assertNoUnknownField(body: Record<string, unknown>): void {
  for (const key of Object.keys(body)) {
    if (!ALLOWED_PATCH_KEYS.has(key)) {
      throw new SigfaError(
        "UNKNOWN_FIELD",
        `Champ inconnu : '${key}'. Le theming n'autorise aucun token de structure.`,
        422
      );
    }
  }
  const colors = body["requestedColors"];
  if (colors !== undefined && colors !== null && typeof colors === "object") {
    for (const key of Object.keys(colors as Record<string, unknown>)) {
      if (!ALLOWED_COLOR_KEYS.has(key)) {
        throw new SigfaError(
          "UNKNOWN_FIELD",
          `Champ de couleur inconnu : '${key}'.`,
          422
        );
      }
    }
  }
}

/** Rejette toute couleur `requestedColors` hors format `#RRGGBB` → INVALID_BRAND. */
function assertBrandFormat(body: Record<string, unknown>): void {
  const colors = body["requestedColors"];
  if (colors === undefined || colors === null || typeof colors !== "object") return;
  for (const key of ALLOWED_COLOR_KEYS) {
    const value = (colors as Record<string, unknown>)[key];
    if (typeof value === "string" && !HEX_RE.test(value)) {
      throw new SigfaError(
        "INVALID_BRAND",
        "Couleur --brand invalide : format hexadécimal #RRGGBB attendu.",
        422
      );
    }
  }
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

/** Enregistre PATCH /banks/:id/theme (recalcul appliedColors, armé) + audit. */
function registerPatchTheme(router: Hono<ThemeEnv>): void {
  router.patch("/banks/:id/theme", async (c) => {
    const db = c.get("db");
    const tenant = c.get("tenant");
    try {
      const id = paramUuid(c, "id");
      requireBankId(tenant);
      const input = parseThemeUpdate(await parseJson(c));
      const merged = await withArmedTenant(asArmable(db), id, async (conn) => {
        const armedDb = conn as unknown as Client;
        const before = await loadThemeInConn(armedDb, id);
        const next: StoredTheme = {
          ...before,
          ...(input.requestedColors ? { requestedColors: input.requestedColors } : {}),
          ...(input.welcomeMessages ? { welcomeMessages: input.welcomeMessages } : {}),
        };
        await armedDb.query(
          `UPDATE banks SET theme = $2::jsonb, updated_at = now()
            WHERE id = $1 AND deleted_at IS NULL`,
          [id, JSON.stringify(next)]
        );
        await recordAudit({
          db: armedDb,
          tenant,
          action: "PATCH /banks/:id/theme",
          entityType: "theme",
          entityId: id,
          ip: extractIp(c),
          diff: buildDiff(
            { requestedColors: before.requestedColors ?? null },
            { requestedColors: next.requestedColors ?? null }
          ),
        });
        return next;
      });
      await invalidatePublicCache(c.get("redis"), id);
      return c.json(composeTheme(merged), 200);
    } catch (err) {
      return errorResponse(c, err);
    }
  });
}

/** Charge le thème via une connexion DÉJÀ armée (pas de transaction imbriquée). */
async function loadThemeInConn(db: Client, bankId: string): Promise<StoredTheme> {
  const res = await db.query(
    `SELECT theme FROM banks WHERE id = $1 AND deleted_at IS NULL`,
    [bankId]
  );
  const row = res.rows[0] as { theme: StoredTheme } | undefined;
  if (!row) throw new SigfaError("NOT_FOUND", "Banque introuvable.", 404);
  return row.theme ?? {};
}

/** Invalide le cache de projection publique pour CE bankId uniquement (best-effort). */
async function invalidatePublicCache(redis: Redis, bankId: string): Promise<void> {
  try {
    await redis.del(`theme:public:${bankId}`);
  } catch {
    // Cache best-effort : une indisponibilité Redis ne casse pas la mutation.
  }
}

/** Enregistre POST /banks/:id/theme/logo (multipart → validation → stockage MOCK). */
function registerLogoUpload(router: Hono<ThemeEnv>, store: LogoObjectStore): void {
  router.post("/banks/:id/theme/logo", async (c) => {
    const db = c.get("db");
    const tenant = c.get("tenant");
    try {
      const id = paramUuid(c, "id");
      requireBankId(tenant);
      const bytes = await readLogoFile(c);
      let validated;
      try {
        validated = validateLogo(bytes);
      } catch (err) {
        if (err instanceof InvalidLogoError) {
          throw new SigfaError("INVALID_LOGO", err.message, 422);
        }
        throw err;
      }
      const key = logoObjectKey(id, validated.extension);
      const logoUrl = await store.put(key, validated.bytes, validated.mime);
      await withArmedTenant(asArmable(db), id, async (conn) => {
        const armedDb = conn as unknown as Client;
        const before = await loadThemeInConn(armedDb, id);
        const next: StoredTheme = { ...before, logoUrl };
        await armedDb.query(
          `UPDATE banks SET theme = $2::jsonb, updated_at = now()
            WHERE id = $1 AND deleted_at IS NULL`,
          [id, JSON.stringify(next)]
        );
        await recordAudit({
          db: armedDb,
          tenant,
          action: "POST /banks/:id/theme/logo",
          entityType: "theme",
          entityId: id,
          ip: extractIp(c),
          diff: buildDiff(
            { logoUrl: before.logoUrl ?? null },
            { logoUrl: next.logoUrl }
          ),
        });
      });
      await invalidatePublicCache(c.get("redis"), id);
      return c.json({ logoUrl }, 200);
    } catch (err) {
      return errorResponse(c, err);
    }
  });
}

/** Lit le fichier `file` du corps multipart en octets, ou 422 INVALID_LOGO. */
async function readLogoFile(c: Context<ThemeEnv>): Promise<Uint8Array> {
  let body: Record<string, unknown>;
  try {
    body = await c.req.parseBody();
  } catch {
    throw new SigfaError("INVALID_LOGO", "Corps multipart illisible.", 422);
  }
  const file = body["file"];
  if (!(file instanceof File)) {
    throw new SigfaError("INVALID_LOGO", "Champ 'file' manquant ou invalide.", 422);
  }
  return new Uint8Array(await file.arrayBuffer());
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
        objectKey: logoObjectKey(id, extensionFor(contentType)),
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

/** Enregistre GET /public/banks/:id/theme (projection publique, zéro PII). */
function registerPublicTheme(router: Hono<ThemeEnv>): void {
  router.get("/public/banks/:id/theme", async (c) => {
    const db = c.get("db");
    try {
      const id = paramUuid(c, "id");
      const stored = await loadTheme(db, id);
      return c.json(composePublicTheme(stored), 200);
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
