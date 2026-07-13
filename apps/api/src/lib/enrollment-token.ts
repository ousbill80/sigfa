/**
 * Jeton d'enrôlement borne — ADM-002a (CONTRACT-013 / admin.yaml).
 *
 * Provisionner une borne émet un `enrollmentToken` :
 *  - **opaque** : chaîne aléatoire haute entropie préfixée `enr_` (aucune
 *    information métier ; ni le kioskId ni le tenant ne sont dérivables du token) ;
 *  - **usage unique** : consommé (invalidé) à l'échange contre les credentials
 *    borne — un rejeu échoue systématiquement ;
 *  - **TTL borné** : durée de vie choisie dans `[5, 120]` minutes (défaut 60) —
 *    une valeur hors bornes est REFUSÉE (jamais de token immortel) ;
 *  - **jamais loggé** : seul le SHA-256 du token sert de clé de stockage ; le token
 *    clair n'existe qu'en réponse HTTP (jamais journalisé, jamais persisté).
 *
 * Le stockage effectif (single-use + TTL) est délégué à `EnrollmentTokenStore`
 * (implémentation Redis en prod : `GETDEL` atomique = consommation single-use,
 * `EX` = expiration native). Ce module reste PUR : génération + hachage + bornes,
 * entièrement testable hors-ligne.
 *
 * Toute résolution invalide (inconnu / expiré / déjà consommé / mauvais tenant)
 * lève une `EnrollmentInvalidError` OPAQUE — code unique `KIOSK_ENROLLMENT_INVALID`,
 * 401, aucun oracle distinguant les causes (anti-énumération).
 *
 * @module
 */

import { createHash, randomBytes } from "node:crypto";

/** Préfixe des jetons d'enrôlement (marqueur de format, non secret). */
export const ENROLLMENT_TOKEN_PREFIX = "enr_";

/** TTL minimal d'un jeton d'enrôlement, en minutes (borne basse LA LOI). */
export const ENROLLMENT_TTL_MIN_MINUTES = 5;

/** TTL maximal d'un jeton d'enrôlement, en minutes (borne haute LA LOI). */
export const ENROLLMENT_TTL_MAX_MINUTES = 120;

/** TTL par défaut d'un jeton d'enrôlement, en minutes (CONTRACT-013). */
export const ENROLLMENT_TTL_DEFAULT_MINUTES = 60;

/** Nombre d'octets aléatoires du jeton (256 bits d'entropie). */
const TOKEN_ENTROPY_BYTES = 32;

/**
 * Erreur OPAQUE d'enrôlement borne — message unique, aucune divulgation de cause
 * (inconnu / expiré / consommé / autre tenant sont indistinguables). Mappe vers un
 * refus 401 `KIOSK_ENROLLMENT_INVALID` côté route (anti-oracle).
 */
export class EnrollmentInvalidError extends Error {
  /** Code stable pour le mapping HTTP. */
  readonly code = "KIOSK_ENROLLMENT_INVALID" as const;
  /** Statut HTTP opaque (401). */
  readonly httpStatus = 401 as const;

  constructor() {
    super("Enrôlement invalide.");
    this.name = "EnrollmentInvalidError";
  }
}

/** Contexte lié à un jeton d'enrôlement (jamais dérivable du token lui-même). */
export interface EnrollmentBinding {
  /** Borne provisionnée à laquelle le jeton donne accès. */
  readonly kioskId: string;
  /** Banque propriétaire (garde tenant à l'échange). */
  readonly bankId: string;
  /** Agence propriétaire. */
  readonly agencyId: string;
}

/** Jeton d'enrôlement généré + sa clé de stockage + son expiration. */
export interface GeneratedEnrollmentToken {
  /** Jeton clair `enr_…` — renvoyé UNE SEULE FOIS, jamais persisté ni loggé. */
  readonly token: string;
  /** Clé de stockage = SHA-256 du token (le clair n'est jamais stocké). */
  readonly storageKey: string;
  /** TTL en secondes (dérivé des minutes bornées). */
  readonly ttlSeconds: number;
  /** Date d'expiration absolue (émission + TTL). */
  readonly expiresAt: Date;
}

/**
 * Valide qu'un TTL (en minutes) est dans `[5, 120]`, sinon lève `RangeError`.
 * Jamais de token sans expiration ni au-delà de la borne haute.
 *
 * @param minutes - TTL demandé en minutes
 * @returns Le TTL validé (identique à l'entrée)
 * @throws {RangeError} Si hors `[5, 120]` ou non entier
 */
