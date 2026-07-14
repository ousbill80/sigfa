/**
 * tv-fullscreen — plein écran natif + curseur masqué de l'écran TV public.
 *
 * L'écran est vu par le public : l'URL/chrome du navigateur doivent
 * disparaître. La Fullscreen API EXIGE un geste utilisateur (contrainte
 * navigateur : `requestFullscreen()` hors gestuelle est rejeté) → PAS
 * d'auto-fullscreen au chargement possible ; d'où le bouton discret « Plein
 * écran » dans le coin du bandeau. Ce même geste débloque aussi la synthèse
 * vocale (autoplay policy) — voir tv-voice.
 *
 * ## Exploitation définitive : mode kiosque navigateur
 * En production, l'écran doit être lancé en mode kiosque (plein écran natif
 * SANS geste, au boot du poste) :
 *   chrome --kiosk --autoplay-policy=no-user-gesture-required "http://<hôte>:3000/tv/<agencyId>"
 *   (Edge : msedge --kiosk <url> --edge-kiosk-type=fullscreen)
 * Le bouton reste un secours pour un poste ouvert à la main. Réglage son :
 * suffixer l'URL de `?muted=1` pour couper l'annonce vocale.
 *
 * Comportement du bouton :
 * - hors plein écran : icône « expand », sobre, coin du bandeau ;
 * - en plein écran : il devient « quitter » et ne réapparaît qu'au mouvement
 *   de souris (sinon masqué) ; `fullscreenchange` (+ variante webkit) resynchronise
 *   l'état quand on sort par Échap ;
 * - curseur masqué après {@link TV_CURSOR_IDLE_MS} d'inactivité (écran public).
 *
 * @module components/tv/tv-fullscreen
 */
"use client";

import {
  useCallback,
  useEffect,
  useState,
  type CSSProperties,
  type ReactElement,
} from "react";
import type { Locale } from "@/lib/i18n";

/** Inactivité (ms) avant de masquer curseur et bouton (écran public). */
export const TV_CURSOR_IDLE_MS = 4000 as const;

/* Libellés locaux FR/EN du contrôle plein écran — volontairement PAS dans
   lib/i18n.ts (fichier partagé, chantiers parallèles) : périmètre TV strict. */
const FULLSCREEN_LABELS: Record<Locale, { enter: string; exit: string }> = {
  fr: { enter: "Plein écran", exit: "Quitter le plein écran" },
  en: { enter: "Full screen", exit: "Exit full screen" },
};

/** Surface document minimale (préfixes WebKit inclus) — testabilité. */
interface FullscreenDocumentLike {
  fullscreenElement?: Element | null;
  webkitFullscreenElement?: Element | null;
  exitFullscreen?: () => Promise<void>;
  webkitExitFullscreen?: () => void;
  documentElement: {
    requestFullscreen?: () => Promise<void>;
    webkitRequestFullscreen?: () => void;
  };
}

/** Vrai si le document est actuellement en plein écran (webkit inclus). */
function readFullscreen(doc: FullscreenDocumentLike): boolean {
  return Boolean(doc.fullscreenElement ?? doc.webkitFullscreenElement);
}

/** Résultat de {@link useTvFullscreen}. */
export interface UseTvFullscreenResult {
  /** Vrai quand le document est en plein écran. */
  isFullscreen: boolean;
  /** Entre/sort du plein écran (best-effort, jamais d'erreur). */
  toggle: () => void;
}

/**
 * Suit et pilote l'état plein écran du document (Fullscreen API + préfixes
 * WebKit). Toute défaillance (API absente, promesse rejetée hors geste) est
 * avalée : l'écran reste fonctionnel en fenêtré.
 * @returns {@link UseTvFullscreenResult}.
 */
export function useTvFullscreen(): UseTvFullscreenResult {
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const doc = document as unknown as FullscreenDocumentLike;
    const sync = (): void => setIsFullscreen(readFullscreen(doc));
    sync();
    document.addEventListener("fullscreenchange", sync);
    document.addEventListener("webkitfullscreenchange", sync);
    return () => {
      document.removeEventListener("fullscreenchange", sync);
      document.removeEventListener("webkitfullscreenchange", sync);
    };
  }, []);

  const toggle = useCallback((): void => {
    const doc = document as unknown as FullscreenDocumentLike;
    try {
      if (readFullscreen(doc)) {
        if (doc.exitFullscreen) void doc.exitFullscreen().catch(() => undefined);
        else doc.webkitExitFullscreen?.();
      } else {
        const root = doc.documentElement;
        if (root.requestFullscreen) void root.requestFullscreen().catch(() => undefined);
        else root.webkitRequestFullscreen?.();
      }
    } catch {
      // Best-effort : API absente/refusée → l'écran reste utilisable fenêtré.
    }
  }, []);

  return { isFullscreen, toggle };
}

