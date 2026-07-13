/**
 * config/email — paramètres du canal email interne NOTIF-004. Toutes les valeurs
 * sont INJECTABLES via l'environnement, avec des défauts sûrs.
 *
 * LA LOI (NOTIF-004 + D3) :
 *  - `EMAIL_INTERNAL_DOMAINS` : allow-list des domaines internes (staff). Toute
 *    adresse hors de cette liste est REFUSÉE (jamais un email client).
 *  - `EMAIL_FROM` : adresse d'expédition (domaine banque, SPF/DKIM en prod).
 *  - `EMAIL_ATTACHMENT_SIGNING_SECRET` : secret HMAC des liens signés de pièce jointe.
 *  - `EMAIL_ATTACHMENT_BASE_URL` : base d'URL publique de téléchargement.
 *  - `EMAIL_ATTACHMENT_LIMIT_BYTES` : plafond au-delà duquel repli lien signé (D3).
 *
 * @module
 */

import { DEFAULT_ATTACHMENT_LIMIT_BYTES } from "src/services/email/attachment-storage.js";

/** Domaines internes par défaut (à surcharger par banque en déploiement). */
export const DEFAULT_INTERNAL_DOMAINS = ["sigfa.local"] as const;

/** Adresse d'expédition par défaut. */
export const DEFAULT_EMAIL_FROM = "no-reply@sigfa.local" as const;

/** Base d'URL de téléchargement par défaut. */
export const DEFAULT_ATTACHMENT_BASE_URL =
  "https://storage.sigfa.local/attachments" as const;

/** Configuration résolue du canal email. */
export interface EmailConfig {
  /** Domaines internes autorisés (allow-list « internes uniquement »). */
  internalDomains: string[];
  /** Adresse d'expédition. */
  from: string;
  /** Secret HMAC de signature des liens de pièce jointe. */
  attachmentSigningSecret: string;
  /** Base d'URL publique de téléchargement des pièces jointes. */
  attachmentBaseUrl: string;
  /** Plafond de pièce jointe (octets) — au-delà, repli lien signé. */
  attachmentLimitBytes: number;
}

/**
 * Lit une liste séparée par virgules depuis l'environnement, sinon le défaut.
 *
 * @param name     - Nom de la variable d'environnement
 * @param fallback - Liste par défaut
 * @returns Liste non vide (défaut si absente/vide)
 */
function readList(name: string, fallback: readonly string[]): string[] {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return [...fallback];
  const values = raw
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .filter((v) => v.length > 0);
  return values.length > 0 ? values : [...fallback];
}

/**
 * Lit une chaîne non vide depuis l'environnement, sinon le défaut.
 *
 * @param name     - Nom de la variable d'environnement
 * @param fallback - Valeur par défaut
 * @returns Chaîne configurée ou défaut
 */
function readString(name: string, fallback: string): string {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  return raw.trim();
}

/**
 * Lit un entier strictement positif depuis l'environnement, sinon le défaut.
 *
 * @param name     - Nom de la variable d'environnement
 * @param fallback - Valeur par défaut (entier > 0)
 * @returns Entier positif configuré ou défaut
 */
function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) return fallback;
  return value;
}

/**
 * Résout la configuration email depuis l'environnement (injectable, recalculée à
 * chaque appel pour permettre l'override en test).
 *
 * @returns Config email résolue
 */
export function getEmailConfig(): EmailConfig {
  return {
    internalDomains: readList("EMAIL_INTERNAL_DOMAINS", DEFAULT_INTERNAL_DOMAINS),
    from: readString("EMAIL_FROM", DEFAULT_EMAIL_FROM),
    attachmentSigningSecret: readString(
      "EMAIL_ATTACHMENT_SIGNING_SECRET",
      "dev-attachment-signing-secret"
    ),
    attachmentBaseUrl: readString(
      "EMAIL_ATTACHMENT_BASE_URL",
      DEFAULT_ATTACHMENT_BASE_URL
    ),
    attachmentLimitBytes: readPositiveInt(
      "EMAIL_ATTACHMENT_LIMIT_BYTES",
      DEFAULT_ATTACHMENT_LIMIT_BYTES
    ),
  };
}