export function assertTtlBounds(minutes: number): number {
  if (
    !Number.isInteger(minutes) ||
    minutes < ENROLLMENT_TTL_MIN_MINUTES ||
    minutes > ENROLLMENT_TTL_MAX_MINUTES
  ) {
    throw new RangeError(
      `TTL d'enrôlement hors bornes : ${minutes} min (attendu entier dans ` +
        `[${ENROLLMENT_TTL_MIN_MINUTES}, ${ENROLLMENT_TTL_MAX_MINUTES}]).`
    );
  }
  return minutes;
}

/** Hache un jeton clair en clé de stockage SHA-256 (le clair n'est jamais stocké). */
export function hashEnrollmentToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Génère un jeton d'enrôlement opaque (256 bits) avec un TTL borné `[5, 120]` min.
 *
 * @param ttlMinutes - TTL demandé en minutes (défaut 60)
 * @param now        - Horloge injectable (défaut `new Date()`)
 * @returns Jeton clair + clé de stockage (SHA-256) + TTL secondes + expiration
 * @throws {RangeError} Si `ttlMinutes` hors `[5, 120]`
 */
export function generateEnrollmentToken(
  ttlMinutes: number = ENROLLMENT_TTL_DEFAULT_MINUTES,
  now: Date = new Date()
): GeneratedEnrollmentToken {
  const minutes = assertTtlBounds(ttlMinutes);
  const token = `${ENROLLMENT_TOKEN_PREFIX}${randomBytes(TOKEN_ENTROPY_BYTES).toString(
    "base64url"
  )}`;
  const ttlSeconds = minutes * 60;
  return {
    token,
    storageKey: hashEnrollmentToken(token),
    ttlSeconds,
    expiresAt: new Date(now.getTime() + ttlSeconds * 1000),
  };
}

/**
 * Magasin de jetons d'enrôlement single-use à TTL (implémenté sur Redis en prod).
 * `consume` DOIT être atomique (lecture + suppression) : deux échanges concurrents
 * du même token ne peuvent PAS réussir tous les deux (garantie usage-unique).
 */
export interface EnrollmentTokenStore {
  /**
   * Enregistre le binding sous la clé de stockage avec expiration native.
   *
   * @param storageKey - SHA-256 du token (jamais le clair)
   * @param binding    - Contexte borne/tenant lié au token
   * @param ttlSeconds - Durée de vie en secondes
   */
  put(
    storageKey: string,
    binding: EnrollmentBinding,
    ttlSeconds: number
  ): Promise<void>;
  /**
   * Consomme (lit ET supprime atomiquement) le binding d'un token.
   *
   * @param storageKey - SHA-256 du token présenté
   * @returns Le binding si présent/non expiré, sinon null
   */
  consume(storageKey: string): Promise<EnrollmentBinding | null>;
}

/**
 * Résout et CONSOMME un jeton d'enrôlement présenté (échange contre credentials).
 * Usage unique : après cet appel, le token est invalidé (rejeu → opaque).
 *
 * @param store         - Magasin single-use (Redis en prod)
 * @param presentedToken - Jeton clair présenté par la borne
 * @param expectedTenant - Tenant attendu (garde anti-cross-tenant), optionnel
 * @returns Binding résolu (kiosk/bank/agency)
 * @throws {EnrollmentInvalidError} Si inconnu/expiré/consommé/mauvais tenant (opaque)
 */
export async function consumeEnrollmentToken(
  store: EnrollmentTokenStore,
  presentedToken: string,
  expectedTenant?: { bankId: string }
): Promise<EnrollmentBinding> {
  if (
    typeof presentedToken !== "string" ||
    !presentedToken.startsWith(ENROLLMENT_TOKEN_PREFIX)
  ) {
    throw new EnrollmentInvalidError();
  }
  const binding = await store.consume(hashEnrollmentToken(presentedToken));
  if (!binding) {
    throw new EnrollmentInvalidError();
  }
  if (expectedTenant && binding.bankId !== expectedTenant.bankId) {
    // Mauvais tenant : refus OPAQUE, indistinct d'un token inconnu.
    throw new EnrollmentInvalidError();
  }
  return binding;
}
