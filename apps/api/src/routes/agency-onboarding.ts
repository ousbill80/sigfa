/**
 * Routes onboarding agence < 2h — ADM-002a (admin.yaml, CONTRACT-013).
 *
 * - POST /banks/:id/agencies:clone      (BANK_ADMIN+) — clone STRUCTUREL d'une agence
 *   (template XOR source) → nouvelle agence + démarrage du parcours d'onboarding.
 * - POST /agencies/:id/kiosks:provision (AGENCY_DIRECTOR+) — provisionne une borne
 *   + émet un jeton d'enrôlement usage-unique, TTL borné [5,120] min, opaque, jamais loggé.
 * - GET  /agencies/:id/onboarding/:onboardingId — état du parcours (5 étapes horodatées).
 *
 * ## Sécurité (SEC-002)
 * TOUT accès DB tenant passe par `withArmedTenant` (dans les services de clonage/
 * provisioning) → routeur classé **ARMED** dans `tenant-armament-arch.test.ts`.
 * Le clonage est STRUCTUREL (zéro ticket/PII). Le jeton d'enrôlement n'est JAMAIS
 * loggé : seul son SHA-256 est stocké (Redis, single-use via GETDEL). Toute
 * résolution invalide → 401 opaque `KIOSK_ENROLLMENT_INVALID` (anti-énumération).
 *
 * Les mutations (`:clone`, `:provision`) figurent au `MUTATION_REGISTRY` (audit).
 * Le parcours d'onboarding est persisté (Redis, clé scopée tenant) → reprise via GET.
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
  assertAgencyScope,
} from "src/lib/admin-helpers.js";
import { recordAudit, buildDiff, extractIp } from "src/lib/audit-context.js";
import { getEnrollBaseUrl } from "src/lib/env.js";
import {
  cloneAgencyStructure,
  provisionKiosk,
} from "src/services/agency-clone.service.js";
import {
  RedisEnrollmentTokenStore,
  RedisOnboardingStore,
} from "src/services/onboarding-stores.js";
import {
  generateEnrollmentToken,
  ENROLLMENT_TTL_DEFAULT_MINUTES,
} from "src/lib/enrollment-token.js";
import {
  createJourney,
  markStep,
  toStatusResponse,
  type OnboardingJourney,
} from "src/lib/onboarding-journey.js";

/** Variables de contexte Hono du routeur onboarding agence. */
interface AgencyOnboardingEnv {
  Variables: {
    db: Client;
    redis: Redis;
    jwtSecret: Uint8Array;
    tenant: TenantContext;
  };
}

/** Regex UUID pour valider `templateId`/`sourceAgencyId` du corps de clonage. */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Corps de POST /banks/:id/agencies:clone (LA LOI CloneAgencyRequest). */
const cloneRequestSchema = z
  .object({
    name: z.string().min(1).max(120),
    templateId: z.string().regex(UUID_RE).optional(),
    sourceAgencyId: z.string().regex(UUID_RE).optional(),
  })
  .strict();

/**
 * Crée le routeur onboarding agence ADM-002a (monté sous /api/v1).
 *
 * @returns Routeur Hono des routes ADM-002a
 */
export function createAgencyOnboardingRouter(): Hono<AgencyOnboardingEnv> {
  const router = new Hono<AgencyOnboardingEnv>();
  registerClone(router);
  registerProvisionKiosk(router);
  registerGetOnboarding(router);
  return router;
}

/**
 * Résout la source de clonage : exactement UNE de {templateId, sourceAgencyId}.
 * Aucune ou les deux → 422 `CLONE_SOURCE_REQUIRED`.
 *
 * @param input - Corps validé
 * @returns Identifiant de la source unique
 * @throws {SigfaError} 422 CLONE_SOURCE_REQUIRED si zéro ou deux sources
 */
function resolveCloneSource(input: z.infer<typeof cloneRequestSchema>): string {
  const provided = [input.templateId, input.sourceAgencyId].filter(
    (v): v is string => typeof v === "string"
  );
  if (provided.length !== 1) {
    throw new SigfaError(
      "CLONE_SOURCE_REQUIRED",
      "Exactement une source de clonage est requise : templateId OU sourceAgencyId.",
      422
    );
  }
  return provided[0] as string;
}

/** Enregistre POST /banks/:id/agencies:clone (clone structurel + onboarding). */
function registerClone(router: Hono<AgencyOnboardingEnv>): void {
  router.post("/banks/:id/agencies:clone", async (c) => {
    const db = c.get("db");
    const tenant = c.get("tenant");
    try {
      paramUuid(c, "id");
      const bankId = requireBankId(tenant);
      const input = parseStrict(cloneRequestSchema, (await parseJson(c)) ?? {});
      const sourceId = resolveCloneSource(input);
      const cloned = await cloneAgencyStructure({
        db,
        bankId,
        name: input.name,
        sourceId,
      });
      const journey = await startOnboarding(c.get("redis"), bankId, cloned.agencyId);
      await recordAudit({
        db,
        tenant,
        action: "POST /banks/:id/agencies:clone",
        entityType: "agency",
        entityId: cloned.agencyId,
        ip: extractIp(c),
        diff: buildDiff({}, { clonedFrom: sourceId, onboardingId: journey.onboardingId }),
      });
      return c.json(
        {
          agencyId: cloned.agencyId,
          onboardingId: journey.onboardingId,
          createdAt: cloned.createdAt,
        },
        201
      );
    } catch (err) {
      return errorResponse(c, err);
    }
  });
}

