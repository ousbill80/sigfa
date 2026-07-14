/**
 * KIOSK-001 — kiosk-session.ts
 * Gestion de la session borne via @sigfa/contracts (zéro fetch direct).
 */
import { createSigfaClient } from "@sigfa/contracts";

export interface KioskSessionParams {
  kioskId: string;
  kioskSecret: string;
  agencyId: string;
  apiUrl: string;
}

export interface KioskSession {
  accessToken: string;
  expiresIn: number;
  kioskId: string;
  agencyId: string;
  /**
   * CONTRACT-014 : identifiant PUBLIC de la banque de la borne (donnée
   * d'enseigne, zéro PII). Alimente le theming (--brand, logo) depuis la
   * session — remplace NEXT_PUBLIC_BANK_ID quand la session est présente.
   */
  bankId: string;
  /** Timestamp (ms) de création de la session */
  createdAt: number;
}

/**
 * Crée une session borne en appelant POST /kiosk/session via @sigfa/contracts.
 * Aucun fetch direct — tout passe par le client typé.
 */
export async function createKioskSession(
  params: KioskSessionParams
): Promise<KioskSession | null> {
  const client = createSigfaClient("public", params.apiUrl);

  const { data, error } = await client.POST("/kiosk/session", {
    body: {
      kioskId: params.kioskId,
      kioskSecret: params.kioskSecret,
      agencyId: params.agencyId,
    },
  });

  if (error || !data) {
    console.error("[kiosk-session] Erreur création session:", error);
    return null;
  }

  return {
    accessToken: data.accessToken,
    expiresIn: data.expiresIn,
    kioskId: data.kioskId,
    agencyId: data.agencyId,
    bankId: data.bankId,
    createdAt: Date.now(),
  };
}

/**
 * Vérifie si une session borne est expirée.
 * Une session de 43200 s (12h) est considérée expirée si le temps écoulé
 * depuis sa création dépasse expiresIn secondes.
 */
export function isSessionExpired(session: KioskSession): boolean {
  const elapsedMs = Date.now() - session.createdAt;
  const expiresMs = session.expiresIn * 1000;
  return elapsedMs >= expiresMs;
}
