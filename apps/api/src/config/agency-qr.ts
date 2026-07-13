/**
 * config/agency-qr — configuration du jeton QR agence signé (NOTIF-005-A).
 *
 * Résout depuis l'environnement :
 *  - le **trousseau de clés HMAC versionnées** (`AgencyQrKeyring`) : version
 *    courante de signature + toutes les versions encore acceptées en vérification
 *    (rotation sans casser les QR encore dans leur fenêtre de 30 j) ;
 *  - la **base d'URL de la PWA** dans laquelle est encodé le token (`qrUrl`).
 *
 * Variables d'environnement (voir `.env.example`) :
 *  - `AGENCY_QR_SIGNING_KEYS` : liste `version:secret` séparée par virgules
 *    (ex. `1:ancien-secret,2:secret-courant`). Défaut DEV : `1:<clé de dev>`.
 *  - `AGENCY_QR_KEY_VERSION` : version courante de signature (défaut : plus haute
 *    version présente dans `AGENCY_QR_SIGNING_KEYS`).
 *  - `AGENCY_QR_PWA_BASE_URL` : base de l'URL PWA (défaut DEV `https://app.sigfa.local/q`).
 *
 * @module
 */

import type { AgencyQrKeyring } from "src/lib/agency-qr-token.js";

/** Secret de signature QR par défaut (DEV/CI uniquement — jamais en prod). */
const DEV_DEFAULT_KEY = "dev-agency-qr-signing-secret-32bytes!" as const;

/** Version par défaut si `AGENCY_QR_SIGNING_KEYS` est absent (DEV). */
const DEV_DEFAULT_VERSION = 1 as const;

/** Base d'URL PWA par défaut (DEV). */
const DEV_DEFAULT_PWA_BASE_URL = "https://app.sigfa.local/q" as const;

/** Configuration résolue du QR agence. */
export interface AgencyQrConfig {
  /** Trousseau de clés HMAC versionnées (signature + vérification multi-version). */
  keyring: AgencyQrKeyring;
  /** Base d'URL PWA dans laquelle le token est encodé (`{base}/{agencyId}?t=…`). */
  pwaBaseUrl: string;
}

/**
 * Parse `AGENCY_QR_SIGNING_KEYS` (`v:secret,v:secret,…`) en table indexée.
 * Ignore les entrées malformées ; retourne `null` si aucune entrée valide.
 *
 * @param raw - Valeur brute de la variable d'environnement
 * @returns Table `{ [version]: secret }` ou `null`
 */
function parseKeys(raw: string | undefined): Record<number, string> | null {
  if (raw === undefined || raw.trim() === "") return null;
  const keys: Record<number, string> = {};
  for (const entry of raw.split(",")) {
    const idx = entry.indexOf(":");
    if (idx <= 0) continue;
    const version = Number(entry.slice(0, idx).trim());
    const secret = entry.slice(idx + 1).trim();
    if (!Number.isInteger(version) || version <= 0 || secret === "") continue;
    keys[version] = secret;
  }
  return Object.keys(keys).length > 0 ? keys : null;
}

/** Résout la version courante : env explicite, sinon plus haute version connue. */
function resolveCurrentVersion(
  keys: Record<number, string>,
  raw: string | undefined
): number {
  if (raw !== undefined && raw.trim() !== "") {
    const parsed = Number(raw.trim());
    if (Number.isInteger(parsed) && parsed > 0 && keys[parsed]) return parsed;
  }
  return Math.max(...Object.keys(keys).map(Number));
}

/**
 * Résout la configuration QR agence depuis l'environnement (défauts DEV sûrs).
 *
 * @param env - Table d'environnement (défaut `process.env`)
 * @returns Configuration résolue (trousseau + base PWA)
 */
export function resolveAgencyQrConfig(
  env: NodeJS.ProcessEnv = process.env
): AgencyQrConfig {
  const parsed = parseKeys(env["AGENCY_QR_SIGNING_KEYS"]);
  const keys = parsed ?? { [DEV_DEFAULT_VERSION]: DEV_DEFAULT_KEY };
  const current = resolveCurrentVersion(keys, env["AGENCY_QR_KEY_VERSION"]);
  const pwaBaseUrl = readBaseUrl(env["AGENCY_QR_PWA_BASE_URL"]);
  return { keyring: { current, keys }, pwaBaseUrl };
}

/** Lit la base d'URL PWA (non vide), sinon le défaut DEV, sans slash final. */
function readBaseUrl(raw: string | undefined): string {
  const value = raw !== undefined && raw.trim() !== "" ? raw.trim() : DEV_DEFAULT_PWA_BASE_URL;
  return value.replace(/\/+$/, "");
}
