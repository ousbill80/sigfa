/**
 * KIOSK-BORNE — PrintTicket.tsx
 * Ticket THERMIQUE 80 mm imprimé à la borne (modèle ticket bancaire réel,
 * typographie et hiérarchie nettement relevées) :
 *   - `@page { size: 80mm auto; margin: 0 }`, largeur utile 72 mm ;
 *   - MASQUÉ à l'écran (`display:none`), SEUL visible en `@media print` ;
 *   - en-tête : banque (texte stylé brand — jamais d'image externe) + agence,
 *     date + heure à droite ;
 *   - « Bienvenue à l'agence… », « Votre numéro de passage », libellé de
 *     l'opération choisie — i18n FR/EN, accents PARFAITS (UTF-8 de bout en
 *     bout : le « esp¿ces » du modèle est le bug à éradiquer) ;
 *   - numéro en très gros, encadré sobre ;
 *   - « Personnes avant vous » + « Attente estimée : ~X min » (formats humains) ;
 *   - code de suivi court (trackingId) en texte — AUCUNE route publique web de
 *     suivi par trackingId n'existe à ce jour (le QR d'agence /q/[token] crée
 *     un NOUVEAU ticket, il ne suit pas un ticket existant) ;
 *   - courtoisie + mention SMS si consentement donné.
 *
 * Couleurs : `var(--ink)` sur fond papier — l'impression thermique est
 * monochrome, aucun hex en dur, aucun emoji, aucun élément réseau.
 */
"use client";

import { useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import {
  formatBannerDate,
  formatBannerTime,
} from "@/components/KioskHeaderBanner";

/** Longueur du code de suivi court affiché sur le ticket. */
export const SHORT_TRACKING_LENGTH = 8;

/** Code de suivi court, lisible à l'œil (préfixe du trackingId nanoid 21). */
export function shortTrackingCode(trackingId: string): string {
  return trackingId.slice(0, SHORT_TRACKING_LENGTH).toUpperCase();
}

export interface PrintTicketProps {
  /** Nom public de la banque (texte stylé brand, jamais d'image). */
  bankName: string;
  /** Nom public de l'agence. */
  agencyName: string;
  /** Libellé de l'opération/service choisi (public, non-PII). */
  serviceLabel?: string;
  /** Numéro d'appel (héros du ticket). */
  displayNumber: string;
  /** Personnes avant l'usager. */
  position: number;
  /** Attente estimée en minutes (format humain « ~X min »). */
  estimatedWaitMinutes: number;
  /** trackingId public (nanoid 21) — affiché en code court. */
  trackingId?: string;
  /** Consentement SMS donné → mention « prévenu par SMS ». */
  smsConsent?: boolean;
  /** Horodatage d'émission (injectable pour tests/screenshots). */
  issuedAt?: Date;
}

/**
 * Feuille de style du ticket thermique 80 mm. `@page` au niveau racine,
 * masquage écran, et en `@media print` SEUL le ticket est rendu (le reste de
 * l'écran est retiré du flux — pas de page blanche parasite).
 */
const PRINT_STYLES = `
@page { size: 80mm auto; margin: 0; }
.sigfa-print-ticket { display: none; }
@media print {
  html, body {
    height: auto !important;
    min-height: 0 !important;
    background: none !important;
  }
  main[role="main"] {
    min-height: 0 !important;
    padding: 0 !important;
    background: none !important;
    display: block !important;
  }
  main[role="main"] > *:not(.sigfa-print-ticket) { display: none !important; }
  .sigfa-print-ticket {
    display: block !important;
    width: 72mm;
    margin: 0 auto;
    padding: 4mm 2mm 6mm;
    color: var(--ink);
    font-family: var(--font-text);
    font-size: 10pt;
    line-height: 1.35;
  }
}
`;

export function PrintTicket({
  bankName,
  agencyName,
  serviceLabel,
  displayNumber,
  position,
  estimatedWaitMinutes,
  trackingId,
  smsConsent = false,
  issuedAt,
}: PrintTicketProps) {
  const t = useTranslations("print");
  const params = useParams();
  const currentLocale = (params?.locale as string) ?? "fr";
  const emittedAt = issuedAt ?? new Date();

  const hairline = "1px dashed var(--ink)";

  return (
    <aside
      data-testid="print-ticket"
      aria-hidden="true"
      className="sigfa-print-ticket"
    >
      <style dangerouslySetInnerHTML={{ __html: PRINT_STYLES }} />

      {/* En-tête : banque (brand, texte) + agence à gauche, date/heure à droite. */}
      <header
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: "3mm",
          paddingBottom: "2.5mm",
          borderBottom: hairline,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div
            data-testid="print-bank"
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: 700,
              fontSize: "13pt",
              letterSpacing: "0.04em",
              textTransform: "uppercase",
            }}
          >
            {bankName}
          </div>
          <div data-testid="print-agency" style={{ fontSize: "9pt" }}>
            {agencyName}
          </div>
        </div>
        <div style={{ textAlign: "right", whiteSpace: "nowrap", fontSize: "9pt" }}>
          <div data-testid="print-date">{formatBannerDate(emittedAt, currentLocale)}</div>
          <div data-testid="print-time" style={{ fontVariantNumeric: "tabular-nums" }}>
            {formatBannerTime(emittedAt, currentLocale)}
          </div>
        </div>
      </header>

      {/* Bienvenue + numéro de passage. */}
      <p
        data-testid="print-welcome"
        style={{ textAlign: "center", margin: "3mm 0 1mm", fontSize: "10pt" }}
      >
        {t("welcome", { agency: agencyName })}
      </p>
      <p style={{ textAlign: "center", margin: "0 0 2mm", fontSize: "10pt" }}>
        {t("yourNumber")}
      </p>

      {/* Libellé de l'opération choisie (UTF-8 parfait, jamais « esp¿ces »). */}
      {serviceLabel && (
        <p
          data-testid="print-service-label"
          style={{
            textAlign: "center",
            margin: "0 0 2mm",
            fontSize: "12pt",
            fontWeight: 700,
          }}
        >
          {serviceLabel}
        </p>
      )}

      {/* Le numéro — très gros, encadré sobre. */}
      <div
        data-testid="print-number"
        style={{
          border: "2px solid var(--ink)",
          borderRadius: "2mm",
          textAlign: "center",
          padding: "2.5mm 0",
          margin: "0 4mm 3mm",
          fontFamily: "var(--font-display)",
          fontSize: "34pt",
          fontWeight: 700,
          letterSpacing: "0.06em",
          fontVariantNumeric: "tabular-nums",
          lineHeight: 1.1,
        }}
      >
        {displayNumber}
      </div>

      {/* Personnes avant vous / attente estimée — formats humains. */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "1mm",
          padding: "2mm 0",
          borderTop: hairline,
          borderBottom: hairline,
          fontSize: "10pt",
        }}
      >
        <span data-testid="print-people-ahead">{t("peopleAhead", { count: position })}</span>
        <span data-testid="print-wait">
          {t("estimatedWait", { minutes: estimatedWaitMinutes })}
        </span>
        {trackingId && (
          <span
            data-testid="print-tracking"
            style={{ fontVariantNumeric: "tabular-nums", letterSpacing: "0.08em" }}
          >
            {t("trackingLabel", { code: shortTrackingCode(trackingId) })}
          </span>
        )}
      </div>

      {/* Mention SMS (consentement donné uniquement) + courtoisie. */}
      {smsConsent && (
        <p data-testid="print-sms" style={{ textAlign: "center", margin: "2.5mm 0 0", fontSize: "9pt" }}>
          {t("smsNotice")}
        </p>
      )}
      <p
        data-testid="print-courtesy"
        style={{ textAlign: "center", margin: "2.5mm 2mm 0", fontSize: "9.5pt" }}
      >
        {t("courtesy")}
      </p>
    </aside>
  );
}
