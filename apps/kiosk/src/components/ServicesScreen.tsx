/**
 * KIOSK-BORNE — ServicesScreen.tsx
 * Écran UNIQUE « Prise de ticket » groupé par familles (modèle borne bancaire
 * réelle, qualité v2 « Sérénité Premium ») :
 *   - bandeau d'en-tête persistant en HAUT (banque + agence + date/heure vivante) ;
 *   - une SECTION par service (famille) : en-tête de famille + grille de tuiles
 *     de ses opérations (3 colonnes à 1024×768, tuiles ≥ 96px, icône SVG dans
 *     une pastille `--brand-soft`, libellé ≥ 20px) ;
 *   - opérations de TOUTES les familles chargées en parallèle (Promise.all)
 *     via le client typé @sigfa/contracts ;
 *   - clic tuile → navigation DIRECTE vers la confirmation (l'écran opérations
 *     reste en place pour compat, mais n'est plus le chemin nominal) ;
 *   - service sans opération → tuile unique pour le service lui-même ;
 *   - service fermé → tuile grisée avec horaire, non cliquable ;
 *   - conservés : bannière forte affluence (KIOSK-007), bouton accessibilité
 *     (texte ×1.2 / timeout ×2), OfflineBanner, états loading/empty/error,
 *     i18n FR/EN, tokens var(--*) uniquement.
 *
 * Audit UX borne 2026-07-14 — réconcilié sur le modèle familles :
 * - F7 : les sections vivent dans une région scrollable DÉDIÉE avec affordance
 *   de continuation (dégradé de bord + chevron animé + texte) tant qu'il reste
 *   du contenu sous le pli — elle disparaît en fin de scroll. Le bouton
 *   accessibilité vit HORS de la région : toujours visible pendant le scroll.
 * - F20 : l'état loading (prop `isLoading` ou chargement parallèle des
 *   familles) est un skeleton de tuiles animé (`SelectionSkeletonGrid`),
 *   plus jamais une icône statique figée.
 */
"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter, useParams } from "next/navigation";
import { createSigfaClient } from "@sigfa/contracts";
import { EmptyState, IconRetour } from "@sigfa/ui";
import { useInactivityTimeout } from "@/hooks/useInactivityTimeout";
import { useAccessibilityMode } from "@/hooks/useAccessibilityMode";
import { useScrollAffordance } from "@/hooks/useScrollAffordance";
import { DEFAULT_LONG_QUEUE_THRESHOLD_MIN } from "@/hooks/useDegradedState";
import { kioskAgencyName, kioskBankName } from "@/lib/kiosk-branding";
import { purgeTicketOperationLabel } from "@/lib/ticket-operation-store";
import { ServiceIcon } from "@/components/icons/ServiceIcon";
import {
  AccessibilityIcon,
  ChevronIcon,
  PersonIcon,
  PhoneIcon,
} from "@/components/icons/UiIcons";
import { KioskHeaderBanner } from "@/components/KioskHeaderBanner";
import { OfflineBanner } from "@/components/OfflineBanner";
import { SelectionSkeletonGrid } from "@/components/SelectionSkeletonGrid";
import type { OperationItem } from "@/components/OperationsScreen";

/**
 * AUDIT-F7 — mouvement du chevron d'affordance : oscillation douce (« viens
 * voir en bas »), désactivée sous `prefers-reduced-motion` (même patron que
 * TICKET_LAYOUT_CSS de TicketScreen — tokens de mouvement DS uniquement).
 */
const SCROLL_HINT_CSS = `
@keyframes kiosk-scroll-hint-bob {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(8px); }
}
.kiosk-scroll-hint__chevron {
  display: inline-flex;
  animation: kiosk-scroll-hint-bob 1.6s var(--ease) infinite;
}
@media (prefers-reduced-motion: reduce) {
  .kiosk-scroll-hint__chevron { animation: none; }
}
`;

export interface ServiceItem {
  id: string;
  name: string;
  /** Code optionnel — sert au mapping d'icône par mot-clé (sinon `name`). */
  code?: string;
  /** @deprecated emoji retiré en v2 ; conservé pour compat de données. */
  icon?: string;
  estimatedMinutes: number;
  isOpen: boolean;
  schedule?: string;
}

