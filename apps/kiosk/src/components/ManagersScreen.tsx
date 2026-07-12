/**
 * MODEL-KIOSK-B — ManagersScreen.tsx
 * Écran « Voir mon conseiller » : liste NOMINATIVE des conseillers d'une agence.
 *
 * Charge `GET /public/agencies/{agencyId}/relationship-managers` (contrat public,
 * zéro PII : `{ id, displayName, photoUrl? }`) via `@sigfa/contracts`. Réutilise
 * fidèlement le patron v2 « Sérénité Premium » de `OperationsScreen`/`ServicesScreen`
 * (grille de tuiles, cercle --brand-soft, chevron d'action, tokens uniquement,
 * zéro emoji, cibles ≥ 72 px).
 *
 * Avatar = **photo** (`<img>`) si `photoUrl` fournie, sinon **INITIALES** du nom
 * dans un cercle --brand-soft (repli SVG `PersonIcon` si le nom est vide). Aucune
 * image réseau EXTERNE n'est rendue quand `photoUrl` est absente.
 *
 * Au clic → confirmation avec `targetManagerId` (le ticket rejoint la file
 * personnelle du conseiller — MODEL-API-B/D6). Le « Moment Ticket » indiquera le
 * conseiller choisi.
 *
 * 5 états : loading, liste (nominal), empty (« aucun conseiller disponible »),
 * error (500 + réessayer), offline (bandeau sur erreur réseau). « ← Retour »,
 * FR/EN, contraste ≥ 7:1, tokens uniquement.
 */
"use client";

import { useEffect, useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { useRouter, useParams } from "next/navigation";
import { createSigfaClient } from "@sigfa/contracts";
import { EmptyState } from "@sigfa/ui";
import { useInactivityTimeout } from "@/hooks/useInactivityTimeout";
import { useAccessibilityMode } from "@/hooks/useAccessibilityMode";
import { AccessibilityIcon, ChevronIcon, PersonIcon } from "@/components/icons/UiIcons";
import { OfflineBanner } from "@/components/OfflineBanner";

/** Conseiller public tel qu'exposé par le contrat (zéro PII). */
export interface RelationshipManagerItem {
  id: string;
  displayName: string;
  photoUrl?: string | null;
}

interface ManagersScreenProps {
  agencyId: string;
}

type LoadState = "loading" | "ready" | "empty" | "error";

/** Base URL de l'API — mock Prism canonique par défaut (RT-001b). */
function apiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4010";
}

/**
 * Initiales à partir du nom d'affichage (max 2 lettres, majuscules).
 * « Awa Diallo » → « AD » ; « Kofi A. » → « KA » ; « Yao » → « Y ».
 */
export function computeInitials(displayName: string): string {
  const words = displayName
    .trim()
    .split(/\s+/)
    .filter((w) => /[\p{L}\p{N}]/u.test(w));
  if (words.length === 0) return "";
  const letters = words
    .slice(0, 2)
    .map((w) => {
      const match = w.match(/[\p{L}\p{N}]/u);
      return match ? match[0] : "";
    })
    .join("");
  return letters.toUpperCase();
}

/** Repli initiales (cercle --brand-soft) — partagé photo absente ET onError. */
function InitialsBadge({ displayName }: { displayName: string }) {
  const initials = computeInitials(displayName);
  return (
    <span
      data-testid="manager-avatar-initials"
      aria-hidden="true"
      style={{
        flexShrink: 0,
        width: "72px",
        height: "72px",
        borderRadius: "var(--r-full)",
        backgroundColor: "var(--brand-soft)",
        color: "var(--brand-strong)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: "28px",
        fontWeight: 700,
      }}
    >
      {initials !== "" ? initials : <PersonIcon size={40} />}
    </span>
  );
}

/**
 * Avatar conseiller : photo (`<img>`) si `photoUrl` fournie, sinon INITIALES.
 * ROBUSTESSE : si l'image échoue à charger (404, chemin invalide, réseau), on
 * bascule sur le repli initiales via `onError` — jamais d'image cassée en PROD.
 */
