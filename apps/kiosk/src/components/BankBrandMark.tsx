/**
 * KIOSK-HOME (retour visuel PO) — components/BankBrandMark.tsx
 * Marque du tenant sur l'écran d'accueil : c'est l'écran de MARQUE de la banque.
 *
 *  - Logo fourni (contrat CONTRACT-013 `logoUrl`) : rendu généreux sur une
 *    plaque claire (`--ink-inverse`, rayon `--r-xl`) — lisible sur `--night`
 *    quel que soit le logo du tenant, sombre ou clair.
 *  - Pas de logo, ou échec de chargement (`onError`) : repli élégant en
 *    monogramme typographique (pastille `--brand`, initiales), même motif que
 *    le repli avatar conseiller — JAMAIS d'image cassée à l'écran.
 *  - Le nom de la banque accompagne TOUJOURS la marque (exigence PO).
 *
 * Tokens @sigfa/ui uniquement, zéro emoji, zéro hex en dur.
 */
"use client";

import { useState } from "react";
import { bankMonogram } from "@/lib/bank-brand";

interface BankBrandMarkProps {
  /** Nom public de la banque (donnée d'enseigne, non-PII). */
  bankName: string;
  /** URL publique du logo tenant (contrat : nullable). */
  logoUrl?: string | null;
}

export function BankBrandMark({ bankName, logoUrl }: BankBrandMarkProps) {
  const [imgFailed, setImgFailed] = useState(false);
  const showLogo = Boolean(logoUrl) && !imgFailed;

  return (
    <div
      data-testid="bank-brand"
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "var(--space-4)",
      }}
    >
      {showLogo ? (
        // Plaque claire : le logo du tenant reste lisible sur --night.
        <div
          style={{
            backgroundColor: "var(--ink-inverse)",
            borderRadius: "var(--r-xl)",
            padding: "var(--space-6) var(--space-12)",
            boxShadow: "var(--shadow-2)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {/* <img> volontaire (comme l'avatar conseiller) : logo tenant distant
              (CDN), hors pipeline next/image en static export borne. */}
          <img
            data-testid="bank-logo"
            src={logoUrl as string}
            alt={bankName}
            onError={() => setImgFailed(true)}
            style={{
              display: "block",
              height: "88px",
              maxWidth: "420px",
              objectFit: "contain",
            }}
          />
        </div>
      ) : (
        // Repli monogramme — pastille --brand, initiales typographiques.
        <span
          data-testid="bank-monogram"
          aria-hidden="true"
          style={{
            width: "112px",
            height: "112px",
            borderRadius: "var(--r-full)",
            backgroundColor: "var(--brand)",
            color: "var(--brand-contrast)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: "var(--font-display)",
            fontSize: "44px",
            fontWeight: 700,
            letterSpacing: "var(--tracking-tight)",
            boxShadow: "var(--shadow-2)",
          }}
        >
          {bankMonogram(bankName)}
        </span>
      )}

      {/* Le nom du tenant accompagne toujours la marque. */}
      <span
        data-testid="bank-name"
        style={{
          fontSize: "24px",
          fontWeight: 600,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: "var(--ink-inverse)",
          textAlign: "center",
        }}
      >
        {bankName}
      </span>
    </div>
  );
}
