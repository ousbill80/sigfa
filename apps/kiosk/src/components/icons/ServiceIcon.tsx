/**
 * ServiceIcon — icônes des services de l'écran services (borne).
 *
 * Migration ICONS-001 : le rendu est délégué au set d'icônes SIGFA duotone
 * (`SigfaIcon` de @sigfa/ui) — plus aucun tracé SVG ad hoc ici. L'API du
 * composant est conservée à l'identique (`name`/`keyword`/`size`, `data-icon`
 * porte toujours la clé métier du jeu).
 *
 * - `currentColor` → l'icône prend la couleur du parent (posée en `--brand`
 *   dans un cercle `--brand-soft`).
 * - Les services sont configurables (`code`/`name`) : on mappe par mot-clé,
 *   sinon on retombe sur une icône générique par défaut. AUCUN emoji.
 */
import type { CSSProperties } from "react";

import { SigfaIcon, type IconName } from "@sigfa/ui";

/** Clés d'icônes disponibles dans le jeu. */
export type ServiceIconName =
  | "deposit"
  | "withdrawal"
  | "transfer"
  | "complaint"
  | "account"
  | "credit"
  | "savings"
  | "exchange"
  | "advisor"
  | "generic";

export interface ServiceIconProps {
  /** Nom d'icône explicite. Prioritaire sur `keyword`. */
  name?: ServiceIconName;
  /** Libellé/code du service — mappé par mot-clé si `name` absent. */
  keyword?: string;
  /** Taille du carré SVG en px (défaut 40). */
  size?: number;
  style?: CSSProperties;
  "data-testid"?: string;
}

/**
 * Table de correspondance mot-clé → icône. Insensible à la casse/accents.
 * Couvre FR + EN pour les services bancaires courants.
 */
const KEYWORD_MAP: ReadonlyArray<readonly [readonly string[], ServiceIconName]> = [
  [["depot", "deposit", "versement"], "deposit"],
  [["retrait", "withdrawal", "cash", "especes"], "withdrawal"],
  [["virement", "transfer", "transfert"], "transfer"],
  [["reclamation", "complaint", "plainte", "litige"], "complaint"],
  [["compte", "account", "guichet"], "account"],
  [["credit", "loan", "pret", "financement"], "credit"],
  [["epargne", "savings", "livret"], "savings"],
  [["change", "exchange", "devise", "currency"], "exchange"],
  [["conseil", "advisor", "conseiller", "rendez", "rdv", "appointment"], "advisor"],
];

/** Normalise pour la recherche par mot-clé (minuscule + sans accent). */
function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

/** Ensemble des clés d'icônes valides — pour honorer un `iconKey` explicite. */
const ICON_NAMES: ReadonlySet<string> = new Set<ServiceIconName>([
  "deposit",
  "withdrawal",
  "transfer",
  "complaint",
  "account",
  "credit",
  "savings",
  "exchange",
  "advisor",
  "generic",
]);

/** Vrai si `value` est une clé d'icône connue du jeu (`iconKey` contrat). */
export function isServiceIconName(value: string): value is ServiceIconName {
  return ICON_NAMES.has(value);
}

/** Résout un libellé/code de service en clé d'icône, avec fallback générique. */
export function resolveServiceIcon(keyword: string): ServiceIconName {
  // MODEL-KIOSK-A : un `iconKey` contrat identique à une clé du jeu est honoré
  // tel quel (ex: "deposit", "credit"), avant la recherche par mot-clé.
  if (isServiceIconName(keyword)) {
    return keyword;
  }
  const normalized = normalize(keyword);
  for (const [tokens, iconName] of KEYWORD_MAP) {
    if (tokens.some((token) => normalized.includes(token))) {
      return iconName;
    }
  }
  return "generic";
}

/** Clé métier du jeu → icône du set SIGFA duotone (@sigfa/ui). */
const SIGFA_ICON_BY_SERVICE: Record<ServiceIconName, IconName> = {
  deposit: "depot",
  withdrawal: "retrait",
  transfer: "virement",
  complaint: "alerte",
  account: "compte",
  credit: "credit",
  savings: "epargne",
  exchange: "change-devises",
  advisor: "conseiller",
  generic: "guichet",
};

/**
 * Icône d'un service — rendue par le set SIGFA (`currentColor` → hérite
 * `--brand` du parent). `data-icon` reste la clé métier du jeu (contrat des
 * écrans appelants et des tests).
 */
export function ServiceIcon({
  name,
  keyword,
  size = 40,
  style,
  "data-testid": dataTestid,
}: ServiceIconProps) {
  const resolved: ServiceIconName = name ?? (keyword ? resolveServiceIcon(keyword) : "generic");

  return (
    <SigfaIcon
      name={SIGFA_ICON_BY_SERVICE[resolved]}
      size={size}
      style={style}
      stroke="currentColor"
      data-icon={resolved}
      data-testid={dataTestid}
    />
  );
}
