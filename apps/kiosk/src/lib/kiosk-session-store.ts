/**
 * Boucle 2 F4 — S5 : store EN MÉMOIRE de la session borne (KIOSK-001).
 *
 * La session borne (JWT scope agency, TTL 43 200 s = 12 h, NON renouvelable)
 * vit exclusivement dans une variable de module :
 *  - JAMAIS localStorage / sessionStorage / Dexie — la borne est un appareil
 *    PARTAGÉ, aucune trace persistante du token ne doit exister.
 *  - À expiration, la session est RE-CRÉÉE via le provisionneur enregistré.
 *  - En échec de provisionnement : borne dégradée (retour null), pas de crash.
 *
 * Le PROVISIONNEMENT est délégué : le secret de provisionnement de la borne
 * ne doit jamais atteindre le bundle client. En production Electron, le pont preload
 * (`window.kioskAuth`, contextBridge) fait créer la session par le processus
 * principal (voir `electron/main.ts`) et ne renvoie que le JWT au renderer.
 */
import { isSessionExpired, type KioskSession } from "@/lib/kiosk-session";

/** DTO renvoyé par le pont Electron (preload contextBridge) — JWT sans secret. */
export interface KioskSessionDto {
  accessToken: string;
  expiresIn: number;
  kioskId: string;
  agencyId: string;
  /** CONTRACT-014 : bankId public de la borne (theming session, zéro PII). */
  bankId: string;
}

/** API exposée au renderer par `electron/preload.ts` via contextBridge. */
export interface KioskAuthBridge {
  createSession: () => Promise<KioskSessionDto | null>;
}

declare global {
  interface Window {
    /** Pont session borne — présent uniquement sous le shell Electron. */
    kioskAuth?: KioskAuthBridge;
  }
}

/** Fabrique de session borne (délègue au main process ou à un mock de test). */
export type KioskSessionProvisioner = () => Promise<KioskSession | null>;

let currentSession: KioskSession | null = null;
let currentProvisioner: KioskSessionProvisioner | null = null;

/**
 * CONTRACT-014 : abonnés au cycle de vie de la session (theming réactif —
 * le bankId de session arrive APRÈS le premier rendu de l'accueil).
 */
const sessionListeners = new Set<() => void>();

function notifySessionListeners(): void {
  for (const listener of sessionListeners) listener();
}

/**
 * S'abonne aux changements de session borne (création/échec). Renvoie la
 * fonction de désabonnement — signature compatible `useSyncExternalStore`.
 */
export function subscribeKioskSession(listener: () => void): () => void {
  sessionListeners.add(listener);
  return () => {
    sessionListeners.delete(listener);
  };
}

/**
 * Enregistre le provisionneur utilisé pour (re)créer la session borne.
 * `null` = aucun canal de provisionnement (navigateur nu / mode mock).
 */
export function registerKioskSessionProvisioner(
  provisioner: KioskSessionProvisioner | null
): void {
  currentProvisioner = provisioner;
}

/** Session courante si valide, sinon null (absente ou expirée). */
export function getKioskSession(): KioskSession | null {
  if (currentSession && !isSessionExpired(currentSession)) {
    return currentSession;
  }
  return null;
}

/** JWT de la session borne courante, ou null (absente/expirée → dégradé). */
export function getKioskSessionToken(): string | null {
  return getKioskSession()?.accessToken ?? null;
}

/**
 * CONTRACT-014 : bankId public de la session borne courante, ou null
 * (absente/expirée — jamais de bankId périmé). Le theming retombe alors sur
 * le repli env `NEXT_PUBLIC_BANK_ID` (DEV/démo) via `useBankTheme`.
 */
export function getKioskSessionBankId(): string | null {
  return getKioskSession()?.bankId ?? null;
}

/**
 * Garantit une session borne valide : réutilise la session en cours, ou la
 * RE-CRÉE via le provisionneur si elle est absente/expirée (12 h non
 * renouvelable). En échec : null — la borne reste utilisable en mode dégradé.
 */
export async function ensureKioskSession(): Promise<KioskSession | null> {
  const valid = getKioskSession();
  if (valid) return valid;

  currentSession = null;
  if (!currentProvisioner) return null;

  try {
    currentSession = await currentProvisioner();
  } catch {
    // Échec réseau/provisionnement : borne dégradée, jamais de crash.
    currentSession = null;
  }
  // CONTRACT-014 : notifie les abonnés (theming --brand/logo réactif).
  notifySessionListeners();
  return currentSession;
}

/**
 * Résout le provisionneur runtime : pont Electron (`window.kioskAuth`) si le
 * shell est présent, sinon null — un navigateur nu n'a AUCUN moyen sûr de
 * porter le secret de provisionnement (couture consignée au rapport).
 */
export function resolveKioskSessionProvisioner(): KioskSessionProvisioner | null {
  if (typeof window === "undefined" || !window.kioskAuth) return null;
  const bridge = window.kioskAuth;
  return async () => {
    const dto = await bridge.createSession();
    if (!dto) return null;
    return { ...dto, createdAt: Date.now() };
  };
}

/** Réinitialisation complète — réservé aux tests. */
export function __resetKioskSessionForTests(): void {
  currentSession = null;
  currentProvisioner = null;
  sessionListeners.clear();
}
