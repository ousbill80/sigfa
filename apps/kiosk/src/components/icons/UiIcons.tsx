/**
 * UiIcons — petites icônes d'interface pour les écrans borne.
 *
 * Migration ICONS-001/002 : TOUTES les icônes d'interface sont rendues par le
 * set SIGFA duotone (`SigfaIcon` de @sigfa/ui) — accessibilité, personne
 * (conseiller), opération (guichet), chevron d'action et téléphone (CTA SMS).
 * AUCUN emoji, aucune icône line ad hoc locale.
 */
import type { CSSProperties } from "react";

import { SigfaIcon } from "@sigfa/ui";

interface UiIconProps {
  size?: number;
  style?: CSSProperties;
  "data-testid"?: string;
}

/**
 * Chevron d'action/navigation — icône SIGFA « chevron » (duotone, pointe à
 * droite ; la rotation éventuelle reste au consommateur via `style`).
 */
export function ChevronIcon({ size = 28, style, "data-testid": id }: UiIconProps) {
  return (
    <SigfaIcon
      name="chevron"
      size={size}
      style={style}
      stroke="currentColor"
      data-testid={id}
    />
  );
}

/** Combiné téléphone (CTA « recevoir un SMS ») — icône SIGFA « telephone ». */
export function PhoneIcon({ size = 28, style, "data-testid": id }: UiIconProps) {
  return (
    <SigfaIcon
      name="telephone"
      size={size}
      style={style}
      stroke="currentColor"
      data-testid={id}
    />
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

/**
 * CONTRACT-014 (audit F14) — « coche » : icône SIGFA « valider » (duotone),
 * appariée au texte « Présent » de la pill de disponibilité conseiller.
 */
export function CheckIcon({ size = 28, style, "data-testid": id }: UiIconProps) {
  return (
    <SigfaIcon
      name="valider"
      size={size}
      style={style}
      stroke="currentColor"
      data-testid={id}
    />
  );
}

/**
 * CONTRACT-014 (audit F14) — « horloge » : icône SIGFA « horloge » (duotone),
 * appariée au texte « Absent aujourd'hui » (de retour bientôt — information
 * calme, jamais une alerte).
 */
export function ClockIcon({ size = 28, style, "data-testid": id }: UiIconProps) {
  return (
    <SigfaIcon
      name="horloge"
      size={size}
      style={style}
      stroke="currentColor"
      data-testid={id}
    />
  );
}