function ManagerAvatar({
  displayName,
  photoUrl,
  altText,
}: {
  displayName: string;
  photoUrl?: string | null;
  altText: string;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  if (!photoUrl || imgFailed) {
    return <InitialsBadge displayName={displayName} />;
  }
  return (
    <img
      data-testid="manager-avatar-photo"
      src={photoUrl}
      alt={altText}
      onError={() => setImgFailed(true)}
      style={{
        flexShrink: 0,
        width: "72px",
        height: "72px",
        borderRadius: "var(--r-full)",
        objectFit: "cover",
        backgroundColor: "var(--brand-soft)",
      }}
    />
  );
}

export function ManagersScreen({ agencyId }: ManagersScreenProps) {
  const t = useTranslations("managersModelB");
  const router = useRouter();
  const params = useParams();
  const currentLocale = (params?.locale as string) ?? "fr";
  const { isAccessibilityMode, toggleAccessibilityMode } = useAccessibilityMode();

  const [managers, setManagers] = useState<RelationshipManagerItem[]>([]);
  const [state, setState] = useState<LoadState>("loading");
  const [isOffline, setIsOffline] = useState(false);

  const timeoutMs = isAccessibilityMode ? 60000 : 30000;
  useInactivityTimeout(() => {
    router.push(`/${currentLocale}`);
  }, timeoutMs);

  /**
   * Navigue vers la confirmation en portant `targetManagerId` + `agencyId` +
   * `managerName`. Le ticket rejoindra la file personnelle du conseiller
   * (MODEL-API-B/D6) ; `managerName` (donnée publique, non-PII) est transporté
   * jusqu'à la confirmation ET au Moment Ticket pour rappeler QUI le client
   * va voir (réassurance).
   */
  const goToConfirmation = useCallback(
    (managerId: string, displayName: string) => {
      router.push(
        `/${currentLocale}/confirmation?targetManagerId=${managerId}&agencyId=${agencyId}&managerName=${encodeURIComponent(displayName)}`
      );
    },
    [router, currentLocale, agencyId]
  );

  const loadManagers = useCallback(async () => {
    setState("loading");
    setIsOffline(false);
    const client = createSigfaClient("public", apiBaseUrl());
    try {
      const { data, response } = await client.GET(
        "/public/agencies/{agencyId}/relationship-managers",
        { params: { path: { agencyId } } }
      );
      if (response.status !== 200 || !data) {
        setState("error");
        return;
      }
      const list = (data.data ?? []) as RelationshipManagerItem[];
      if (list.length === 0) {
        setState("empty");
        return;
      }
      setManagers(list);
      setState("ready");
    } catch {
      // Erreur réseau : état erreur + bandeau offline (borne partagée).
      setIsOffline(true);
      setState("error");
    }
  }, [agencyId]);

  useEffect(() => {
    void loadManagers();
  }, [loadManagers]);

  const header = (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-4)",
      }}
    >
      <button
        data-testid="managers-back-btn"
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
        ← {t("backButton")}
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
  );

  const title = (
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
  );

  const shellStyle = {
    backgroundColor: "var(--surface-kiosk)",
    minHeight: "100vh",
    display: "flex",
    flexDirection: "column" as const,
    padding: "var(--space-8)",
    gap: "var(--space-6)",
  };

  // ── LOADING ────────────────────────────────────────────────────────────────
  if (state === "loading") {
    return (
      <main role="main" style={shellStyle}>
        {header}
        {title}
        <div
          data-testid="managers-loading"
          role="status"
          aria-live="polite"
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "var(--space-4)",
            color: "var(--ink-inverse)",
            fontSize: "24px",
          }}
        >
          <PersonIcon size={48} style={{ color: "var(--ink-inverse)" }} />
          {t("loadingMessage")}
        </div>
      </main>
    );
  }

  // ── ERROR (dont réseau → bandeau offline) ──────────────────────────────────
  if (state === "error") {
    return (
      <main role="main" style={shellStyle}>
        <OfflineBanner isOffline={isOffline} namespace="managersModelB" />
        {isOffline && (
          <span data-testid="managers-offline-banner" hidden>
            {t("offlineBanner")}
          </span>
        )}
        {header}
        {title}
        <div
          data-testid="managers-error"
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
            data-testid="managers-retry"
            onClick={() => void loadManagers()}
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

  // ── EMPTY ──────────────────────────────────────────────────────────────────
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
          icon={<PersonIcon size={48} style={{ color: "var(--ink-inverse)" }} />}
          title={t("emptyTitle")}
          description={t("emptyMessage")}
          style={{ color: "var(--ink-inverse)" }}
        />
      </main>
    );
  }

  // ── NOMINAL (liste des conseillers) ────────────────────────────────────────
  return (
    <main role="main" style={shellStyle}>
      {header}
      {title}

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
          {managers.map((manager) => {
            return (
              <button
                key={manager.id}
                data-testid="manager-card"
                onClick={() => goToConfirmation(manager.id, manager.displayName)}
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
                <ManagerAvatar
                  displayName={manager.displayName}
                  photoUrl={manager.photoUrl}
                  altText={t("avatarAlt", { name: manager.displayName })}
                />
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
                    data-testid="manager-name"
                    style={{
                      fontSize: "28px",
                      fontWeight: 600,
                      color: "var(--action-label)",
                    }}
                  >
                    {manager.displayName}
                  </span>
                </div>
                <ChevronIcon size={28} style={{ flexShrink: 0, color: "var(--ink-soft)" }} />
              </button>
            );
          })}
        </div>
      </div>

      <button
        data-testid="managers-accessibility-btn"
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
