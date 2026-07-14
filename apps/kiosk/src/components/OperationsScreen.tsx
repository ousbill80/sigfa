/**
 * MODEL-KIOSK-A — OperationsScreen.tsx
 * Écran 2 du parcours borne 2 niveaux : SERVICE → OPÉRATION.
 *
 * Réutilise fidèlement le patron v2 « Sérénité Premium » de `ServicesScreen`
 * (grille de tuiles, icône SVG `ServiceIcon` dans un cercle `--brand-soft`,
 * SLA en pill, chevron d'action, tokens uniquement, zéro emoji).
 *
 * Charge les opérations ACTIVES d'un service via le contrat public
 * `GET /public/agencies/{agencyId}/operations?serviceId=` (SLA **résolu**
 * opération→service exposé par le serveur). Au clic → confirmation avec
 * `operationId` (le `serviceId` reste transmis, rétrocompat + dérivation).
 *
 * Optimisation UX (critère 4) : SI le service n'a **qu'une seule opération**
 * (l'opération « défaut »), on SAUTE cet écran et on navigue directement à la
 * confirmation — on ne force pas un choix inutile. Aucune carte n'est rendue
 * dans ce cas (redirection immédiate).
 *
 * 5 états : loading (grille en attente), nominal (grille), empty (aucune
 * opération), error (échec serveur, bouton réessayer), offline (bandeau sur
 * erreur réseau). « ← Retour » ramène à l'écran services (router.back()).
 */
"use client";

import { useEffect, useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { useRouter, useParams } from "next/navigation";
import { createSigfaClient } from "@sigfa/contracts";
import { EmptyState, IconRetour } from "@sigfa/ui";
import { useInactivityTimeout } from "@/hooks/useInactivityTimeout";
import { useAccessibilityMode } from "@/hooks/useAccessibilityMode";
import { ServiceIcon } from "@/components/icons/ServiceIcon";
import { SelectionSkeletonGrid } from "@/components/SelectionSkeletonGrid";
import { AccessibilityIcon, ChevronIcon } from "@/components/icons/UiIcons";
import { OfflineBanner } from "@/components/OfflineBanner";
import { storeTicketOperationLabel } from "@/lib/ticket-operation-store";

/** Opération publique telle qu'exposée par le contrat (SLA résolu). */
export interface OperationItem {
  id: string;
  code: string;
  name: string;
  /** SLA RÉSOLU (opération ?? service) — pour l'estimation d'attente. */
  slaMinutes: number;
  /** Clé d'icône optionnelle (mapping `ServiceIcon`). */
  iconKey?: string;
}

interface OperationsScreenProps {
  serviceId: string;
  agencyId: string;
}

type LoadState = "loading" | "ready" | "empty" | "error";

/** Base URL de l'API — mock Prism canonique par défaut (RT-001b). */
function apiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4010";
}

