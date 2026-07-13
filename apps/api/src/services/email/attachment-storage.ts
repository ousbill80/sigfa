/**
 * attachment-storage — repli « pièce jointe hors limite → lien signé » (NOTIF-004).
 *
 * LA LOI (NOTIF-004 + arbitrage D3) :
 *  - Resend impose un plafond de taille de pièce jointe. QUAND une pièce (ou le
 *    total) dépasse ce plafond, le worker NE joint PAS le fichier : il le stocke
 *    (stockage objet — MOCKÉ/local ici, pas de S3 réel) et insère à la place un
 *    **lien de téléchargement signé à TTL 24 h** (D3), noté au log
 *    (`attachmentSignedUrl`, CONTRACT-013).
 *  - L'horloge est INJECTÉE (déterminisme des tests / expiration).
 *  - La signature est un HMAC-SHA256 sur `(objectKey, expiresAtEpoch)` — le lien
 *    est vérifiable et infalsifiable sans exposer le fichier.
 *
 * @module
 */

import { createHmac, timingSafeEqual } from "node:crypto";

/** TTL par défaut d'un lien signé de pièce jointe : 24 h (D3). */
export const SIGNED_LINK_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Plafond de taille d'une pièce jointe email par défaut (octets). Au-delà, repli
 * lien signé. Valeur alignée sur le plafond documenté Resend (~40 Mo, marge prise
 * à 25 Mo pour l'encodage base64). Injectable par configuration.
 */
export const DEFAULT_ATTACHMENT_LIMIT_BYTES = 25 * 1024 * 1024;

/** Horloge injectable (retourne l'epoch ms courant). */
export type Clock = () => number;

/** Pièce jointe candidate (avec sa taille en octets pour l'arbitrage de plafond). */
export interface CandidateAttachment {
  /** Nom de fichier. */
  filename: string;
  /** Contenu encodé base64. */
  contentBase64: string;
  /** Type MIME. */
  contentType: string;
  /** Taille du fichier décodé (octets). */
  sizeBytes: number;
}

/** Objet stocké dans le stockage mock (clé → contenu + méta). */
export interface StoredObject {
  /** Clé d'objet unique. */
  objectKey: string;
  /** Contenu encodé base64. */
  contentBase64: string;
  /** Type MIME. */
  contentType: string;
  /** Nom de fichier d'origine. */
  filename: string;
}

/**
 * Stockage objet MOCK (en mémoire) — remplace S3/R2 en NOTIF-004. Le vrai stockage
 * s'y substituera derrière la même interface `put`.
 */
export interface ObjectStore {
  /**
   * Dépose un objet et retourne sa clé.
   *
   * @param object - Contenu + méta
   * @returns Clé d'objet (référence de récupération)
   */
  put: (object: Omit<StoredObject, "objectKey"> & { objectKey: string }) => Promise<void>;
  /** Récupère un objet par clé (null si absent) — pour la route de download. */
  get: (objectKey: string) => Promise<StoredObject | null>;
}

/** Stockage objet en mémoire (mock déterministe, zéro I/O réseau). */
export class InMemoryObjectStore implements ObjectStore {
  private readonly objects = new Map<string, StoredObject>();

  /** @inheritdoc */
  async put(object: StoredObject): Promise<void> {
    this.objects.set(object.objectKey, object);
  }

  /** @inheritdoc */
  async get(objectKey: string): Promise<StoredObject | null> {
    return this.objects.get(objectKey) ?? null;
  }
}

/** Dépendances du générateur de liens signés. */
export interface SignedLinkDeps {
  /** Secret HMAC de signature (jamais loggé). */
  signingSecret: string;
  /** Base d'URL publique de téléchargement (ex. `https://storage.sigfa.ci/attachments`). */
  baseUrl: string;
  /** Horloge injectable (déterminisme). */
  clock?: Clock;
  /** TTL du lien (ms), défaut 24 h (D3). */
  ttlMs?: number;
}

/** Résultat d'un lien signé (URL + expiration absolue). */
export interface SignedLink {
  /** URL signée complète (avec `sig` + `expires`). */
  url: string;
  /** Instant d'expiration (epoch ms). */
  expiresAt: number;
  /** Clé d'objet référencée. */
  objectKey: string;
}

/**
 * Calcule la signature HMAC-SHA256 d'un lien `(objectKey, expiresAtEpoch)`.
 *
 * @param secret        - Secret de signature
 * @param objectKey     - Clé d'objet
 * @param expiresAtEpoch- Expiration (epoch ms)
 * @returns Signature hex
 */
export function signAttachmentLink(
  secret: string,
  objectKey: string,
  expiresAtEpoch: number
): string {
  return createHmac("sha256", secret)
    .update(`${objectKey}:${expiresAtEpoch}`)
    .digest("hex");
}

/**
 * Vérifie une signature de lien en temps constant + contrôle d'expiration.
 *
 * @param deps           - Secret + horloge
 * @param objectKey      - Clé d'objet
 * @param expiresAtEpoch - Expiration présentée (epoch ms)
 * @param signature      - Signature présentée (hex)
 * @returns `true` si signature valide ET non expirée
 */
export function verifyAttachmentLink(
  deps: { signingSecret: string; clock?: Clock },
  objectKey: string,
  expiresAtEpoch: number,
  signature: string
): boolean {
  const now = (deps.clock ?? Date.now)();
  if (now >= expiresAtEpoch) return false;
  const expected = signAttachmentLink(deps.signingSecret, objectKey, expiresAtEpoch);
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(signature, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Générateur de clé d'objet — injectable pour des snapshots déterministes. */
export type ObjectKeyFn = (attachment: CandidateAttachment) => string;

/**
 * Détermine si une pièce jointe doit basculer en lien signé (dépasse le plafond).
 *
 * @param attachment - Pièce candidate
 * @param limitBytes - Plafond (octets)
 * @returns `true` si la pièce dépasse le plafond fournisseur
 */
export function exceedsAttachmentLimit(
  attachment: CandidateAttachment,
  limitBytes: number
): boolean {
  return attachment.sizeBytes > limitBytes;
}

/**
 * Stocke une pièce jointe hors limite et retourne un lien signé à TTL 24 h (D3).
 * Le fichier n'est JAMAIS joint à l'email : le corps porte ce lien à la place.
 *
 * @param store      - Stockage objet (mock en NOTIF-004)
 * @param deps       - Secret, base d'URL, horloge, TTL
 * @param attachment - Pièce jointe à externaliser
 * @param objectKeyFn- Génère la clé d'objet
 * @returns Lien signé (URL + expiration)
 */
export async function storeAndSign(
  store: ObjectStore,
  deps: SignedLinkDeps,
  attachment: CandidateAttachment,
  objectKeyFn: ObjectKeyFn
): Promise<SignedLink> {
  const now = (deps.clock ?? Date.now)();
  const ttl = deps.ttlMs ?? SIGNED_LINK_TTL_MS;
  const expiresAt = now + ttl;
  const objectKey = objectKeyFn(attachment);

  await store.put({
    objectKey,
    contentBase64: attachment.contentBase64,
    contentType: attachment.contentType,
    filename: attachment.filename,
  });

  const signature = signAttachmentLink(deps.signingSecret, objectKey, expiresAt);
  const url = `${deps.baseUrl}/${encodeURIComponent(objectKey)}?expires=${expiresAt}&sig=${signature}`;
  return { url, expiresAt, objectKey };
}
