/**
 * KIOSK-BORNE — KioskHeaderBanner.tsx
 * Bandeau d'en-tête persistant de l'écran « Prise de ticket » (modèle borne
 * bancaire réelle, bandeau déplacé du bas vers le HAUT et raffiné) :
 *   - identité banque côté brand : pastille `--brand` (initiale, SVG/texte,
 *     jamais d'image réseau) + nom de banque ;
 *   - nom de l'agence, mis en avant ;
 *   - date longue + heure VIVANTE (tick chaque seconde, affichage HH:MM).
 *
 * Sobre et élégant sur `--surface-kiosk` : une seule ligne, hairline discrète
 * en pied, tokens @sigfa/ui uniquement, zéro emoji, zéro hex en dur.
 */
"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { bankInitial } from "@/lib/kiosk-branding";

interface KioskHeaderBannerProps {
  /** Nom public de l'agence (donnée d'enseigne, non-PII). */
  agencyName: string;
  /** Nom public de la banque (theming libellé). */
  bankName: string;
}

/** Format date longue localisée (ex. « dimanche 13 juillet 2026 »). */
export function formatBannerDate(date: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

/** Format heure localisée HH:MM (24 h en FR, 12 h AM/PM en EN). */
export function formatBannerTime(date: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function KioskHeaderBanner({ agencyName, bankName }: KioskHeaderBannerProps) {
  const params = useParams();
  const currentLocale = (params?.locale as string) ?? "fr";

  // Heure vivante — tick 1 s (l'affichage ne change qu'à la minute, mais le
  // tick fin évite une minute « en retard » au changement). Pas d'animation :
  // un texte qui se met à jour respecte prefers-reduced-motion par nature.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <header
      data-testid="kiosk-header-banner"
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-6)",
        padding: "var(--space-4) var(--space-6)",
        backgroundColor: "var(--night-2)",
        borderRadius: "var(--r-lg)",
        boxShadow: "var(--shadow-1)",
      }}
    >
      {/* Identité banque — pastille brand (initiale texte, jamais d'image). */}
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-4)", minWidth: 0 }}>
        <span
          data-testid="kiosk-header-bank-badge"
          aria-hidden="true"
          style={{
            flexShrink: 0,
            width: "56px",
            height: "56px",
            borderRadius: "var(--r-md)",
            backgroundColor: "var(--brand)",
            color: "var(--brand-contrast)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: "var(--font-display)",
            fontSize: "28px",
            fontWeight: 700,
          }}
        >
          {bankInitial(bankName)}
        </span>
        <div style={{ display: "flex", flexDirection: "column", gap: "2px", minWidth: 0 }}>
          <span
            data-testid="kiosk-header-bank"
            style={{
              fontSize: "18px",
              fontWeight: 600,
              letterSpacing: "var(--tracking-tight)",
              color: "var(--ink-muted-inv)",
              textTransform: "uppercase",
              whiteSpace: "nowrap",
            }}
          >
            {bankName}
          </span>
          <span
            data-testid="kiosk-header-agency"
            style={{
              fontFamily: "var(--font-display)",
              fontSize: "26px",
              fontWeight: 700,
              color: "var(--ink-inverse)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {agencyName}
          </span>
        </div>
      </div>

      {/* Date longue + heure vivante — alignées à droite. */}
      <div
        style={{
          marginLeft: "auto",
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-end",
          gap: "2px",
        }}
      >
        <span
          data-testid="kiosk-header-time"
          style={{
            fontFamily: "var(--font-mono)",
            fontVariantNumeric: "tabular-nums",
            letterSpacing: "var(--tracking-numeric)",
            fontSize: "30px",
            fontWeight: 700,
            color: "var(--ink-inverse)",
          }}
        >
          {formatBannerTime(now, currentLocale)}
        </span>
        <span
          data-testid="kiosk-header-date"
          style={{ fontSize: "18px", color: "var(--ink-muted-inv)" }}
        >
          {formatBannerDate(now, currentLocale)}
        </span>
      </div>
    </header>
  );
}