/** Une famille de l'écran : le service + ses opérations chargées. */
interface FamilySection {
  service: ServiceItem;
  operations: OperationItem[];
}

interface ServicesScreenProps {
  services: ServiceItem[];
  agencyId: string;
  /** KIOSK-007 : seuil « file longue » en minutes (configurable). */
  longQueueThresholdMinutes?: number;
  /** Nom public de l'agence (bandeau + repli env). */
  agencyName?: string;
  /** Nom public de la banque (bandeau + repli env). */
  bankName?: string;
  /** AUDIT-F20 : vrai pendant le chargement du catalogue → skeleton de tuiles. */
  isLoading?: boolean;
}

type LoadState = "loading" | "ready" | "error";

/** Base URL de l'API — mock Prism canonique par défaut (RT-001b). */
function apiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4010";
}

export function ServicesScreen({
  services,
  agencyId,
  longQueueThresholdMinutes = DEFAULT_LONG_QUEUE_THRESHOLD_MIN,
  agencyName = kioskAgencyName(),
  bankName = kioskBankName(),
  isLoading = false,
}: ServicesScreenProps) {
  const t = useTranslations("services003");
  const tDeg = useTranslations("degraded007");
  const router = useRouter();
  const params = useParams();
  const currentLocale = (params?.locale as string) ?? "fr";
  const { isAccessibilityMode, toggleAccessibilityMode } = useAccessibilityMode();

  const [sections, setSections] = useState<FamilySection[]>([]);
  const [state, setState] = useState<LoadState>("loading");
  const [isOffline, setIsOffline] = useState(false);

  // AUDIT-F7 : affordance de continuation sur la région scrollable.
  const { scrollRef, canScrollDown, onScroll, recompute } =
    useScrollAffordance<HTMLDivElement>();

  // Re-mesure quand le contenu change (catalogue, familles chargées, loading).
  useEffect(() => {
    recompute();
  }, [recompute, services, sections, state, isLoading]);

  // Accessibilité : texte ×1.2 + délai d'inactivité ×2.
  const timeoutMs = isAccessibilityMode ? 60000 : 30000;
  const labelPx = isAccessibilityMode ? 26 : 22;
  const familyTitlePx = isAccessibilityMode ? 29 : 24;

  useInactivityTimeout(() => {
    router.push(`/${currentLocale}`);
  }, timeoutMs);

  // Chargement PARALLÈLE des opérations de toutes les familles (une requête
  // par service ouvert, Promise.all). Un échec réseau isolé dégrade la famille
  // en tuile-service ; TOUS les services ouverts en échec réseau → état error.
  const loadFamilies = useCallback(async () => {
    if (services.length === 0) return;
    setState("loading");
    setIsOffline(false);
    const client = createSigfaClient("public", apiBaseUrl());
    const openCount = services.filter((s) => s.isOpen).length;
    let networkFailures = 0;

    const loaded = await Promise.all(
      services.map(async (service): Promise<FamilySection> => {
        if (!service.isOpen) return { service, operations: [] };
        try {
          const { data, response } = await client.GET(
            "/public/agencies/{agencyId}/operations",
            { params: { path: { agencyId }, query: { serviceId: service.id } } }
          );
          if (response.status !== 200 || !data) {
            // Réponse dégradée : la famille retombe sur sa tuile-service.
            return { service, operations: [] };
          }
          return { service, operations: (data.data ?? []) as OperationItem[] };
        } catch {
          networkFailures += 1;
          return { service, operations: [] };
        }
      })
    );

    if (openCount > 0 && networkFailures === openCount) {
      setIsOffline(true);
      setState("error");
      return;
    }
    setSections(loaded);
    setState("ready");
  }, [services, agencyId]);

  useEffect(() => {
    void loadFamilies();
  }, [loadFamilies]);

  /** Navigation directe tuile → confirmation. Libellé public (non-PII) porté
   *  jusqu'au ticket imprimé via `operationLabel`. */
  const goToConfirmation = useCallback(
    (serviceId: string, label: string, operationId?: string) => {
      const query = new URLSearchParams({ serviceId, agencyId });
      if (operationId) query.set("operationId", operationId);
      query.set("operationLabel", label);
      router.push(`/${currentLocale}/confirmation?${query.toString()}`);
    },
    [router, currentLocale, agencyId]
  );

  // KIOSK-007 : file longue si l'attente d'un service ouvert dépasse le seuil.
  // On affiche proactivement un message d'affluence + met en avant le SMS.
  // Audit F5 : on retient le SERVICE ouvert le plus chargé (pas seulement son
  // attente) — le CTA de la bannière doit porter son serviceId, sinon la
  // confirmation POST un ticket invalide et replie sur un ticket local « 0 min ».
  const longestOpenService = services
    .filter((s) => s.isOpen)
    .reduce<ServiceItem | null>(
      (max, s) => (max === null || s.estimatedMinutes > max.estimatedMinutes ? s : max),
      null
    );
  const longestOpenWait = longestOpenService?.estimatedMinutes ?? 0;
  const isLongQueue = longestOpenWait >= longQueueThresholdMinutes;

  // AUDIT-F7 : viewport fixe — le scroll vit dans une région DÉDIÉE, pas sur
  // le shell (le bouton accessibilité reste visible pendant tout le scroll).
  const shellStyle = {
    backgroundColor: "var(--surface-kiosk)",
    height: "100vh",
    boxSizing: "border-box" as const,
    overflow: "hidden",
    display: "flex",
    flexDirection: "column" as const,
    padding: "var(--space-6) var(--space-8) var(--space-8)",
    gap: "var(--space-6)",
  };

  const headerAndTitle = (
    <>
      <KioskHeaderBanner agencyName={agencyName} bankName={bankName} />
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: "var(--space-4)",
          width: "100%",
          maxWidth: "960px",
          margin: "0 auto",
          flexShrink: 0,
        }}
      >
        <button
          data-testid="back-btn"
          onClick={() => router.back()}
          style={{
            fontSize: "20px",
            color: "var(--ink-muted-inv)",
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: "var(--space-2)",
            minWidth: "72px",
            minHeight: "72px",
          }}
        >
          <IconRetour
            size={24}
            style={{ verticalAlign: "middle", marginRight: "var(--space-2)" }}
          />
          {t("backButton")}
        </button>
        <div style={{ flex: 1, textAlign: "center" }}>
          <h1
            style={{
              fontFamily: "var(--font-display)",
              fontSize: "var(--text-2xl)",
              fontWeight: 700,
              letterSpacing: "var(--tracking-tight)",
              color: "var(--ink-inverse)",
              margin: 0,
            }}
          >
            {t("title")}
          </h1>
          <p
            style={{
              fontSize: "20px",
              color: "var(--ink-muted-inv)",
              margin: "var(--space-1) 0 0",
            }}
          >
            {t("subtitle")}
          </p>
        </div>
        {/* Contrepoids du bouton retour — garde le titre optiquement centré. */}
        <span aria-hidden="true" style={{ minWidth: "72px" }} />
      </div>
    </>
  );

  /* AUDIT-F7 : le bouton accessibilité vit HORS de la région scrollable —
     épinglé en bas de l'écran, il reste visible pendant tout le scroll. */
  const accessibilityButton = (
    <button
      data-testid="accessibility-btn"
      onClick={toggleAccessibilityMode}
      style={{
        fontSize: isAccessibilityMode ? "28px" : "24px",
        color: "var(--ink-muted-inv)",
        background: "none",
        border: "none",
        cursor: "pointer",
        padding: "var(--space-2)",
        minHeight: "72px",
        alignSelf: "center",
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        gap: "var(--space-3)",
      }}
    >
      <AccessibilityIcon size={isAccessibilityMode ? 32 : 28} />
      {t("accessibilityButton")}
    </button>
  );

  // ── LOADING (AUDIT-F20) — skeleton de tuiles animé ────────────────────────
  // `isLoading` (catalogue externe) PRIME sur l'état vide ; le chargement
  // parallèle des familles réutilise le même skeleton (jamais d'écran figé).
  if (isLoading || (services.length > 0 && state === "loading")) {
    return (
      <main role="main" style={shellStyle}>
        {headerAndTitle}
        <SelectionSkeletonGrid
          data-testid="services-loading"
          label={t("loadingMessage")}
        />
        {accessibilityButton}
      </main>
    );
  }

  // ── EMPTY (aucun service) ─────────────────────────────────────────────────
  if (services.length === 0) {
    return (
      <main role="main" style={shellStyle}>
        <KioskHeaderBanner agencyName={agencyName} bankName={bankName} />
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--ink-inverse)",
          }}
        >
          <EmptyState
            icon={<ServiceIcon name="generic" size={48} style={{ color: "var(--ink-inverse)" }} />}
            title={t("emptyTitle")}
            description={t("emptyMessage")}
            style={{ color: "var(--ink-inverse)" }}
          />
        </div>
      </main>
    );
  }

  // ── ERROR (réseau total → bandeau offline + réessayer) ───────────────────
  if (state === "error") {
    return (
      <main role="main" style={shellStyle}>
        <OfflineBanner isOffline={isOffline} namespace="services003" />
        {headerAndTitle}
        <div
          data-testid="services-error"
          role="alert"
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "var(--space-6)",
            color: "var(--ink-inverse)",
            textAlign: "center",
          }}
        >
          <span style={{ fontSize: "28px", fontWeight: 600 }}>{t("errorTitle")}</span>
          <span style={{ fontSize: "24px", color: "var(--ink-muted-inv)", maxWidth: "560px" }}>
            {t("errorMessage")}
          </span>
          <button
            data-testid="services-retry"
            onClick={() => void loadFamilies()}
            style={{
              minHeight: "72px",
              minWidth: "240px",
              fontSize: "24px",
              fontWeight: 600,
              color: "var(--brand-contrast)",
              backgroundColor: "var(--brand)",
              boxShadow: "var(--shadow-brand)",
              border: "none",
              borderRadius: "var(--r-md)",
              cursor: "pointer",
            }}
          >
            {t("retryButton")}
          </button>
        </div>
      </main>
    );
  }

  // ── NOMINAL — sections par famille dans la région scrollable (AUDIT-F7) ──
  return (
    <main role="main" style={shellStyle}>
      {headerAndTitle}

      {/* AUDIT-F7 — les sections vivent dans une région scrollable DÉDIÉE ;
          le dégradé + chevron signalent le contenu sous le pli et
          disparaissent en fin de scroll. */}
      <div style={{ position: "relative", flex: 1, minHeight: 0 }}>
        <div
          data-testid="services-scroll-region"
          ref={scrollRef}
          onScroll={onScroll}
          style={{
            height: "100%",
            overflowY: "auto",
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: "960px",
              margin: "0 auto",
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-8)",
              paddingBottom: "var(--space-6)",
            }}
          >
            {/* KIOSK-007 — Bannière file longue : affluence + téléphone mis en avant. */}
            {isLongQueue && (
              <section
                data-testid="long-queue-banner"
                aria-live="polite"
                style={{
                  backgroundColor: "var(--surface-1)",
                  borderRadius: "var(--r-lg)",
                  boxShadow: "var(--shadow-2)",
                  padding: "var(--space-4) var(--space-6)",
                  display: "flex",
                  flexDirection: "column",
                  gap: "var(--space-3)",
                }}
              >
                <span style={{ fontSize: "28px", fontWeight: 600, color: "var(--ink-strong)" }}>
                  {tDeg("longQueueTitle", { estimate: longestOpenWait })}
                </span>
                <span style={{ fontSize: "24px", color: "var(--ink-soft)" }}>
                  {tDeg("longQueueMessage")}
                </span>
                {/* Champ téléphone mis en avant — CTA menant à la saisie du numéro.
                    Audit F5 : le CTA PORTE le serviceId de la file la plus chargée
                    (isLongQueue garantit qu'un service ouvert existe) — plus jamais
                    de POST sans serviceId. Aucun libellé d'opération : purge du
                    store pour ne jamais afficher un choix périmé sur le ticket. */}
                <button
                  data-testid="long-queue-phone-cta"
                  onClick={() => {
                    purgeTicketOperationLabel();
                    router.push(
                      `/${currentLocale}/confirmation?serviceId=${longestOpenService?.id}&agencyId=${agencyId}`
                    );
                  }}
                  style={{
                    minHeight: "72px",
                    fontSize: "28px",
                    fontWeight: 600,
                    color: "var(--brand-contrast)",
                    backgroundColor: "var(--brand)",
                    boxShadow: "var(--shadow-brand)",
                    border: "none",
                    borderRadius: "var(--r-md)",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "var(--space-3)",
                  }}
                >
                  <PhoneIcon size={28} />
                  {tDeg("phoneFieldLabel")}
                </button>
              </section>
            )}

            {sections.map(({ service, operations }) => (
              <section
                key={service.id}
                data-testid="family-section"
                aria-label={service.name}
                style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}
              >
                {/* En-tête de famille : trait brand-inv + nom (pas d'estimation d'attente
                    affichée — décision PO ; le SLA reste porté jusqu'au ticket). */}
                <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
                  <span
                    aria-hidden="true"
                    style={{
                      width: "6px",
                      height: "28px",
                      borderRadius: "var(--r-full)",
                      backgroundColor: "var(--brand-inv)",
                      flexShrink: 0,
                    }}
                  />
                  <h2
                    data-testid="family-title"
                    style={{
                      fontFamily: "var(--font-display)",
                      fontSize: `${familyTitlePx}px`,
                      fontWeight: 700,
                      letterSpacing: "var(--tracking-tight)",
                      color: "var(--ink-inverse)",
                      margin: 0,
                    }}
                  >
                    {service.name}
                  </h2>
                </div>

                {/* Grille de tuiles — 3 colonnes à 1024×768, tuiles ≥ 96px. */}
                <div
                  data-testid="family-grid"
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
                    gap: "var(--space-4)",
                  }}
                >
                  {service.isOpen && operations.length > 0 ? (
                    operations.map((operation) => (
                      <button
                        key={operation.id}
                        data-testid="operation-tile"
                        onClick={() =>
                          goToConfirmation(service.id, operation.name, operation.id)
                        }
                        style={{
                          minHeight: "96px",
                          backgroundColor: "var(--surface-1)",
                          borderRadius: "var(--r-lg)",
                          border: "1px solid var(--hairline)",
                          boxShadow: "var(--shadow-1)",
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          gap: "var(--space-4)",
                          padding: "var(--space-3) var(--space-4)",
                          textAlign: "left",
                        }}
                      >
                        <span
                          data-testid="operation-tile-icon"
                          style={{
                            flexShrink: 0,
                            width: "56px",
                            height: "56px",
                            borderRadius: "var(--r-full)",
                            backgroundColor: "var(--brand-soft)",
                            color: "var(--brand)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <ServiceIcon
                            keyword={operation.iconKey || operation.code || operation.name}
                            size={32}
                          />
                        </span>
                        <span
                          data-testid="operation-tile-label"
                          style={{
                            fontSize: `${labelPx}px`,
                            fontWeight: 600,
                            lineHeight: "var(--leading-tight)",
                            color: "var(--action-label)",
                          }}
                        >
                          {operation.name}
                        </span>
                      </button>
                    ))
                  ) : (
                    /* Famille sans opération (ou fermée) → tuile unique du service. */
                    <button
                      data-testid="service-tile"
                      onClick={() => {
                        if (!service.isOpen) return;
                        goToConfirmation(service.id, service.name);
                      }}
                      aria-disabled={!service.isOpen ? "true" : undefined}
                      style={{
                        minHeight: "96px",
                        backgroundColor: "var(--surface-1)",
                        borderRadius: "var(--r-lg)",
                        border: "1px solid var(--hairline)",
                        boxShadow: service.isOpen ? "var(--shadow-1)" : "none",
                        cursor: service.isOpen ? "pointer" : "not-allowed",
                        opacity: service.isOpen ? 1 : 0.4,
                        display: "flex",
                        alignItems: "center",
                        gap: "var(--space-4)",
                        padding: "var(--space-3) var(--space-4)",
                        textAlign: "left",
                      }}
                    >
                      <span
                        data-testid="operation-tile-icon"
                        style={{
                          flexShrink: 0,
                          width: "56px",
                          height: "56px",
                          borderRadius: "var(--r-full)",
                          backgroundColor: "var(--brand-soft)",
                          color: "var(--brand)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <ServiceIcon keyword={service.code ?? service.name} size={32} />
                      </span>
                      <span
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: "var(--space-1)",
                          minWidth: 0,
                        }}
                      >
                        <span
                          data-testid="operation-tile-label"
                          style={{
                            fontSize: `${labelPx}px`,
                            fontWeight: 600,
                            lineHeight: "var(--leading-tight)",
                            color: "var(--action-label)",
                          }}
                        >
                          {service.name}
                        </span>
                        {!service.isOpen && (
                          <span
                            data-testid="service-schedule"
                            style={{ fontSize: "18px", color: "var(--ink-soft)" }}
                          >
                            {t("closedService", { schedule: service.schedule ?? "" })}
                          </span>
                        )}
                      </span>
                    </button>
                  )}
                </div>
              </section>
            ))}

            {/* Accès « Voir mon conseiller » — carte discrète mais visible en fin
                de page, style DISTINCT des tuiles d'opération (contour brand-soft sur le
                fond kiosque, pas de carte pleine), navigation vers /managers sans
                repasser par l'écran choice. */}
            <button
              data-testid="advisor-access-card"
              onClick={() => router.push(`/${currentLocale}/managers`)}
              style={{
                minHeight: "88px",
                backgroundColor: "transparent",
                border: "1px solid var(--brand-soft)",
                borderRadius: "var(--r-lg)",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "var(--space-4)",
                padding: "var(--space-3) var(--space-5)",
                textAlign: "left",
                color: "var(--ink-inverse)",
              }}
            >
              <span
                data-testid="advisor-access-icon"
                style={{
                  flexShrink: 0,
                  width: "56px",
                  height: "56px",
                  borderRadius: "var(--r-full)",
                  border: "1px solid var(--brand-soft)",
                  color: "var(--brand-inv)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <PersonIcon size={30} />
              </span>
              <span
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "var(--space-1)",
                  minWidth: 0,
                }}
              >
                <span
                  data-testid="advisor-access-label"
                  style={{
                    fontSize: `${labelPx}px`,
                    fontWeight: 600,
                    lineHeight: "var(--leading-tight)",
                    color: "var(--ink-inverse)",
                  }}
                >
                  {t("advisorCard")}
                </span>
                <span style={{ fontSize: "18px", color: "var(--ink-muted-inv)" }}>
                  {t("advisorHint")}
                </span>
              </span>
              <span
                aria-hidden="true"
                style={{ marginLeft: "auto", color: "var(--brand-inv)", display: "flex" }}
              >
                <ChevronIcon size={28} />
              </span>
            </button>
          </div>
        </div>

        {/* AUDIT-F7 — affordance de continuation : dégradé de bord + chevron
            animé + texte apparié. Décorative (aria-hidden), elle n'intercepte
            jamais le toucher (pointer-events none) et disparaît en fin de
            scroll. */}
        {canScrollDown && (
          <div
            data-testid="services-scroll-hint"
            aria-hidden="true"
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              height: "128px",
              pointerEvents: "none",
              display: "flex",
              alignItems: "flex-end",
              justifyContent: "center",
              background:
                "linear-gradient(to bottom, transparent, var(--surface-kiosk) 82%)",
            }}
          >
            <style>{SCROLL_HINT_CSS}</style>
            <span
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--space-3)",
                paddingBottom: "var(--space-2)",
                fontSize: "24px",
                fontWeight: 600,
                color: "var(--ink-inverse)",
              }}
            >
              <span className="kiosk-scroll-hint__chevron">
                <ChevronIcon size={28} style={{ transform: "rotate(90deg)" }} />
              </span>
              {t("scrollHint")}
            </span>
          </div>
        )}
      </div>

      {accessibilityButton}
    </main>
  );
}
