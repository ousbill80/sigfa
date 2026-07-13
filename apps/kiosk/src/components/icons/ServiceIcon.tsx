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
  | "card"
  | "cheque"
  | "statement"
  | "opposition"
  | "payment"
  | "contract"
  | "mail"
  | "info"
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
  // Les entrées SPÉCIFIQUES précèdent les génériques : « opposition carte »
  // doit gagner sur « carte », « retrait chèque » sur « retrait », « dépôt de
  // courriers » sur « dépôt », etc. (première correspondance retenue).
  [["opposition", "blocage"], "opposition"],
  [["cheque", "chequier", "check"], "cheque"],
  [["releve", "statement", "solde"], "statement"],
  [["courrier", "mail"], "mail"],
  [["information", "renseignement"], "info"],
  [["souscription", "subscription", "contrat", "contract"], "contract"],
  [["paiement", "payment", "facture"], "payment"],
  [["carte", "card", "prepay"], "card"],
  [["depot", "deposit", "versement"], "deposit"],
  [["retrait", "withdrawal", "cash", "especes"], "withdrawal"],
  [["virement", "transfer", "transfert"], "transfer"],
  [["reclamation", "complaint", "plainte", "litige"], "complaint"],
  [["compte", "account", "guichet"], "account"],
  [["credit", "loan", "pret", "financement"], "credit"],
  [["epargne", "savings", "livret", "pee", "pel"], "savings"],
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
  "card",
  "cheque",
  "statement",
  "opposition",
  "payment",
  "contract",
  "mail",
  "info",
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
    case "card":
      // Carte bancaire avec puce (carte / carte prépayée / retrait de carte).
      return (
        <>
          <path d="M3 6h18v13H3z" />
          <path d="M6 10h4v3H6z" />
          <path d="M13 15h5" />
        </>
      );
    case "cheque":
      // Chèque : lignes d'écriture + paraphe de signature.
      return (
        <>
          <path d="M3 6h18v12H3z" />
          <path d="M6 10h7" />
          <path d="M6 13h4" />
          <path d="M14 14.5c1-1.5 2.5-1.5 3.5 0" />
        </>
      );
    case "statement":
      // Relevé : document à coin plié avec lignes.
      return (
        <>
          <path d="M6 3h9l3 3v15H6z" />
          <path d="M15 3v3h3" />
          <path d="M9 11h6" />
          <path d="M9 15h6" />
        </>
      );
    case "opposition":
      // Sens interdit (opposition / blocage carte ou chèque).
      return (
        <>
          <circle cx="12" cy="12" r="8" />
          <path d="M6.5 6.5l11 11" />
        </>
      );
    case "payment":
      // Billet de banque (paiement divers).
      return (
        <>
          <path d="M3 7h18v10H3z" />
          <circle cx="12" cy="12" r="2.5" />
          <path d="M6.5 12h.01" />
          <path d="M17.5 12h.01" />
        </>
      );
    case "contract":
      // Document + signe plus (souscription d'un nouveau produit).
      return (
        <>
          <path d="M6 3h9l3 3v15H6z" />
          <path d="M15 3v3h3" />
          <path d="M12 10v6" />
          <path d="M9 13h6" />
        </>
      );
    case "mail":
      // Enveloppe (dépôt de courriers).
      return (
        <>
          <path d="M3 6h18v12H3z" />
          <path d="M3 7l9 6 9-6" />
        </>
      );
    case "info":
      // Cercle « i » (demande d'informations).
      return (
        <>
          <circle cx="12" cy="12" r="8" />
          <path d="M12 11v5" />
          <path d="M12 8v.01" />
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
