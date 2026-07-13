/**
 * Implémentations Redis des magasins d'onboarding — ADM-002a.
 *
 * - `RedisEnrollmentTokenStore` : jetons d'enrôlement borne single-use à TTL.
 *   La consommation atomique s'appuie sur `GETDEL` (Redis ≥ 6.2) : lire ET
 *   supprimer en une commande garantit l'usage unique même sous concurrence.
 *   La clé Redis est le SHA-256 du token (jamais le clair, jamais loggé), et l'`EX`
 *   (expiration native) applique le TTL borné `[5, 120]` min.
 * - `RedisOnboardingStore` : état du parcours (5 étapes horodatées), clé scopée
 *   tenant `{bankId}` (garde d'isolation : un `onboardingId` d'un autre tenant ne
 *   résout jamais), avec un TTL de sécurité large (l'onboarding vise < 2h).
 *
 * @module
 */

import type { Redis } from "ioredis";
import type {
  EnrollmentBinding,
  EnrollmentTokenStore,
} from "src/lib/enrollment-token.js";
import type {
  OnboardingJourney,
  OnboardingStore,
} from "src/lib/onboarding-journey.js";

/** Préfixe des clés Redis des jetons d'enrôlement. */
const ENROLLMENT_KEY_PREFIX = "kiosk:enroll:";

/** Préfixe des clés Redis des parcours d'onboarding (scopées tenant). */
const ONBOARDING_KEY_PREFIX = "onboarding:";

/**
 * TTL de sécurité des parcours d'onboarding : 24 h. Le parcours vise < 2h ; ce TTL
 * large couvre les reprises différées sans laisser fuir l'état indéfiniment.
 */
export const ONBOARDING_STATE_TTL_SECONDS = 24 * 60 * 60;

/** Magasin Redis des jetons d'enrôlement (single-use via GETDEL). */
export class RedisEnrollmentTokenStore implements EnrollmentTokenStore {
  constructor(private readonly redis: Redis) {}

  /** {@inheritDoc EnrollmentTokenStore.put} */
  async put(
    storageKey: string,
    binding: EnrollmentBinding,
    ttlSeconds: number
  ): Promise<void> {
    await this.redis.set(
      `${ENROLLMENT_KEY_PREFIX}${storageKey}`,
      JSON.stringify(binding),
      "EX",
      ttlSeconds
    );
  }

  /** {@inheritDoc EnrollmentTokenStore.consume} */
  async consume(storageKey: string): Promise<EnrollmentBinding | null> {
    // GETDEL : lecture + suppression atomiques → usage unique garanti.
    const raw = await this.redis.getdel(`${ENROLLMENT_KEY_PREFIX}${storageKey}`);
    if (!raw) return null;
    return JSON.parse(raw) as EnrollmentBinding;
  }
}

/** Magasin Redis des parcours d'onboarding (clé scopée tenant). */
export class RedisOnboardingStore implements OnboardingStore {
  constructor(private readonly redis: Redis) {}

  /** Clé Redis d'un parcours, scopée par tenant (garde d'isolation). */
  private key(bankId: string, onboardingId: string): string {
    return `${ONBOARDING_KEY_PREFIX}${bankId}:${onboardingId}`;
  }

  /** {@inheritDoc OnboardingStore.save} */
  async save(journey: OnboardingJourney): Promise<void> {
    await this.redis.set(
      this.key(journey.bankId, journey.onboardingId),
      JSON.stringify(journey),
      "EX",
      ONBOARDING_STATE_TTL_SECONDS
    );
  }

  /** {@inheritDoc OnboardingStore.load} */
  async load(
    bankId: string,
    onboardingId: string
  ): Promise<OnboardingJourney | null> {
    const raw = await this.redis.get(this.key(bankId, onboardingId));
    if (!raw) return null;
    return JSON.parse(raw) as OnboardingJourney;
  }
}
