/**
 * KIOSK-004 — ConfirmationScreen.tsx
 * Saisie du numéro de téléphone + émission de ticket — refonte v2.
 * Clavier numérique natif (pas de clavier OS) sur --night, cibles ≥ 72px.
 * Tokens @sigfa/ui uniquement, aucune valeur hex en dur.
 *
 * AUDIT-BORNE 2026-07-14 (F2/F3/F13/F15/F17/F23 + piste A) — recomposition
 * « au-dessus du pli » :
 * - F2 : main verrouillé à 100dvh (zéro scroll — une borne ne scrolle pas),
 *   deux colonnes paysage (décision à gauche, pavé à droite), rangées du pavé
 *   en minmax(72px, 1fr) → tout le contenu décisionnel tient à 1920×1080 ET
 *   1024×768, y compris « Passer » (chemin majoritaire) et l'erreur système.
 * - F3 : bouton Retour commun (IconRetour + texte, ≥ 72px) → router.back().
 * - F13 (partiel) : bascule honnête « Texte plus grand » (icône appariée,
 *   aria-pressed, fond --gold + badge « Activé »), le texte grandit vraiment
 *   et le timeout d'inactivité est doublé (30 s → 60 s).
 * - F15 : la VALEUR du SMS est annoncée AVANT le clavier (sous-titre
 *   permanent) et le consentement est visible dès le départ (désactivé tant
 *   que le numéro est vide).
 * - F17 : le champ hérite la police kiosque (fin du monospace navigateur).
 * - F23 : touche « * » morte retirée — 11 touches utiles, « 0 » élargi.
 * - Piste A : erreur téléphone en --danger-inv (≥ 7:1 sur --night).
 */
"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter, useParams } from "next/navigation";
import { createSigfaClient } from "@sigfa/contracts";
import { IconAlerte, IconRetour } from "@sigfa/ui";
import { AccessibilityIcon } from "@/components/icons/UiIcons";
import { useInactivityTimeout } from "@/hooks/useInactivityTimeout";
import { useAccessibilityMode } from "@/hooks/useAccessibilityMode";
import { accessibilityTimeoutMs } from "@/lib/kiosk-voice";
import { useOfflineTicket } from "@/hooks/useOfflineTicket";
import { OfflineBanner } from "@/components/OfflineBanner";
import { storeTicketMomentPii, purgeTicketMomentPii } from "@/lib/ticket-moment-store";
import {
  signalKioskSystemError,
  noopDegradedSink,
  type DegradedEventSink,
} from "@/lib/kiosk-degraded-emitter";

interface ConfirmationScreenProps {
  serviceId: string;
  /**
   * MODEL-KIOSK-A : opération choisie (parcours 2 niveaux, additif). Envoyée
   * au serveur avec le ticket ; `serviceId` reste transmis (rétrocompat +
   * dérivation serveur). Absente pour un parcours 1 niveau (service direct).
   */
  operationId?: string;
  /**
   * KIOSK-BORNE : libellé PUBLIC (non-PII) de l'opération/du service choisi.
   * Porté jusqu'au Moment Ticket (`serviceLabel`) pour figurer sur le ticket
   * IMPRIMÉ. Jamais de PII : c'est un libellé d'enseigne.
   */
  operationLabel?: string;
  /**
   * MODEL-KIOSK-B : conseiller ciblé (parcours « voir mon conseiller », additif).
   * Envoyé au serveur avec le ticket → il rejoint la file personnelle du
   * conseiller (MODEL-API-B/D6). `serviceId` reste requis par le contrat.
   */
  targetManagerId?: string;
  /**
   * MODEL-KIOSK-B (finition) : nom d'affichage du conseiller ciblé (donnée
   * publique, non-PII). Sert UNIQUEMENT à rappeler à l'usager QUI il va voir
   * (réassurance). Présent sur le chemin conseiller, absent sur le chemin
   * opération (qui reste inchangé).
   */
  managerName?: string;
  agencyId: string;
  /**
   * KIOSK-007 : sink d'événement simulé (F4) pour `alert:manager
   * KIOSK_SYSTEM_ERROR`. Défaut : no-op — l'émission RÉELLE appartient au
   * serveur. Injecté par les tests pour vérifier l'intention d'émission.
   */
  systemErrorSink?: DegradedEventSink;
}