export function OperationsScreen({ serviceId, agencyId }: OperationsScreenProps) {
  const t = useTranslations("operationsModelA");
  const router = useRouter();
  const params = useParams();
  const currentLocale = (params?.locale as string) ?? "fr";
  const { isAccessibilityMode, toggleAccessibilityMode } = useAccessibilityMode();

  const [operations, setOperations] = useState<OperationItem[]>([]);
  const [state, setState] = useState<LoadState>("loading");
  const [isOffline, setIsOffline] = useState(false);

  const timeoutMs = isAccessibilityMode ? 60000 : 30000;
  useInactivityTimeout(() => {
    router.push(`/${currentLocale}`);
  }, timeoutMs);

  /**
   * Navigue vers la confirmation en portant serviceId ET operationId.
   * KIOSK-005b (audit F8) : le libellé PUBLIC de l'opération est déposé dans
   * le store mémoire — le Moment Ticket l'affichera en eyebrow (vérification
   * du choix d'un coup d'œil).
   */
  const goToConfirmation = useCallback(
    (operation: Pick<OperationItem, "id" | "name">) => {
      storeTicketOperationLabel(operation.name);
      router.push(
        `/${currentLocale}/confirmation?serviceId=${serviceId}&operationId=${operation.id}&agencyId=${agencyId}`
      );
    },
    [router, currentLocale, serviceId, agencyId]
  );

  const loadOperations = useCallback(async () => {
    setState("loading");
    setIsOffline(false);
    const client = createSigfaClient("public", apiBaseUrl());
    try {
      const { data, response } = await client.GET(
        "/public/agencies/{agencyId}/operations",
        { params: { path: { agencyId }, query: { serviceId } } }
      );
      if (response.status !== 200 || !data) {
        setState("error");
        return;
      }
      const ops = (data.data ?? []) as OperationItem[];
      // Saut « opération unique » : une seule opération → confirmation directe.
      if (ops.length === 1) {
        goToConfirmation(ops[0]);
        return;
      }
      if (ops.length === 0) {
        setState("empty");
        return;
      }
      setOperations(ops);
      setState("ready");
    } catch {
      // Erreur réseau : état erreur + bandeau offline (borne partagée).
      setIsOffline(true);
      setState("error");
    }
  }, [agencyId, serviceId, goToConfirmation]);

  useEffect(() => {
    void loadOperations();
  }, [loadOperations]);

  const headerAndA11y = (
    <>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-4)",
        }}
      >
        <button
          data-testid="operations-back-btn"
          onClick={() => router.back()}
          style={{
            fontSize: "20px",
            color: "var(--ink-inverse)",
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
        <span
          style={{
            fontSize: "28px",
            color: "var(--ink-muted-inv)",
            marginLeft: "auto",
          }}
        >
          {currentLocale.toUpperCase()}
        </span>
      </header>
      <h1
        style={{
          fontFamily: "var(--font-display)",
          fontSize: "var(--text-2xl)",
          fontWeight: 700,
          letterSpacing: "var(--tracking-tight)",
          color: "var(--ink-inverse)",
          textAlign: "center",
          margin: 0,
        }}
      >
        {t("title")}
      </h1>
    </>
  );

  const shellStyle = {
    backgroundColor: "var(--surface-kiosk)",
    minHeight: "100vh",
    display: "flex",
    flexDirection: "column" as const,
    padding: "var(--space-8)",
    gap: "var(--space-6)",
  };

  // ── LOADING (AUDIT-F20) — skeleton de tuiles animé, plus d'icône figée ────
  if (state === "loading") {
    return (
      <main role="main" style={shellStyle}>
        {headerAndA11y}
        <SelectionSkeletonGrid
          data-testid="operations-loading"
          label={t("loadingMessage")}
        />
      </main>
    );
  }

  // ── ERROR (dont réseau → bandeau offline) ────────────────────────────────
  if (state === "error") {
    return (
      <main role="main" style={shellStyle}>
        <OfflineBanner isOffline={isOffline} namespace="operationsModelA" />
        {isOffline && (
          <span data-testid="operations-offline-banner" hidden>
            {t("offlineBanner")}
          </span>
        )}
        {headerAndA11y}
        <div
          data-testid="operations-error"
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
            data-testid="operations-retry"
            onClick={() => void loadOperations()}
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

  // ── EMPTY ────────────────────────────────────────────────────────────────
  if (state === "empty") {
    return (
      <main
        role="main"
        style={{
          ...shellStyle,
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
      </main>
    );
  }

  // ── NOMINAL (grille d'opérations) ────────────────────────────────────────
  return (
    <main role="main" style={shellStyle}>
      {headerAndA11y}

      <div
        style={{
          width: "100%",
          maxWidth: "960px",
          margin: "0 auto",
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-6)",
          flex: 1,
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))",
            gap: "var(--space-6)",
          }}
        >
          {operations.map((operation) => (
            <button
              key={operation.id}
              data-testid="operation-card"
              onClick={() => goToConfirmation(operation)}
              style={{
                minHeight: "96px",
                backgroundColor: "var(--surface-1)",
                borderRadius: "var(--r-lg)",
                border: "1px solid var(--hairline)",
                boxShadow: "var(--shadow-2)",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                padding: "var(--space-4) var(--space-6)",
                gap: "var(--space-6)",
                textAlign: "left",
              }}
            >
              <span
                data-testid="operation-icon"
                style={{
                  flexShrink: 0,
                  width: "72px",
                  height: "72px",
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
                  size={40}
                />
              </span>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-start",
                  gap: "var(--space-2)",
                  flex: 1,
                  minWidth: 0,
                }}
              >
                <span
                  data-testid="operation-label"
                  style={{
                    fontSize: "28px",
                    fontWeight: 600,
                    color: "var(--action-label)",
                  }}
                >
                  {operation.name}
                </span>
                <span
                  data-testid="operation-estimate"
                  style={{
                    fontSize: "20px",
                    fontWeight: 600,
                    color: "var(--brand-strong)",
                    backgroundColor: "var(--brand-soft)",
                    borderRadius: "var(--r-full)",
                    padding: "var(--space-1) var(--space-3)",
                  }}
                >
                  {t("waitEstimate", { minutes: operation.slaMinutes })}
                </span>
              </div>
              <ChevronIcon size={28} style={{ flexShrink: 0, color: "var(--ink-soft)" }} />
            </button>
          ))}
        </div>
      </div>

      <button
        data-testid="operations-accessibility-btn"
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
          display: "flex",
          alignItems: "center",
          gap: "var(--space-3)",
        }}
      >
        <AccessibilityIcon size={isAccessibilityMode ? 32 : 28} />
        {t("accessibilityButton")}
      </button>
    </main>
  );
}
