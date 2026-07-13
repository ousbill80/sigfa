/**
 * SigfaIcon — composant générique du set d'icônes SIGFA duotone (ICONS-001).
 *
 * Rendu : SVG 24 x 24 en deux couches `currentColor` (fond duotone doux +
 * trait 2 px arrondi) — l'icône prend la couleur du texte parent et reste
 * donc 100 % thémable par token (`--brand`, `--ink`, `--gold`, ...).
 *
 * Accessibilité : `aria-hidden` par défaut — la règle design system est
 * « icône + texte toujours appariés », le texte porte le sens. Passer `title`
 * rend l'icône annonçable (role="img" + <title>).
 *
 * @module icons/SigfaIcon
 */
import { type ReactNode, type SVGProps } from "react";

import { ICON_ARTWORK } from "./paths";

/** Nom d'une icône du set SIGFA. */
export type IconName = keyof typeof ICON_ARTWORK;

/** Tous les noms du set (source de vérité pour le mapping et les tests). */
export const ICON_NAMES = Object.keys(ICON_ARTWORK) as IconName[];

/** Opacité de la couche de fond duotone (convention du set : 0.18–0.22). */
export const DUO_OPACITY = 0.2;

/** Alias de taille du set. */
export type IconSizeAlias = "sm" | "md" | "lg" | "xl";

/** Taille : alias du set ou nombre de pixels libre. */
export type IconSize = IconSizeAlias | number;

/**
 * Tailles en pixels des alias. Le design system v2 ne définit pas (encore)
 * de tokens `--icon-*` : l'échelle 16/24/32/48 est la convention du set.
 */
export const ICON_SIZE_PX: Record<IconSizeAlias, number> = {
  sm: 16,
  md: 24,
  lg: 32,
  xl: 48,
};

export interface SigfaIconProps
  extends Omit<SVGProps<SVGSVGElement>, "children"> {
  /** Nom de l'icône dans le set. */
  name: IconName;
  /** Taille (alias sm/md/lg/xl ou pixels). Défaut : `md` (24). */
  size?: IconSize;
  /**
   * Libellé accessible optionnel. Sans `title`, l'icône est `aria-hidden`
   * (le texte apparié porte le sens).
   */
  title?: string;
}

/**
 * Icône du set SIGFA.
 *
 * @param props - {@link SigfaIconProps}.
 * @returns Le SVG duotone de l'icône demandée.
 */
export function SigfaIcon({
  name,
  size = "md",
  title,
  ...rest
}: SigfaIconProps): ReactNode {
  const px = typeof size === "number" ? size : ICON_SIZE_PX[size];
  const artwork = ICON_ARTWORK[name];
  const a11y =
    title != null
      ? ({ role: "img" } as const)
      : ({ "aria-hidden": true } as const);

  return (
    <svg
      data-icon={name}
      width={px}
      height={px}
      viewBox="0 0 24 24"
      fill="none"
      focusable="false"
      {...a11y}
      {...rest}
    >
      {title != null && <title>{title}</title>}
      <g
        data-layer="duo"
        fill="currentColor"
        stroke="none"
        opacity={DUO_OPACITY}
      >
        {artwork.duo}
      </g>
      <g
        data-layer="line"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {artwork.line}
      </g>
    </svg>
  );
}
