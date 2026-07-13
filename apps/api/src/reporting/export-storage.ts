/**
 * REP-003 — Stockage objet des exports + URL signée à TTL 24 h (D3).
 *
 * ## Nature
 * SIGFA n'utilise PAS de S3 réel en périmètre F7 : seule la FORME du stockage et
 * de l'URL signée est produite et testée. Ce module fournit :
 *  - une **interface** `ObjectStorage` (contrat de stockage : `put` + `signUrl`),
 *  - un **adaptateur MOCK** local (`MockObjectStorage`) en mémoire (aucun réseau),
 *  - la **signature/vérification** d'une URL de téléchargement à TTL borné, avec
 *    **horloge injectée** (déterministe, testable en fake-timers).
 *
 * ## URL signée (TTL 24 h — D3)
 * L'URL porte `?key=<objectKey>&exp=<epoch_ms>&sig=<hmac>`. La signature HMAC-SHA256
 * couvre `key|exp` avec une clé secrète serveur. La vérification (`verifySignedUrl`)
 * refuse toute URL expirée (`now > exp`) ou dont la signature ne correspond pas —
 * jamais d'oracle : signature invalide et expiration renvoient un refus typé.
 *
 * @module
 */

import { createHmac, timingSafeEqual } from "node:crypto";

/** TTL par défaut d'une URL signée d'export : 24 heures (D3, en millisecondes). */
export const EXPORT_URL_TTL_MS = 24 * 60 * 60 * 1000;

/** Type MIME par format d'export (contractuel CONTRACT-006). */
export const EXPORT_CONTENT_TYPE = {
  pdf: "application/pdf",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  json: "application/json",
} as const;

/** Format d'export supporté (aligné `ExportFormat` CONTRACT-006). */
export type ExportFormat = keyof typeof EXPORT_CONTENT_TYPE;

/** Objet stocké : contenu binaire + type MIME. */
export interface StoredObject {
  /** Contenu binaire du fichier. */
  body: Buffer;
  /** Type MIME (Content-Type). */
  contentType: string;
}

/**
 * Contrat de stockage objet des exports. Une implémentation réelle (S3/R2) et
 * l'adaptateur MOCK partagent cette interface — le reste du code ne dépend jamais
 * d'un fournisseur concret.
 */
export interface ObjectStorage {
  /**
   * Écrit un objet sous une clé donnée (écrase si la clé existe déjà).
   *
   * @param key    - Clé objet (ex. `exports/<bankId>/<jobId>.pdf`)
   * @param object - Contenu + type MIME
   */
  put(key: string, object: StoredObject): Promise<void>;
  /**
   * Produit une URL signée de téléchargement à TTL borné.
   *
   * @param key - Clé objet à télécharger
   * @param now - Horloge injectée (base de calcul de l'expiration)
   * @returns URL signée absolue (schéma mock) valide `EXPORT_URL_TTL_MS`
   */
  signUrl(key: string, now: Date): { url: string; expiresAt: Date };
}

/** Options de construction d'un `MockObjectStorage`. */
export interface MockStorageOptions {
  /** Clé secrète de signature (HMAC). */
  secret: string;
  /** Base d'URL du mock (ex. `https://mock.sigfa.local`). */
  baseUrl?: string;
  /** TTL de l'URL signée (ms) — défaut `EXPORT_URL_TTL_MS`. */
  ttlMs?: number;
}

/** Résultat de vérification d'une URL signée. */
export type VerifyResult =
  | { valid: true; key: string }
  | { valid: false; reason: "MALFORMED" | "BAD_SIGNATURE" | "EXPIRED" };

/**
 * Signe `key|exp` en HMAC-SHA256 (hex). Base de l'URL signée ET de sa vérification.
 *
 * @param secret - Clé secrète serveur
 * @param key    - Clé objet
 * @param expMs  - Instant d'expiration (epoch ms)
 * @returns Signature hexadécimale
 */
export function signPayload(secret: string, key: string, expMs: number): string {
  return createHmac("sha256", secret).update(`${key}|${expMs}`).digest("hex");
}

/**
 * Adaptateur de stockage MOCK en mémoire (aucun réseau, aucun S3). Conserve les
 * objets dans une `Map` et produit des URLs signées vérifiables via `verifySignedUrl`.
 *
 * Périmètre F7 : prouve la FORME (TTL, signature, expiration) sans infra objet réelle.
 */
export class MockObjectStorage implements ObjectStorage {
  private readonly store = new Map<string, StoredObject>();
  private readonly secret: string;
  private readonly baseUrl: string;
  private readonly ttlMs: number;

  constructor(options: MockStorageOptions) {
    this.secret = options.secret;
    this.baseUrl = options.baseUrl ?? "https://mock-storage.sigfa.local";
    this.ttlMs = options.ttlMs ?? EXPORT_URL_TTL_MS;
  }

  put(key: string, object: StoredObject): Promise<void> {
    this.store.set(key, object);
    return Promise.resolve();
  }

  /** Lit un objet stocké (mock — utilisé par les tests/vérifications). */
  get(key: string): StoredObject | undefined {
    return this.store.get(key);
  }

  signUrl(key: string, now: Date): { url: string; expiresAt: Date } {
    const expMs = now.getTime() + this.ttlMs;
    const sig = signPayload(this.secret, key, expMs);
    const params = new URLSearchParams({ key, exp: String(expMs), sig });
    return {
      url: `${this.baseUrl}/download?${params.toString()}`,
      expiresAt: new Date(expMs),
    };
  }

  /**
   * Vérifie une URL signée produite par ce mock : format, signature et expiration.
   * `now > exp` → refus `EXPIRED` ; signature ne correspondant pas → `BAD_SIGNATURE`.
   * Aucun oracle : refus typés, pas de fuite d'existence de la clé.
   *
   * @param url - URL signée à vérifier
   * @param now - Horloge injectée
   * @returns Résultat de vérification
   */
  verifySignedUrl(url: string, now: Date): VerifyResult {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { valid: false, reason: "MALFORMED" };
    }
    const key = parsed.searchParams.get("key");
    const exp = parsed.searchParams.get("exp");
    const sig = parsed.searchParams.get("sig");
    if (!key || !exp || !sig) return { valid: false, reason: "MALFORMED" };
    const expMs = Number(exp);
    if (!Number.isFinite(expMs)) return { valid: false, reason: "MALFORMED" };
    const expected = signPayload(this.secret, key, expMs);
    if (!constantTimeEquals(sig, expected)) {
      return { valid: false, reason: "BAD_SIGNATURE" };
    }
    if (now.getTime() > expMs) return { valid: false, reason: "EXPIRED" };
    return { valid: true, key };
  }
}

/** Comparaison à temps constant de deux chaînes hex (anti timing-oracle). */
function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
