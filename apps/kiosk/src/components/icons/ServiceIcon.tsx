/**
 * ServiceIcon — jeu d'icônes SVG line/stroke cohérentes pour l'écran services.
 * Refonte v2 « Sérénité Premium » : fin des emoji sur un produit bancaire.
 *
 * - Traits ~2px, `stroke="currentColor"` → l'icône prend la couleur du parent
 *   (posée en `--brand` dans un cercle `--brand-soft`).
 * - Les services sont configurables (`code`/`name`) : on mappe par mot-clé,
 *   sinon on retombe sur une icône générique par défaut. AUCUN emoji.
 */
import type { CSSProperties } from "react";

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

/** Résout un libellé/code de service en clé d'icône, avec fallback générique. */
export function resolveServiceIcon(keyword: string): ServiceIconName {
  const normalized = normalize(keyword);
  for (const [tokens, iconName] of KEYWORD_MAP) {
    if (tokens.some((token) => normalized.includes(token))) {
      return iconName;
    }
  }
  return "generic";
}

/** Chemins SVG (stroke) par icône. viewBox 24×24, traits arrondis. */
function renderPaths(name: ServiceIconName) {
  switch (name) {
    case "deposit":
      // Flèche vers un portefeuille (dépôt = entrée d'argent).
      return (
        <>
          <path d="M12 3v9" />
          <path d="M8 8l4 4 4-4" />
          <path d="M4 14h16v6H4z" />
          <path d="M16 16h1.5" />
        </>
      );
    case "withdrawal":
      // Billets sortant d'un distributeur (retrait).
      return (
        <>
          <path d="M4 5h16v9H4z" />
          <path d="M4 9h16" />
          <path d="M9 20l3-3 3 3" />
          <path d="M12 17v5" />
        </>
      );
    case "transfer":
      // Deux flèches opposées (virement / transfert).
      return (
        <>
          <path d="M4 9h13l-3-3" />
          <path d="M20 15H7l3 3" />
        </>
      );
    case "complaint":
      // Bulle de dialogue avec point d'exclamation (réclamation).
      return (
        <>
          <path d="M4 5h16v11H9l-4 4v-4H4z" />
          <path d="M12 8v3" />
          <path d="M12 13.5v.01" />
        </>
      );
    case "account":
      // Carte + puce (compte).
      return (
        <>
          <path d="M3 6h18v12H3z" />
          <path d="M3 10h18" />
          <path d="M7 14h4" />
        </>
      );
    case "credit":
      // Pièce avec signe (crédit / prêt).
      return (
        <>
          <circle cx="12" cy="12" r="8" />
          <path d="M9 12h6" />
          <path d="M12 9v6" />
        </>
      );
    case "savings":
      // Tirelire (épargne).
      return (
        <>
          <path d="M4 12a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v3a2 2 0 0 1-2 2h-1v2h-3v-2H9v2H6v-2a4 4 0 0 1-2-3z" />
          <path d="M9 9h3" />
          <path d="M20 11h1" />
        </>
      );
    case "exchange":
      // Double flèche circulaire (change de devises).
      return (
        <>
          <path d="M4 11a8 8 0 0 1 14-5l2 2" />
          <path d="M20 6v4h-4" />
          <path d="M20 13a8 8 0 0 1-14 5l-2-2" />
          <path d="M4 18v-4h4" />
        </>
      );
    case "advisor":
      // Personne (conseiller).
      return (
        <>
          <circle cx="12" cy="8" r="3.5" />
          <path d="M5 20a7 7 0 0 1 14 0" />
        </>
      );
    case "generic":
    default:
      // Étoile/point d'accueil générique (fallback).
      return (
        <>
          <circle cx="12" cy="12" r="8" />
          <path d="M12 8v4l3 2" />
        </>
      );
  }
}

/**
 * Icône SVG d'un service. `stroke="currentColor"` → hérite `--brand` du parent.
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
    <svg
      data-testid={dataTestid}
      data-icon={resolved}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={style}
    >
      {renderPaths(resolved)}
    </svg>
  );
}
