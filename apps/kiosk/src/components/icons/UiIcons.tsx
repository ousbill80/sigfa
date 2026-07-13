/**
 * UiIcons — petites icônes d'interface pour les écrans borne.
 *
 * Migration ICONS-001 : accessibilité, personne (conseiller) et opération
 * (guichet) sont rendues par le set SIGFA duotone (`SigfaIcon` de @sigfa/ui).
 * Le chevron d'action et le téléphone (CTA SMS) n'ont pas d'équivalent dans
 * le set : ils restent des icônes line/stroke locales (`currentColor`).
 * AUCUN emoji.
 */
import type { CSSProperties } from "react";

import { SigfaIcon } from "@sigfa/ui";

interface UiIconProps {
  size?: number;
  style?: CSSProperties;
  "data-testid"?: string;
}

function baseProps(size: number, dataTestid?: string) {
  return {
    "data-testid": dataTestid,
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    focusable: "false" as const,
  };
}

/** Chevron « › » signifiant l'action/navigation. */
export function ChevronIcon({ size = 28, style, "data-testid": id }: UiIconProps) {
  return (
    <svg {...baseProps(size, id)} style={style}>
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

/** Combiné téléphone — CTA « recevoir un SMS ». */
export function PhoneIcon({ size = 28, style, "data-testid": id }: UiIconProps) {
  return (
    <svg {...baseProps(size, id)} style={style}>
      <path d="M6 3h4l2 5-3 2a12 12 0 0 0 5 5l2-3 5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 4 5a2 2 0 0 1 2-2z" />
    </svg>
  );
}

/** « Accès prioritaire » — icône SIGFA « accessibilite » (duotone). */
export function AccessibilityIcon({ size = 28, style, "data-testid": id }: UiIconProps) {
  return (
    <SigfaIcon
      name="accessibilite"
      size={size}
      style={style}
      stroke="currentColor"
      data-testid={id}
    />
  );
}

/**
 * MODEL-KIOSK-B — « personne » : icône SIGFA « conseiller » (duotone). Sert de
 * repère au chemin « Voir mon conseiller » et de repli d'avatar (jamais
 * d'emoji, jamais d'image réseau externe).
 */
export function PersonIcon({ size = 28, style, "data-testid": id }: UiIconProps) {
  return (
    <SigfaIcon
      name="conseiller"
      size={size}
      style={style}
      stroke="currentColor"
      data-testid={id}
    />
  );
}

/**
 * MODEL-KIOSK-B — « opération » : icône SIGFA « guichet » (duotone) pour le
 * chemin « Une opération » de l'écran de choix.
 */
export function OperationIcon({ size = 28, style, "data-testid": id }: UiIconProps) {
  return (
    <SigfaIcon
      name="guichet"
      size={size}
      style={style}
      stroke="currentColor"
      data-testid={id}
    />
  );
}
