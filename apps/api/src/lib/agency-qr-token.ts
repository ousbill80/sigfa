/**
 * Jeton QR agence signé — NOTIF-005-A (CONTRACT-013 / public.yaml).
 *
 * Le QR affiché en agence encode un identifiant d'agence **signé** (non-PII) que
 * la PWA renvoie pour émettre un ticket via le canal `QR`. Le format est aligné
 * sur le durcissement des tokens TV/borne :
 *
 * - **Algorithme** : HMAC-SHA256 sur le payload `{ agencyId, exp, keyVersion }`.
 * - **TTL** : 30 jours (`AGENCY_QR_TTL_SECONDS`) — le QR imprimé reste valide 30 j
 *   puis doit être réémis.
 * - **Clé rotative versionnée** : chaque token porte sa `keyVersion` dans le préfixe
 *   (`v{n}.…`) ; le serveur signe avec `keyring.current` mais **vérifie multi-version**
 *   (toute clé encore présente au trousseau). Retirer une clé du trousseau invalide
 *   progressivement les anciens QR sans casser ceux encore dans leur fenêtre.
 *
 * Format sérialisé : `v{keyVersion}.{payloadBase64url}.{sigBase64url}`.
 *
 * Toute erreur de vérification lève une `AgencyQrTokenError` **opaque** (message
 * unique, aucune divulgation de la cause : expiré / altéré / mauvaise version /
 * mauvaise agence sont indistinguables) — anti-oracle.
 *
 * Le calcul est PUR et local (aucun I/O), donc entièrement testable hors-ligne.
 *
 * @module
 */

import { createHmac, timingSafeEqual } from "node:crypto";

/** TTL du jeton QR agence, en secondes — 30 jours (LA LOI CONTRACT-013). */
export const AGENCY_QR_TTL_SECONDS = 30 * 24 * 60 * 60;

/**
 * Trousseau de clés HMAC versionnées.
 * - `current` : version utilisée pour signer les NOUVEAUX tokens.
 * - `keys`    : toutes les versions acceptées EN VÉRIFICATION (rotation).
 */
export interface AgencyQrKeyring {
  /** Version de clé courante (utilisée pour signer). */
  current: number;
  /** Secrets indexés par version (une entrée par version encore acceptée). */
  keys: Record<number, string>;
}

/** Résultat d'une signature de jeton QR agence. */
export interface SignedAgencyToken {
  /** Jeton sérialisé `v{n}.{payload}.{sig}`. */
  token: string;
  /** Version de clé utilisée pour signer. */
  keyVersion: number;
  /** Date d'expiration (émission + 30 j). */
  expiresAt: Date;
}

/** Payload clair signé (non-PII : jamais autre chose que ces 3 champs). */
interface AgencyTokenPayload {
  /** Agence pointée par le QR (UUID). */
  agencyId: string;
  /** Expiration epoch (secondes). */
  exp: number;
  /** Version de clé (redondante avec le préfixe, liée par la signature). */
  keyVersion: number;
}

/** Paramètres de signature. */
export interface SignAgencyTokenParams {
  /** Agence à signer (UUID). */
  agencyId: string;
  /** Trousseau de clés versionnées. */
  keyring: AgencyQrKeyring;
  /** Horloge injectable (défaut `new Date()`) pour des tests déterministes. */
  now?: Date;
}

/** Paramètres de vérification. */
export interface VerifyAgencyTokenParams {
  /** Jeton sérialisé candidat. */
  token: string;
  /** Trousseau de clés versionnées. */
  keyring: AgencyQrKeyring;
  /** Horloge injectable (défaut `new Date()`). */
  now?: Date;
}

/** Résultat d'une vérification réussie. */
export interface VerifiedAgencyToken {
  /** Agence résolue depuis le payload signé. */
  agencyId: string;
  /** Version de clé qui a validé la signature. */
  keyVersion: number;
}

/**
 * Erreur OPAQUE de jeton QR agence — message unique, aucune divulgation de cause.
 * Le code `INVALID_QR_TOKEN` mappe vers un refus 403 opaque côté route.
 */
export class AgencyQrTokenError extends Error {
  /** Code stable pour le mapping HTTP. */
  readonly code = "INVALID_QR_TOKEN" as const;

