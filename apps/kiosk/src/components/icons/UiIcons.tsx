/**
 * UiIcons — petites icônes SVG d'interface (line/stroke, `currentColor`)
 * pour l'écran services : chevron d'action, téléphone (CTA SMS), accessibilité.
 * Cohérentes avec ServiceIcon. AUCUN emoji.
 */
import type { CSSProperties } from "react";

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

/** Silhouette « accès prioritaire » (fauteuil roulant stylisé, line). */
export function AccessibilityIcon({ size = 28, style, "data-testid": id }: UiIconProps) {
  return (
    <svg {...baseProps(size, id)} style={style}>
      <circle cx="12" cy="4.5" r="1.8" />
      <path d="M12 7v5h4l2 5" />
      <path d="M12 12H8l-1 3a4 4 0 1 0 5 4" />
    </svg>
  );
}