/** KIOSK-007 : nombre total de tentatives POST /public/tickets avant erreur système. */
const MAX_TICKET_ATTEMPTS = 2;

// Validate CI phone number: 10 digits starting with 0
const CI_PHONE_REGEX = /^0[0-9]{9}$/;

// AUDIT-F23 : la touche « * » (morte, source de confusion) est retirée —
// 11 touches utiles, le « 0 » s'élargit sur 2 colonnes (grille 3×4 sans trou).
const KEYPAD_ROWS = [
  ["1", "2", "3"],
  ["4", "5", "6"],
  ["7", "8", "9"],
  ["0", "⌫"],
];

export function ConfirmationScreen({
  serviceId,
  operationId,
  operationLabel,
  targetManagerId,
  managerName,
  agencyId,
  systemErrorSink = noopDegradedSink,
}: ConfirmationScreenProps) {
  const t = useTranslations("confirmation004");
  const tDeg = useTranslations("degraded007");
  const router = useRouter();
  const params = useParams();
  const currentLocale = (params?.locale as string) ?? "fr";
  const { createOfflineTicket, syncPendingTickets } = useOfflineTicket();
  // AUDIT-F13 : bascule « Texte plus grand » (état persistant de session,
  // même comportement que services/opérations/conseillers).
  const { isAccessibilityMode, toggleAccessibilityMode } = useAccessibilityMode();

  const [phoneDigits, setPhoneDigits] = useState("");
  const [smsConsent, setSmsConsent] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [phoneError, setPhoneError] = useState("");
  const [isOffline, setIsOffline] = useState(false);
  // KIOSK-007 : erreur système (500 ×2) → message humain, pas de bascule offline.
  const [isSystemError, setIsSystemError] = useState(false);

  // AUDIT-F13 : timeout doublé en mode accessibilité (30 s → 60 s).
  useInactivityTimeout(() => {
    router.push(`/${currentLocale}`);
  }, accessibilityTimeoutMs(30000, isAccessibilityMode));

  // AUDIT-F13 : « Texte plus grand » est un libellé HONNÊTE — les corps de
  // texte passent réellement de 24 px à 30 px (actions 28 px → 34 px).
  const bodyFontPx = isAccessibilityMode ? "30px" : "24px";
  const actionFontPx = isAccessibilityMode ? "34px" : "28px";
  const titleFontPx = isAccessibilityMode ? "31px" : "25px";

  // KIOSK-006 : au retour réseau, déclenche automatiquement la synchronisation
  // des tickets offline en attente (POST /tickets/sync via @sigfa/contracts).
  // Le bandeau offline disparaît alors en fondu (250 ms) via <OfflineBanner>.
  useEffect(() => {
    const handleOnline = () => {
      setIsOffline(false);
      void syncPendingTickets();
    };
    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, [syncPendingTickets]);

  const handleKey = (key: string) => {
    if (key === "⌫") {
      setPhoneDigits((prev) => prev.slice(0, -1));
      setPhoneError("");
    } else if (phoneDigits.length < 10) {
      setPhoneDigits((prev) => prev + key);
      setPhoneError("");
    }
  };

  /**
   * S6 : l'URL /ticket ne transporte plus AUCUNE PII (borne PARTAGÉE, UEMOA).
   * Le téléphone + le consentement transitent par le store mémoire
   * (`ticket-moment-store`, purge après affichage/timeout) ; l'URL ne porte
   * que les données publiques du Moment Ticket.
   */
  const buildTicketUrl = (
    data: {
      trackingId: string;
      displayNumber: string;
      position: number;
      estimatedWaitMinutes: number;
    },
    pii: { phoneNumber?: string; smsConsent?: boolean }
  ) => {
    if (pii.phoneNumber) {
      storeTicketMomentPii({
        phoneNumber: pii.phoneNumber,
        smsConsent: pii.smsConsent ?? false,
      });
    } else {
      // Aucun téléphone transmis (skip) : aucune PII résiduelle en mémoire.
      purgeTicketMomentPii();
    }
    const params = new URLSearchParams({
      trackingId: data.trackingId,
      displayNumber: data.displayNumber,
      position: String(data.position),
      estimatedWaitMinutes: String(data.estimatedWaitMinutes),
    });
    // MODEL-KIOSK-B (finition) : nom conseiller (public, non-PII) porté jusqu'au
    // Moment Ticket pour rappeler QUI le client va voir. Chemin conseiller seul.
    if (targetManagerId && managerName) {
      params.set("managerName", managerName);
    }
    // KIOSK-BORNE : libellé public de l'opération → ticket imprimé (non-PII).
    if (operationLabel) {
      params.set("serviceLabel", operationLabel);
    }
    return `/${currentLocale}/ticket?${params.toString()}`;
  };

  const handleSubmit = async (skipPhone: boolean) => {
    // Validate phone if not skipping
    if (!skipPhone && phoneDigits.length > 0) {
      if (!CI_PHONE_REGEX.test(phoneDigits)) {
        setPhoneError(t("errorPhone"));
        return;
      }
    }

    setIsLoading(true);
    setPhoneError("");
    setIsSystemError(false);

    const finalPhone = skipPhone ? undefined : (phoneDigits || undefined);
    const finalConsent = finalPhone ? smsConsent : undefined;

    const client = createSigfaClient(
      "public",
      // RT-001b : défaut mock canonique unifié web/kiosk (mock Prism :4010).
      process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4010"
    );

    let lastStatus = 0;
    try {
      // KIOSK-007 : jusqu'à MAX_TICKET_ATTEMPTS tentatives. Un 5xx est réessayé ;
      // un 201 navigue ; un échec réseau (exception) bascule en offline.
      for (let attempt = 1; attempt <= MAX_TICKET_ATTEMPTS; attempt += 1) {
        const { data, response } = await client.POST("/public/tickets", {
          params: {
            header: {
              "X-Idempotency-Key": crypto.randomUUID(),
            },
          },
          body: {
            serviceId,
            // MODEL-KIOSK-A : operationId additif si présent (le serveur dérive
            // serviceId = operation.serviceId). serviceId reste envoyé (rétrocompat).
            ...(operationId ? { operationId } : {}),
            // MODEL-KIOSK-B : targetManagerId additif → file conseiller (D6).
            ...(targetManagerId ? { targetManagerId } : {}),
            channel: "KIOSK",
            phoneNumber: finalPhone,
            smsConsent: finalConsent,
            agencyId,
          },
        });
        lastStatus = response.status;

        if (response.status === 201 && data) {
          router.push(buildTicketUrl(
            {
              trackingId: data.trackingId,
              displayNumber: data.displayNumber ?? data.number,
              position: data.position,
              estimatedWaitMinutes: data.estimatedWaitMinutes,
            },
            { phoneNumber: finalPhone, smsConsent: finalConsent }
          ));
          return;
        }

        // 5xx : on réessaie tant qu'il reste des tentatives.
        if (response.status >= 500 && attempt < MAX_TICKET_ATTEMPTS) {
          continue;
        }
        break;
      }

      // KIOSK-007 : 5xx après épuisement des tentatives → erreur système.
      // Message humain + alerte silencieuse KIOSK_SYSTEM_ERROR (jamais offline).
      if (lastStatus >= 500) {
        setIsSystemError(true);
        signalKioskSystemError(
          { serviceId, agencyId, status: lastStatus },
          systemErrorSink
        );
        return;
      }

      // Autres non-201 (4xx…) : repli offline pour ne pas bloquer l'usager.
      setIsOffline(true);
      const offlineTicket = await createOfflineTicket({ serviceId, ...(operationId ? { operationId } : {}), ...(targetManagerId ? { targetManagerId } : {}), agencyId });
      router.push(buildTicketUrl(
        {
          trackingId: offlineTicket.trackingId,
          displayNumber: offlineTicket.displayNumber,
          position: offlineTicket.position,
          estimatedWaitMinutes: offlineTicket.estimatedWaitMinutes,
        },
        { phoneNumber: finalPhone, smsConsent: finalConsent }
      ));
      return;
    } catch {
      // Network error: use offline fallback
      setIsOffline(true);
      const offlineTicket = await createOfflineTicket({ serviceId, ...(operationId ? { operationId } : {}), ...(targetManagerId ? { targetManagerId } : {}), agencyId });
      router.push(buildTicketUrl(
        {
          trackingId: offlineTicket.trackingId,
          displayNumber: offlineTicket.displayNumber,
          position: offlineTicket.position,
          estimatedWaitMinutes: offlineTicket.estimatedWaitMinutes,
        },
        { phoneNumber: finalPhone, smsConsent: finalConsent }
      ));
      return;
    } finally {
      setIsLoading(false);
    }
  };

  // AUDIT-F15 : le consentement est visible dès le départ — la case ne devient
  // activable qu'une fois un numéro commencé (jamais de consentement à vide).
  const smsConsentDisabled = phoneDigits.length === 0;

  return (
    <main
      role="main"
      style={{
        backgroundColor: "var(--surface-kiosk)",
        // AUDIT-F2 : hauteur verrouillée à l'écran — une borne ne scrolle pas.
        // border-box : le padding vit DANS les 100dvh/100% (sinon 1088×800 à
        // 1024×768, pavé et « Passer » coupés — bug constaté à la capture).
        boxSizing: "border-box",
        height: "100dvh",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        padding: "var(--space-4) var(--space-8)",
        gap: "var(--space-4)",
        width: "100%",
      }}
    >
      {/* KIOSK-006 : bandeau offline discret (--info, non bloquant), fondu 250 ms au retour réseau */}
      <OfflineBanner isOffline={isOffline} />

      {/* AUDIT-F3/F13 — En-tête : Retour (patron commun des écrans) à gauche,
          bascule « Texte plus grand » à droite. Cibles ≥ 72 px. */}
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-4)",
          width: "100%",
          maxWidth: "1240px",
          marginInline: "auto",
        }}
      >
        <button
          data-testid="confirmation-back-btn"
          onClick={() => router.back()}
          style={{
            fontSize: bodyFontPx,
            color: "var(--ink-inverse)",
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: "var(--space-2)",
            minWidth: "72px",
            minHeight: "72px",
            display: "flex",
            alignItems: "center",
            gap: "var(--space-2)",
          }}
        >
          <IconRetour size={28} style={{ verticalAlign: "middle" }} />
          {t("backButton")}
        </button>

        {/* AUDIT-F13 — bascule honnête : libellé « Texte plus grand » (pas de
            fausse « priorité »), état pressé NON ambigu (fond --gold ≥ 7:1 sur
            --night + badge « Activé ») et aria-pressed pour les lecteurs. */}
        <button
          data-testid="accessibility-toggle"
          aria-pressed={isAccessibilityMode}
          onClick={toggleAccessibilityMode}
          style={{
            marginLeft: "auto",
            fontSize: bodyFontPx,
            fontWeight: isAccessibilityMode ? 600 : 400,
            color: isAccessibilityMode ? "var(--night)" : "var(--ink-inverse)",
            backgroundColor: isAccessibilityMode ? "var(--gold)" : "transparent",
            border: isAccessibilityMode
              ? "2px solid var(--gold)"
              : "2px solid var(--ink-inverse-soft)",
            borderRadius: "var(--r-md)",
            cursor: "pointer",
            padding: "var(--space-2) var(--space-4)",
            minHeight: "72px",
            display: "flex",
            alignItems: "center",
            gap: "var(--space-2)",
          }}
        >
          <AccessibilityIcon size={28} />
          {t("largerTextButton")}
          {isAccessibilityMode && (
            <span
              data-testid="accessibility-toggle-state"
              style={{
                backgroundColor: "var(--night)",
                color: "var(--gold)",
                borderRadius: "var(--r-full)",
                padding: "var(--space-1) var(--space-3)",
                fontSize: bodyFontPx,
                fontWeight: 700,
              }}
            >
              {t("largerTextOn")}
            </span>
          )}
        </button>
      </header>

      {/* AUDIT-F2 — Deux colonnes paysage : la DÉCISION à gauche (titre, valeur
          SMS, champ, messages, actions), le pavé à droite. Tout tient au-dessus
          du pli à 1024×768 comme à 1920×1080 ; le bloc se centre en écran haut. */}
      <div
        style={{
          flex: "1 1 0%",
          minHeight: 0,
          maxHeight: "660px",
          marginBlock: "auto",
          display: "flex",
          gap: "var(--space-8)",
          width: "100%",
          maxWidth: "1240px",
          marginInline: "auto",
          alignItems: "stretch",
        }}
      >
        {/* Colonne décision */}
        <section
          style={{
            flex: "1 1 0%",
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-4)",
          }}
        >
          {/* Title */}
          <h1
            style={{
              fontFamily: "var(--font-display)",
              fontSize: titleFontPx,
              lineHeight: 1.15,
              color: "var(--ink-inverse)",
              fontWeight: 600,
              margin: 0,
            }}
          >
            {t("title")}
          </h1>

          {/* AUDIT-F15 — Le POURQUOI du SMS, AVANT le clavier : sous-titre
              permanent (≥ 24 px, encre inverse ≥ 7:1 sur --night). */}
          <p
            data-testid="sms-value"
            style={{
              fontSize: bodyFontPx,
              lineHeight: 1.55,
              color: "var(--ink-inverse)",
              margin: 0,
            }}
          >
            {t("smsValue")}
          </p>

          {/* MODEL-KIOSK-B (finition) — Rappel discret du conseiller choisi
              (réassurance). Chemin conseiller UNIQUEMENT (targetManagerId + nom) ;
              le chemin opération reste inchangé. Tokens uniquement, zéro emoji. */}
          {targetManagerId && managerName && (
            <p
              data-testid="manager-reminder"
              style={{
                fontSize: bodyFontPx,
                color: "var(--ink-muted-inv)",
                margin: 0,
              }}
            >
              {t("managerReminder", { name: managerName })}
            </p>
          )}

          {/* KIOSK-007 — Erreur système (500 ×2). Message humain, registre SIGFA.
              Token --danger sur le PICTOGRAMME UNIQUEMENT, jamais le fond.
              AUDIT-F2 : la carte vit DANS la colonne décision — jamais tronquée. */}
          {isSystemError && (
            <section
              data-testid="system-error"
              role="alert"
              style={{
                backgroundColor: "var(--surface-1)",
                borderRadius: "var(--r-lg)",
                boxShadow: "var(--shadow-2)",
                padding: "var(--space-4)",
                display: "flex",
                alignItems: "center",
                gap: "var(--space-4)",
              }}
            >
              <span
                data-testid="system-error-pictogram"
                aria-hidden="true"
                style={{ color: "var(--danger)", lineHeight: 1, flexShrink: 0 }}
              >
                <IconAlerte size={32} />
              </span>
              <span style={{ fontSize: bodyFontPx, color: "var(--ink-strong)" }}>
                {tDeg("systemError")}
              </span>
            </section>
          )}

          {/* Phone display */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--space-2)",
              backgroundColor: "var(--surface-1)",
              borderRadius: "var(--r-md)",
              boxShadow: "var(--shadow-1)",
              padding: "var(--space-3) var(--space-4)",
            }}
          >
            <span style={{ fontSize: bodyFontPx, color: "var(--ink-soft)" }}>
              {t("phonePrefix")}
            </span>
            <input
              data-testid="phone-input"
              type="text"
              readOnly
              value={phoneDigits}
              placeholder={t("phonePlaceholder")}
              style={{
                flex: 1,
                minWidth: 0,
                fontSize: bodyFontPx,
                // AUDIT-F17 : hérite la police kiosque (fin du monospace).
                fontFamily: "inherit",
                color: "var(--ink-strong)",
                background: "none",
                border: "none",
                outline: "none",
              }}
            />
          </div>

          {/* Phone error — inline sous le champ. AUDIT piste A : --danger-inv
              (≥ 7:1 sur --night), le pictogramme hérite la même encre. */}
          {phoneError && (
            <div
              data-testid="phone-error"
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--space-2)",
                color: "var(--danger-inv)",
                fontSize: bodyFontPx,
              }}
            >
              <span aria-hidden="true" style={{ lineHeight: 1, flexShrink: 0 }}>
                <IconAlerte size={28} />
              </span>
              {phoneError}
            </div>
          )}

          {/* SMS Consent — AUDIT-F15 : visible dès le départ, activable dès le
              premier chiffre (consentement AVANT l'engagement, jamais à vide). */}
          <label
            data-testid="sms-consent"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--space-3)",
              fontSize: bodyFontPx,
              color: smsConsentDisabled
                ? "var(--ink-muted-inv)"
                : "var(--ink-inverse)",
              cursor: smsConsentDisabled ? "default" : "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={smsConsent}
              disabled={smsConsentDisabled}
              onChange={(e) => setSmsConsent(e.target.checked)}
              style={{
                width: "28px",
                height: "28px",
                flexShrink: 0,
                accentColor: "var(--brand)",
              }}
            />
            {t("smsConsent")}
          </label>

          {/* AUDIT-F2 — LE choix de l'écran, toujours visible : CTA + Passer
              (chemin majoritaire) ancrés en bas de la colonne décision. */}
          <div
            data-testid="decision-actions"
            style={{
              marginTop: "auto",
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-3)",
            }}
          >
            {/* CTA Button */}
            <button
              data-testid="cta-btn"
              onClick={() => { void handleSubmit(false); }}
              disabled={isLoading}
              style={{
                minHeight: "88px",
                backgroundColor: "var(--brand)",
                color: "var(--brand-contrast)",
                fontSize: actionFontPx,
                fontWeight: 600,
                border: "none",
                boxShadow: "var(--shadow-brand)",
                borderRadius: "var(--r-lg)",
                cursor: isLoading ? "not-allowed" : "pointer",
              }}
            >
              {isLoading ? t("loadingMessage") : t("ctaButton")}
            </button>

            {/* Skip Button */}
            <button
              data-testid="skip-btn"
              onClick={() => { void handleSubmit(true); }}
              disabled={isLoading}
              style={{
                minHeight: "72px",
                backgroundColor: "transparent",
                color: "var(--ink-inverse)",
                fontSize: actionFontPx,
                border: "2px solid var(--ink-inverse)",
                borderRadius: "var(--r-lg)",
                cursor: isLoading ? "not-allowed" : "pointer",
              }}
            >
              {t("skipButton")}
            </button>
          </div>
        </section>

        {/* Numeric Keypad — AUDIT-F2 : rangées minmax(72px, 1fr), le pavé
            s'adapte à la hauteur restante sans jamais pousser le contenu
            décisionnel sous le pli. AUDIT-F23 : 11 touches, « 0 » élargi. */}
        <div
          data-testid="keypad"
          style={{
            flex: "1 1 0%",
            minWidth: 0,
            minHeight: "0px",
            maxWidth: "560px",
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gridTemplateRows: "repeat(4, minmax(72px, 1fr))",
            gap: "var(--space-3)",
          }}
        >
          {KEYPAD_ROWS.flat().map((key, idx) => (
            <button
              key={idx}
              data-testid="keypad-key"
              onClick={() => handleKey(key)}
              disabled={isLoading}
              style={{
                minWidth: "72px",
                minHeight: "72px",
                fontSize: actionFontPx,
                fontWeight: 600,
                color: "var(--ink-strong)",
                backgroundColor: "var(--surface-1)",
                border: "1px solid var(--hairline)",
                boxShadow: "var(--shadow-1)",
                borderRadius: "var(--r-md)",
                cursor: isLoading ? "not-allowed" : "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                // AUDIT-F23 : « 0 » élargi sur 2 colonnes (grille sans trou).
                ...(key === "0" ? { gridColumn: "span 2" } : {}),
              }}
            >
              {key}
            </button>
          ))}
        </div>
      </div>
    </main>
  );
}