  constructor() {
    super("Jeton QR agence invalide.");
    this.name = "AgencyQrTokenError";
  }
}

/** Encode une valeur JSON en base64url. */
function encodePayload(payload: AgencyTokenPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

/** Calcule la signature HMAC-SHA256 (base64url) d'un segment de payload. */
function sign(secret: string, keyVersion: number, payloadB64: string): string {
  return createHmac("sha256", secret)
    .update(`v${keyVersion}.${payloadB64}`)
    .digest("base64url");
}

/**
 * Signe un jeton QR agence avec la clé COURANTE du trousseau, TTL 30 j.
 *
 * @param params - Agence, trousseau, horloge injectable
 * @returns Jeton sérialisé + version + expiration
 * @throws {Error} Si aucune clé n'existe pour la version courante (config invalide)
 */
export function signAgencyToken(params: SignAgencyTokenParams): SignedAgencyToken {
  const { agencyId, keyring } = params;
  const now = params.now ?? new Date();
  const keyVersion = keyring.current;
  const secret = keyring.keys[keyVersion];
  if (!secret) {
    throw new Error(
      `[SIGFA] Aucune clé de signature QR pour la version courante ${keyVersion}.`
    );
  }
  const expSeconds = Math.floor(now.getTime() / 1000) + AGENCY_QR_TTL_SECONDS;
  const payload: AgencyTokenPayload = { agencyId, exp: expSeconds, keyVersion };
  const payloadB64 = encodePayload(payload);
  const sig = sign(secret, keyVersion, payloadB64);
  return {
    token: `v${keyVersion}.${payloadB64}.${sig}`,
    keyVersion,
    expiresAt: new Date(expSeconds * 1000),
  };
}

/** Compare deux signatures en temps constant (jamais d'oracle de timing). */
function signaturesMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Parse le préfixe `v{n}` en numéro de version, ou lève opaque. */
function parseVersion(prefix: string): number {
  if (!prefix.startsWith("v")) throw new AgencyQrTokenError();
  const version = Number(prefix.slice(1));
  if (!Number.isInteger(version) || version <= 0) throw new AgencyQrTokenError();
  return version;
}

/** Décode et valide la forme du payload, ou lève opaque. */
function decodePayload(payloadB64: string): AgencyTokenPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
  } catch {
    throw new AgencyQrTokenError();
  }
  if (typeof parsed !== "object" || parsed === null) throw new AgencyQrTokenError();
  const obj = parsed as Record<string, unknown>;
  if (
    typeof obj["agencyId"] !== "string" ||
    typeof obj["exp"] !== "number" ||
    typeof obj["keyVersion"] !== "number"
  ) {
    throw new AgencyQrTokenError();
  }
  return { agencyId: obj["agencyId"], exp: obj["exp"], keyVersion: obj["keyVersion"] };
}

/**
 * Vérifie un jeton QR agence : format, signature HMAC (clé de la version portée,
 * doit exister au trousseau), cohérence de version, expiration (TTL 30 j).
 * Toute anomalie → `AgencyQrTokenError` OPAQUE (aucun oracle de cause).
 *
 * @param params - Jeton, trousseau, horloge injectable
 * @returns Agence résolue + version validante
 * @throws {AgencyQrTokenError} Si invalide/expiré/altéré/version inconnue (opaque)
 */
export function verifyAgencyToken(params: VerifyAgencyTokenParams): VerifiedAgencyToken {
  const { token, keyring } = params;
  const now = params.now ?? new Date();
  const parts = token.split(".");
  if (parts.length !== 3) throw new AgencyQrTokenError();
  const [prefix, payloadB64, sig] = parts as [string, string, string];
  const keyVersion = parseVersion(prefix);
  const secret = keyring.keys[keyVersion];
  if (!secret) throw new AgencyQrTokenError();
  const expected = sign(secret, keyVersion, payloadB64);
  if (!signaturesMatch(sig, expected)) throw new AgencyQrTokenError();
  const payload = decodePayload(payloadB64);
  if (payload.keyVersion !== keyVersion) throw new AgencyQrTokenError();
  if (Math.floor(now.getTime() / 1000) >= payload.exp) throw new AgencyQrTokenError();
  return { agencyId: payload.agencyId, keyVersion };
}
