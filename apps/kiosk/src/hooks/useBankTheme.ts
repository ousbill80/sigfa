/**
 * KIOSK-HOME (retour visuel PO) — hooks/useBankTheme.ts
 * Projection publique du thème tenant pour l'écran de marque de la borne.
 *
 * Contrat : GET /public/banks/{id}/theme (admin.yaml, CONTRACT-013) — route
 * PUBLIQUE (aucune authentification), zéro PII : `logoUrl` (nullable),
 * `appliedColors` (couleurs corrigées WCAG côté serveur), `welcomeMessages`.
 *
 * Résolution du bankId (CONTRACT-014) — session d'abord :
 *  1. `bankId` de la SESSION borne (POST /kiosk/session, donnée d'enseigne
 *     publique) — réactif : le provisionnement Electron est asynchrone ;
 *  2. repli `NEXT_PUBLIC_BANK_ID` (DEV/démo documenté dans `.env.example`) ;
 *  3. sinon AUCUNE requête, état de repli — l'écran affiche le monogramme.
 *
 * Comportement borne (jamais bloquant) : erreur réseau/serveur = repli
 * SILENCIEUX, l'accueil reste utilisable.
 */
"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { createSigfaClient } from "@sigfa/contracts";
import { kioskBankId } from "@/lib/bank-brand";
import {
  subscribeKioskSession,
  getKioskSessionBankId,
} from "@/lib/kiosk-session-store";

/** État de thème consommé par l'écran d'accueil. */
export interface BankThemeState {
  /** URL publique du logo tenant (null = repli monogramme). */
  logoUrl: string | null;
  /** Couleur primaire appliquée (hex) — alimente BankThemeProvider (--brand). */
  brandColor: string | null;
}

const FALLBACK_STATE: BankThemeState = { logoUrl: null, brandColor: null };

/** Base URL de l'API — mock Prism canonique par défaut (RT-001b). */
function apiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4010";
}

/** SSR : jamais de session borne côté serveur. */
function getServerSessionBankId(): string | null {
  return null;
}

/**
 * CONTRACT-014 — bankId effectif de la borne : celui de la SESSION quand elle
 * est présente (réactif via `subscribeKioskSession`), sinon repli env
 * `NEXT_PUBLIC_BANK_ID` (DEV/démo), sinon null (monogramme).
 */
export function useKioskBankId(): string | null {
  const sessionBankId = useSyncExternalStore(
    subscribeKioskSession,
    getKioskSessionBankId,
    getServerSessionBankId
  );
  return sessionBankId ?? kioskBankId();
}

/**
 * Charge la projection publique du thème de la banque provisionnée.
 *
 * @param bankId - Identifiant public de la banque. `undefined` (défaut) =
 *   résolution automatique session → env (CONTRACT-014) ; `null` = pas de
 *   requête, état de repli.
 * @returns `{ logoUrl, brandColor }` — repli `{ null, null }` tant que le
 *   thème n'est pas chargé (ou en échec).
 */
export function useBankTheme(bankId?: string | null): BankThemeState {
  const autoBankId = useKioskBankId();
  const resolvedBankId = bankId === undefined ? autoBankId : bankId;
  const [state, setState] = useState<BankThemeState>(FALLBACK_STATE);

  useEffect(() => {
    if (resolvedBankId === null) return undefined;

    let cancelled = false;
    // La route publique du thème vit dans le module OpenAPI `admin`
    // (sécurité : `security: []`, aucun token requis).
    const client = createSigfaClient("admin", apiBaseUrl());

    void (async () => {
      try {
        const { data, response } = await client.GET("/public/banks/{id}/theme", {
          params: { path: { id: resolvedBankId } },
        });
        if (cancelled || response.status !== 200 || !data) return;
        setState({
          logoUrl: data.logoUrl ?? null,
          brandColor: data.appliedColors?.primary ?? null,
        });
      } catch {
        // Repli silencieux (monogramme) — l'accueil n'est jamais bloqué.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [resolvedBankId]);

  return state;
}
