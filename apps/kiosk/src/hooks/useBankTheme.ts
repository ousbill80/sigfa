/**
 * KIOSK-HOME (retour visuel PO) — hooks/useBankTheme.ts
 * Projection publique du thème tenant pour l'écran de marque de la borne.
 *
 * Contrat : GET /public/banks/{id}/theme (admin.yaml, CONTRACT-013) — route
 * PUBLIQUE (aucune authentification), zéro PII : `logoUrl` (nullable),
 * `appliedColors` (couleurs corrigées WCAG côté serveur), `welcomeMessages`.
 *
 * Comportement borne (jamais bloquant) :
 *  - sans `NEXT_PUBLIC_BANK_ID` (borne non provisionnée / démo nue) : AUCUNE
 *    requête, état de repli — l'écran affiche le monogramme ;
 *  - erreur réseau/serveur : repli SILENCIEUX, l'accueil reste utilisable.
 */
"use client";

import { useEffect, useState } from "react";
import { createSigfaClient } from "@sigfa/contracts";
import { kioskBankId } from "@/lib/bank-brand";

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

/**
 * Charge la projection publique du thème de la banque provisionnée.
 *
 * @param bankId - Identifiant public de la banque (défaut : provisionnement
 *   `NEXT_PUBLIC_BANK_ID`). `null` = pas de requête, état de repli.
 * @returns `{ logoUrl, brandColor }` — repli `{ null, null }` tant que le
 *   thème n'est pas chargé (ou en échec).
 */
export function useBankTheme(bankId: string | null = kioskBankId()): BankThemeState {
  const [state, setState] = useState<BankThemeState>(FALLBACK_STATE);

  useEffect(() => {
    if (bankId === null) return undefined;

    let cancelled = false;
    // La route publique du thème vit dans le module OpenAPI `admin`
    // (sécurité : `security: []`, aucun token requis).
    const client = createSigfaClient("admin", apiBaseUrl());

    void (async () => {
      try {
        const { data, response } = await client.GET("/public/banks/{id}/theme", {
          params: { path: { id: bankId } },
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
  }, [bankId]);

  return state;
}