/**
 * Démarre le parcours d'onboarding : marque les 3 étapes structurelles déjà
 * réalisées par le clone (agence + services + guichets), laisse l'import agents en
 * attente (hors périmètre ADM-002a) et le provisioning borne à venir. Persiste.
 */
async function startOnboarding(
  redis: Redis,
  bankId: string,
  agencyId: string
): Promise<OnboardingJourney> {
  const store = new RedisOnboardingStore(redis);
  const onboardingId = crypto.randomUUID();
  const now = new Date();
  let journey = createJourney({ onboardingId, agencyId, bankId, now });
  journey = markStep(journey, "agency_created", "DONE", now);
  journey = markStep(journey, "services_cloned", "DONE", now);
  journey = markStep(journey, "counters_ready", "DONE", now);
  await store.save(journey);
  return journey;
}

/** Enregistre POST /agencies/:id/kiosks:provision (borne + jeton d'enrôlement). */
function registerProvisionKiosk(router: Hono<AgencyOnboardingEnv>): void {
  router.post("/agencies/:id/kiosks:provision", async (c) => {
    const db = c.get("db");
    const tenant = c.get("tenant");
    try {
      const agencyId = paramUuid(c, "id");
      assertAgencyScope(tenant, agencyId);
      const bankId = requireBankId(tenant);
      const { kioskId } = await provisionKiosk({ db, bankId, agencyId });
      const { token, storageKey, ttlSeconds, expiresAt } = generateEnrollmentToken(
        ENROLLMENT_TTL_DEFAULT_MINUTES
      );
      await new RedisEnrollmentTokenStore(c.get("redis")).put(
        storageKey,
        { kioskId, bankId, agencyId },
        ttlSeconds
      );
      await advanceKioskStep(c.get("redis"), bankId, agencyId);
      await recordAudit({
        db,
        tenant,
        action: "POST /agencies/:id/kiosks:provision",
        entityType: "kiosk",
        entityId: kioskId,
        ip: extractIp(c),
        // Jamais le token : on trace uniquement le kioskId (le clair reste hors journal).
        diff: buildDiff({}, { kioskId }),
      });
      return c.json(
        {
          kioskId,
          enrollmentToken: token,
          enrollmentQrUrl: `${getEnrollBaseUrl()}/enroll/${kioskId}`,
          expiresAt: expiresAt.toISOString(),
        },
        201
      );
    } catch (err) {
      return errorResponse(c, err);
    }
  });
}

/**
 * Marque l'étape `kiosk_provisioned` DONE sur le parcours d'onboarding le plus
 * récent de l'agence (best-effort : l'absence de parcours ne casse pas le provisioning).
 */
async function advanceKioskStep(
  redis: Redis,
  bankId: string,
  agencyId: string
): Promise<void> {
  try {
    const journey = await findJourneyByAgency(redis, bankId, agencyId);
    if (!journey) return;
    const store = new RedisOnboardingStore(redis);
    await store.save(markStep(journey, "kiosk_provisioned", "DONE"));
  } catch {
    // Best-effort : la progression d'onboarding ne bloque pas l'émission du jeton.
  }
}

/** Retrouve le parcours d'une agence par balayage des clés tenant (SCAN best-effort). */
async function findJourneyByAgency(
  redis: Redis,
  bankId: string,
  agencyId: string
): Promise<OnboardingJourney | null> {
  const keys = await redis.keys(`onboarding:${bankId}:*`);
  for (const key of keys) {
    const raw = await redis.get(key);
    if (!raw) continue;
    const journey = JSON.parse(raw) as OnboardingJourney;
    if (journey.agencyId === agencyId) return journey;
  }
  return null;
}

/** Enregistre GET /agencies/:id/onboarding/:onboardingId (état du parcours). */
function registerGetOnboarding(router: Hono<AgencyOnboardingEnv>): void {
  router.get("/agencies/:id/onboarding/:onboardingId", async (c) => {
    const tenant = c.get("tenant");
    try {
      const agencyId = paramUuid(c, "id");
      const onboardingId = paramUuid(c, "onboardingId");
      assertAgencyScope(tenant, agencyId);
      const bankId = requireBankId(tenant);
      const store = new RedisOnboardingStore(c.get("redis"));
      const journey = await store.load(bankId, onboardingId);
      // Parcours inconnu OU rattaché à une autre agence → 404 opaque (garde tenant).
      if (!journey || journey.agencyId !== agencyId) {
        throw new SigfaError("NOT_FOUND", "Parcours d'onboarding introuvable.", 404);
      }
      return c.json(toStatusResponse(journey), 200);
    } catch (err) {
      return errorResponse(c, err);
    }
  });
}
