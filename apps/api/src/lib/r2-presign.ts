/**
 * Présignature d'URL R2 (S3-compatible) pour l'upload du logo banque — API-009.
 *
 * Cloudflare R2 expose une API compatible AWS S3. On génère une URL présignée
 * (méthode PUT) SANS appel réseau : la signature AWS SigV4 est calculée en local
 * (HMAC-SHA256), ce qui la rend testable hors-ligne avec un stub d'identifiants.
 *
 * **Sans configuration R2 (dev)** : `getR2Config` retourne `null` et l'appelant
 * doit répondre `503 R2_NOT_CONFIGURED` — jamais de crash.
 *
 * Périmètre F3 : upload réel prod = déploiement (hors scope). Ici, seule la
 * FORME de l'URL signée est produite et testée.
 *
 * @module
 */

import { createHash, createHmac } from "node:crypto";

/** Variables d'environnement requises pour la présignature R2. */
export interface R2Config {
  /** Identifiant de clé d'accès (S3). */
  accessKeyId: string;
  /** Clé secrète (S3). */
  secretAccessKey: string;
  /** Nom du bucket R2. */
  bucket: string;
  /** Endpoint R2 (ex. https://<account>.r2.cloudflarestorage.com). */
  endpoint: string;
  /** Région S3 (R2 accepte "auto"). */
  region: string;
}

/** Durée de validité de l'URL présignée (secondes) — LA LOI expiresIn=300. */
export const PRESIGN_EXPIRES_IN = 300;

/**
 * Lit la configuration R2 depuis l'environnement, ou `null` si incomplète.
 *
 * @param env - Table des variables d'environnement (défaut `process.env`)
 * @returns Configuration R2 complète, ou `null` (→ 503 côté route)
 */
export function getR2Config(
  env: NodeJS.ProcessEnv = process.env
): R2Config | null {
  const accessKeyId = env["R2_ACCESS_KEY_ID"];
  const secretAccessKey = env["R2_SECRET_ACCESS_KEY"];
  const bucket = env["R2_BUCKET"];
  const endpoint = env["R2_ENDPOINT"];
  if (!accessKeyId || !secretAccessKey || !bucket || !endpoint) return null;
  return {
    accessKeyId,
    secretAccessKey,
    bucket,
    endpoint,
    region: env["R2_REGION"] ?? "auto",
  };
}

/** Encodage RFC 3986 d'un segment de chemin (préserve les `/`). */
function encodePath(path: string): string {
  return path
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
}

/** Dérive la clé de signature AWS SigV4 (chaîne HMAC datée). */
function signingKey(
  secret: string,
  dateStamp: string,
  region: string
): Buffer {
  const kDate = createHmac("sha256", `AWS4${secret}`).update(dateStamp).digest();
  const kRegion = createHmac("sha256", kDate).update(region).digest();
  const kService = createHmac("sha256", kRegion).update("s3").digest();
  return createHmac("sha256", kService).update("aws4_request").digest();
}

/** Paramètres de présignature d'un PUT logo. */
export interface PresignParams {
  /** Configuration R2 (identifiants + endpoint). */
  config: R2Config;
  /** Clé objet dans le bucket (ex. `logos/<bankId>/logo.png`). */
  objectKey: string;
  /** Horloge injectable (défaut `new Date()`) pour des tests déterministes. */
  now?: Date;
}

/** Formate une date en `YYYYMMDDTHHMMSSZ` (SigV4 amz-date). */
function amzDate(now: Date): { amz: string; stamp: string } {
  const amz = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { amz, stamp: amz.slice(0, 8) };
}

/**
 * Génère une URL présignée R2 (PUT) pour l'upload du logo — SigV4 local.
 *
 * @param params - Configuration, clé objet et horloge injectable
 * @returns URL présignée absolue (query SigV4 complète), valide 300 s
 */
export function presignLogoPut(params: PresignParams): string {
  const { config, objectKey } = params;
  const now = params.now ?? new Date();
  const { amz, stamp } = amzDate(now);
  const host = new URL(config.endpoint).host;
  const canonicalUri = `/${config.bucket}/${encodePath(objectKey)}`;
  const scope = `${stamp}/${config.region}/s3/aws4_request`;
  const query = buildCanonicalQuery(config, amz, scope);
  const canonicalRequest = [
    "PUT",
    canonicalUri,
    query,
    `host:${host}\n`,
    "host",
    "UNSIGNED-PAYLOAD",
  ].join("\n");
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amz,
    scope,
    createHash("sha256").update(canonicalRequest).digest("hex"),
  ].join("\n");
  const signature = createHmac(
    "sha256",
    signingKey(config.secretAccessKey, stamp, config.region)
  )
    .update(stringToSign)
    .digest("hex");
  return `${config.endpoint}${canonicalUri}?${query}&X-Amz-Signature=${signature}`;
}

/** Construit la query canonique SigV4 (paramètres triés, hors signature). */
function buildCanonicalQuery(
  config: R2Config,
  amz: string,
  scope: string
): string {
  const params: Record<string, string> = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${config.accessKeyId}/${scope}`,
    "X-Amz-Date": amz,
    "X-Amz-Expires": String(PRESIGN_EXPIRES_IN),
    "X-Amz-SignedHeaders": "host",
  };
  return Object.keys(params)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(params[k] as string)}`)
    .join("&");
}
