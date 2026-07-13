/**
 * config/sms — sélection du fournisseur SMS + paramètres SMPP (SMS-SMPP).
 *
 * LA LOI (SMS-SMPP) : le canal SMS est branché derrière l'interface `SmsAdapter`
 * (NOTIF-002). En dev/CI le MOCK reste le défaut ; le VRAI fournisseur IAM (SMPP,
 * sender `ZENAPI`) s'active UNIQUEMENT si `SMS_PROVIDER=smpp` ET la config présente.
 *
 * SÉCURITÉ (CRITIQUE) : TOUTES les valeurs (host/port/system_id/password/sender…)
 * proviennent EXCLUSIVEMENT de `process.env`. AUCUN secret n'est écrit en dur ni
 * committé. Le `.env.example` ne contient que les NOMS avec des valeurs vides.
 *
 * @module
 */

/** Fournisseur SMS sélectionné. */
export type SmsProvider = "smpp" | "mock";

/** Fournisseur par défaut : MOCK (dev/CI, aucun réseau). */
export const DEFAULT_SMS_PROVIDER: SmsProvider = "mock";

/** Sender par défaut (alphanumérique) — surchargé par `SMS_SENDER_ID` en prod. */
export const DEFAULT_SMS_SENDER_ID = "ZENAPI" as const;

/** TON source par défaut : alphanumérique (5) pour un sender lettré. */
export const DEFAULT_SMPP_SOURCE_TON = 5 as const;
/** NPI source par défaut : inconnu (0). */
export const DEFAULT_SMPP_SOURCE_NPI = 0 as const;
/** TON destinataire par défaut : inconnu (0). */
export const DEFAULT_SMPP_DEST_TON = 0 as const;
/** NPI destinataire par défaut : ISDN (1). */
export const DEFAULT_SMPP_DEST_NPI = 1 as const;

/** Paramètres de connexion + soumission SMPP (résolus depuis l'environnement). */
export interface SmppConfig {
  /** Hôte du SMSC IAM. */
  host: string;
  /** Port SMPP (défaut 2775). */
  port: number;
  /** Identifiant système (auth bind). */
  systemId: string;
  /** Mot de passe (auth bind) — jamais journalisé. */
  password: string;
  /** Adresse source affichée (sender ZENAPI). */
  senderId: string;
  /** TON de l'adresse source. */
  sourceTon: number;
  /** NPI de l'adresse source. */
  sourceNpi: number;
  /** TON de l'adresse destinataire. */
  destTon: number;
  /** NPI de l'adresse destinataire. */
  destNpi: number;
  /** Demander les accusés de livraison (DLR) au SMSC. */
  enableDlr: boolean;
}

/** Configuration SMS résolue (fournisseur + éventuels paramètres SMPP). */
export interface SmsConfig {
  /** Fournisseur sélectionné. */
  provider: SmsProvider;
  /** Config SMPP si `provider=smpp` ET config complète, sinon `null`. */
  smpp: SmppConfig | null;
}

/** Lit une chaîne non vide depuis l'environnement, sinon `undefined`. */
function readString(name: string): string | undefined {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return undefined;
  return raw.trim();
}

/** Lit un entier ≥ 0 depuis l'environnement, sinon le défaut. */
function readInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) return fallback;
  return value;
}

/**
 * Lit un drapeau `1`/`0` (ou `true`/`false`) depuis l'environnement.
 *
 * @param name     - Nom de la variable
 * @param fallback - Valeur par défaut
 * @returns Booléen résolu
 */
function readBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const v = raw.trim().toLowerCase();
  if (v === "1" || v === "true") return true;
  if (v === "0" || v === "false") return false;
  return fallback;
}

/**
 * Résout le fournisseur SMS demandé (défaut `mock`). Toute valeur inconnue
 * retombe sur `mock` (jamais de démarrage en `smpp` par erreur de frappe).
 *
 * @returns Fournisseur sélectionné
 */
export function resolveSmsProvider(): SmsProvider {
  return readString("SMS_PROVIDER") === "smpp" ? "smpp" : DEFAULT_SMS_PROVIDER;
}

/**
 * Résout la config SMPP depuis l'environnement. Retourne `null` si un paramètre
 * OBLIGATOIRE (host/port/system_id/password) manque — le facteur retombe alors
 * sur le MOCK (jamais de bind incomplet). Les secrets ne quittent JAMAIS `env`.
 *
 * @returns Config SMPP complète, ou `null` si incomplète
 */
export function resolveSmppConfig(): SmppConfig | null {
  const host = readString("SMPP_HOST");
  const systemId = readString("SMPP_SYSTEM_ID");
  const password = readString("SMPP_PASSWORD");
  const port = readInt("SMPP_PORT", 2775);
  // Host + systemId + password sont indispensables au bind ; sans eux → null.
  if (host === undefined || systemId === undefined || password === undefined) {
    return null;
  }
  return {
    host,
    port,
    systemId,
    password,
    senderId: readString("SMS_SENDER_ID") ?? DEFAULT_SMS_SENDER_ID,
    sourceTon: readInt("SMPP_SOURCE_TON", DEFAULT_SMPP_SOURCE_TON),
    sourceNpi: readInt("SMPP_SOURCE_NPI", DEFAULT_SMPP_SOURCE_NPI),
    destTon: readInt("SMPP_DEST_TON", DEFAULT_SMPP_DEST_TON),
    destNpi: readInt("SMPP_DEST_NPI", DEFAULT_SMPP_DEST_NPI),
    enableDlr: readBool("SMPP_ENABLE_DLR", true),
  };
}

/**
 * Résout la configuration SMS complète (fournisseur + SMPP). Le `provider`
 * effectif est `smpp` UNIQUEMENT si demandé ET config SMPP complète ; sinon `mock`.
 *
 * @returns Config SMS résolue
 */
export function getSmsConfig(): SmsConfig {
  const requested = resolveSmsProvider();
  const smpp = requested === "smpp" ? resolveSmppConfig() : null;
  // Gating : demandé smpp mais config absente ⇒ MOCK (jamais de crash au boot).
  const provider: SmsProvider = requested === "smpp" && smpp !== null ? "smpp" : "mock";
  return { provider, smpp };
}