/**
 * Vrai après {@link TV_CURSOR_IDLE_MS} sans activité pointeur/clavier — le
 * parent masque alors le curseur (`cursor: none`) et les contrôles discrets.
 * @param timeoutMs - Délai d'inactivité (défaut {@link TV_CURSOR_IDLE_MS}).
 * @returns `true` quand l'écran est considéré inactif.
 */
export function useTvIdleCursor(timeoutMs: number = TV_CURSOR_IDLE_MS): boolean {
  const [idle, setIdle] = useState(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined = undefined;
    const arm = (): void => {
      setIdle(false);
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => setIdle(true), timeoutMs);
    };
    arm();
    const events = ["pointermove", "pointerdown", "keydown"] as const;
    events.forEach((type) => window.addEventListener(type, arm));
    return () => {
      if (timer !== undefined) clearTimeout(timer);
      events.forEach((type) => window.removeEventListener(type, arm));
    };
  }, [timeoutMs]);

  return idle;
}

/** Props de {@link TvFullscreenButton}. */
export interface TvFullscreenButtonProps {
  /** Vrai quand le document est en plein écran (icône/libellé « quitter »). */
  isFullscreen: boolean;
  /** Masque le bouton (inactivité — écran public). */
  hidden?: boolean;
  /** Entre/sort du plein écran. */
  onToggle: () => void;
  /** Locale du libellé accessible. */
  locale?: Locale;
}

/** Icône expand/compress (SVG inline, currentColor — aucune couleur en dur). */
function FullscreenIcon({ exit }: { exit: boolean }): ReactElement {
  // Quatre coins : flèches vers l'extérieur (entrer) ou l'intérieur (quitter).
  const d = exit
    ? "M9 3v6H3M15 3v6h6M9 21v-6H3M15 21v-6h6"
    : "M3 9V3h6M21 9V3h-6M3 15v6h6M21 15v6h-6";
  return (
    <svg
      aria-hidden="true"
      width="60%"
      height="60%"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={d} />
    </svg>
  );
}

/**
 * Bouton discret « Plein écran » du coin du bandeau TV. Sobre (transparent,
 * pictogramme --brand-contrast), libellé accessible FR/EN ; masqué à
 * l'inactivité (le curseur l'est aussi) et réapparaît au mouvement.
 * @param props - {@link TvFullscreenButtonProps}.
 * @returns L'élément bouton.
 */
export function TvFullscreenButton({
  isFullscreen,
  hidden = false,
  onToggle,
  locale = "fr",
}: TvFullscreenButtonProps): ReactElement {
  const labels = FULLSCREEN_LABELS[locale] ?? FULLSCREEN_LABELS.fr;
  const label = isFullscreen ? labels.exit : labels.enter;
  const size = "calc(var(--tv-header-height) - var(--space-6))";
  const style: CSSProperties = {
    width: size,
    height: size,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    border: "none",
    borderRadius: "var(--r-md)",
    backgroundColor: "transparent",
    color: "var(--brand-contrast)",
    cursor: "pointer",
    padding: 0,
    /* Discret : semi-effacé au repos, net au survol/focus ; disparaît (et
       devient inopérant) à l'inactivité — l'écran redevient 100 % public. */
    opacity: hidden ? 0 : 0.55,
    pointerEvents: hidden ? "none" : "auto",
    transition: "opacity var(--dur-2) var(--ease)",
  };
  return (
    <button
      type="button"
      data-testid="tv-fullscreen-button"
      data-fullscreen={isFullscreen ? "on" : "off"}
      aria-label={label}
      title={label}
      onClick={onToggle}
      onMouseEnter={(event) => {
        (event.currentTarget as HTMLButtonElement).style.opacity = hidden ? "0" : "1";
      }}
      onMouseLeave={(event) => {
        (event.currentTarget as HTMLButtonElement).style.opacity = hidden ? "0" : "0.55";
      }}
      style={style}
    >
      <FullscreenIcon exit={isFullscreen} />
    </button>
  );
}
