/**
 * Set d'icônes SIGFA — artwork propriétaire (ICONS-001).
 *
 * Chaque icône est DESSINÉE à la main sur une grille 24 x 24 (aucune
 * dépendance externe) en deux couches duotone :
 * - `duo`  : formes pleines posées en `currentColor` (opacité appliquée par
 *   le composant `SigfaIcon`) — la profondeur premium ;
 * - `line` : trait principal 2 px arrondi en `currentColor`.
 *
 * Règle absolue : aucune couleur littérale ici — tout est thémable par token
 * via la couleur du parent (`color: var(--brand)` etc.).
 *
 * @module icons/paths
 */
import type { ReactNode } from "react";

/** Les deux couches duotone d'une icône. */
export interface IconArtwork {
  /** Formes pleines de fond (rendues en currentColor + opacite douce). */
  duo: ReactNode;
  /** Trait principal 2 px arrondi (rendu en currentColor plein). */
  line: ReactNode;
}

/** Contour du ticket a encoches — partage entre couche duo et trait. */
const TICKET_OUTLINE =
  "M6 5h12a1.5 1.5 0 0 1 1.5 1.5V9a3 3 0 0 0 0 6v2.5A1.5 1.5 0 0 1 18 19H6a1.5 1.5 0 0 1-1.5-1.5V15a3 3 0 0 0 0-6V6.5A1.5 1.5 0 0 1 6 5Z";

/** Silhouette du haut-parleur (audio). */
const SPEAKER_OUTLINE = "M4 9.3v5.4h3.2l4.8 4V5.3l-4.8 4H4Z";

/** Triangle d'alerte arrondi. */
const ALERT_OUTLINE =
  "M13.72 4.9a2 2 0 0 0-3.44 0L3.3 16.9A2 2 0 0 0 5.02 20h13.96a2 2 0 0 0 1.72-3.1L13.72 4.9Z";

/** Onde wifi (secteur plein pour la couche duo de hors-ligne). */
const WIFI_WEDGE = "M4.5 9.8a10.6 10.6 0 0 1 15 0L12 18.3Z";

/** Barres du graphique statistiques (gauche, milieu, droite). */
const BAR_1 =
  "M6 20.5v-6.3a1.1 1.1 0 0 1 1.1-1.1h1.2a1.1 1.1 0 0 1 1.1 1.1v6.3";
const BAR_2 =
  "M10.8 20.5V9.6a1.1 1.1 0 0 1 1.1-1.1h1.2a1.1 1.1 0 0 1 1.1 1.1v10.9";
const BAR_3 =
  "M15.6 20.5V5.4a1.1 1.1 0 0 1 1.1-1.1h1.2A1.1 1.1 0 0 1 19 5.4v15.1";

/**
 * Registre de l'artwork par nom d'icône.
 *
 * MÉTIER banque / file d'attente : ticket, guichet, file-attente, conseiller,
 * depot, retrait, virement, change-devises, credit, epargne, compte,
 * carte-bancaire, chequier, entreprise, international.
 * UI : imprimer, audio, langue, accessibilite, hors-ligne, valider, retour,
 * information, alerte, horloge, statistiques, parametres. Bonus : etoile
 * (jalon or, feedback 5 etoiles du design system).
 */
export const ICON_ARTWORK = {
  /* ── Métier banque / file d'attente ─────────────────────────────────── */

  // Ticket numéroté : ticket à encoches latérales portant un grand « 1 ».
  ticket: {
    duo: <path d={TICKET_OUTLINE} />,
    line: (
      <>
        <path d={TICKET_OUTLINE} />
        <path d="M10.8 9.9 13 8.3V16" />
      </>
    ),
  },

  // Guichet : personne derrière un comptoir.
  guichet: {
    duo: <path d="M3 14.5h18v5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 19.5v-5Z" />,
    line: (
      <>
        <circle cx="12" cy="7" r="3" />
        <path d="M7.5 14.5a4.5 4.5 0 0 1 9 0" />
        <path d="M3 14.5h18v5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 19.5v-5Z" />
      </>
    ),
  },

  // File d'attente : trois personnes alignées, la première mise en avant.
  "file-attente": {
    duo: (
      <>
        <circle cx="5.2" cy="8.2" r="2.4" />
        <path d="M1.8 19.5v-2.4a3.4 3.4 0 0 1 6.8 0v2.4Z" />
      </>
    ),
    line: (
      <>
        <circle cx="5.2" cy="8.2" r="2.4" />
        <path d="M1.8 19.5v-2.4a3.4 3.4 0 0 1 6.8 0v2.4" />
        <circle cx="12" cy="8.2" r="2.4" />
        <path d="M8.6 19.5v-2.4a3.4 3.4 0 0 1 6.8 0v2.4" />
        <circle cx="18.8" cy="8.2" r="2.4" />
        <path d="M15.4 19.5v-2.4a3.4 3.4 0 0 1 6.8 0v2.4" />
      </>
    ),
  },

  // Conseiller : personne avec badge nominatif.
  conseiller: {
    duo: (
      <>
        <circle cx="12" cy="7" r="3" />
        <rect x="14" y="14" width="6.5" height="5" rx="1" />
      </>
    ),
    line: (
      <>
        <circle cx="12" cy="7" r="3" />
        <path d="M5 20a7 7 0 0 1 14 0" />
        <rect x="14" y="14" width="6.5" height="5" rx="1" />
        <path d="M16 16.5h2.5" />
      </>
    ),
  },

  // Dépôt : billets entrant (flèche qui plonge dans le billet).
  depot: {
    duo: <rect x="3.5" y="11" width="17" height="8.5" rx="1.5" />,
    line: (
      <>
        <path d="M12 2.5V8" />
        <path d="m9.2 5.4 2.8 2.8 2.8-2.8" />
        <rect x="3.5" y="11" width="17" height="8.5" rx="1.5" />
        <circle cx="12" cy="15.25" r="2" />
        <path d="M6.9 15.25h.01M17.1 15.25h.01" />
      </>
    ),
  },

  // Retrait : billets sortant (flèche qui quitte le billet).
  retrait: {
    duo: <rect x="3.5" y="4.5" width="17" height="8.5" rx="1.5" />,
    line: (
      <>
        <rect x="3.5" y="4.5" width="17" height="8.5" rx="1.5" />
        <circle cx="12" cy="8.75" r="2" />
        <path d="M6.9 8.75h.01M17.1 8.75h.01" />
        <path d="M12 15.5v6" />
        <path d="m9.2 18.7 2.8 2.8 2.8-2.8" />
      </>
    ),
  },

  // Virement : flèches croisées entre deux comptes.
  virement: {
    duo: (
      <>
        <rect x="3" y="3.5" width="5.5" height="5.5" rx="1.5" />
        <rect x="15.5" y="15" width="5.5" height="5.5" rx="1.5" />
      </>
    ),
    line: (
      <>
        <rect x="3" y="3.5" width="5.5" height="5.5" rx="1.5" />
        <rect x="15.5" y="15" width="5.5" height="5.5" rx="1.5" />
        <path d="M11.5 6.25h9" />
        <path d="m17.5 3.25 3 3-3 3" />
        <path d="M12.5 17.75h-9" />
        <path d="m6.5 14.75-3 3 3 3" />
      </>
    ),
  },

  // Change de devises : pièce franc CFA, pièce euro et flèches d'échange.
  "change-devises": {
    duo: <circle cx="8" cy="8.6" r="4.6" />,
    line: (
      <>
        <circle cx="8" cy="8.6" r="4.6" />
        <path d="M6.9 10.9V6.3h2.8M6.9 8.6h2.2" />
        <circle cx="16" cy="16" r="4.6" />
        <path d="M17.9 14.4a2.4 2.4 0 1 0 0 3.2M14.5 16h2.6" />
        <path d="M14.5 3.5h5m-2.2-2 2.2 2-2.2 2" />
        <path d="M9.5 20.5h-5m2.2 2-2.2-2 2.2-2" />
      </>
    ),
  },

  // Crédit : billet au taux (pourcentage sur le billet).
  credit: {
    duo: <rect x="2.5" y="6.5" width="19" height="11" rx="1.5" />,
    line: (
      <>
        <rect x="2.5" y="6.5" width="19" height="11" rx="1.5" />
        <circle cx="8.6" cy="10.2" r="1.4" />
        <circle cx="15.4" cy="13.8" r="1.4" />
        <path d="m15.8 9.2-7.6 5.6" />
      </>
    ),
  },

  // Épargne : pièces empilées et pousse qui grandit (croissance).
  epargne: {
    duo: (
      <>
        <path d="M12 7.4c0-2.3 1.8-4.1 4.1-4.1 0 2.3-1.8 4.1-4.1 4.1Z" />
        <path d="M12 7.4c0-2.3-1.8-4.1-4.1-4.1 0 2.3 1.8 4.1 4.1 4.1Z" />
        <rect x="6" y="12.2" width="12" height="2.9" rx="1.45" />
        <rect x="6" y="15.4" width="12" height="2.9" rx="1.45" />
        <rect x="6" y="18.6" width="12" height="2.9" rx="1.45" />
      </>
    ),
    line: (
      <>
        <path d="M12 7.4c0-2.3 1.8-4.1 4.1-4.1 0 2.3-1.8 4.1-4.1 4.1Z" />
        <path d="M12 7.4c0-2.3-1.8-4.1-4.1-4.1 0 2.3 1.8 4.1 4.1 4.1Z" />
        <path d="M12 7.4v4.8" />
        <rect x="6" y="12.2" width="12" height="2.9" rx="1.45" />
        <rect x="6" y="15.4" width="12" height="2.9" rx="1.45" />
        <rect x="6" y="18.6" width="12" height="2.9" rx="1.45" />
      </>
    ),
  },

  // Compte : portefeuille avec poche à rabat.
  compte: {
    duo: <path d="M14 10.5h7v5h-7a2.5 2.5 0 0 1 0-5Z" />,
    line: (
      <>
        <rect x="3" y="6" width="18" height="13" rx="2" />
        <path d="M14 10.5h7v5h-7a2.5 2.5 0 0 1 0-5Z" />
        <path d="M16.6 13h.01" />
      </>
    ),
  },

  // Carte bancaire : puce, sans-contact et numéro embossé.
  "carte-bancaire": {
    duo: <rect x="2.5" y="5.5" width="19" height="13.5" rx="2" />,
    line: (
      <>
        <rect x="2.5" y="5.5" width="19" height="13.5" rx="2" />
        <rect x="5.5" y="9" width="4" height="3.5" rx="0.8" />
        <path d="M15.7 9.6a3.4 3.4 0 0 1 0 2.9" />
        <path d="M18.3 8.4a6.2 6.2 0 0 1 0 5.3" />
        <path d="M5.5 16h3M10.5 16h3" />
      </>
    ),
  },

  // Chéquier : carnet, lignes d'écriture et paraphe de signature.
  chequier: {
    duo: <rect x="2.5" y="7.5" width="17" height="12" rx="1.5" />,
    line: (
      <>
        <path d="M6 7.5V6a1.5 1.5 0 0 1 1.5-1.5H20A1.5 1.5 0 0 1 21.5 6v9.5" />
        <rect x="2.5" y="7.5" width="17" height="12" rx="1.5" />
        <path d="M6 12h7M6 15h4.5" />
        <path d="M12.5 16.8c.9-1.4 2.1-1.4 3 0 .6.9 1.4 1 2 .3" />
      </>
    ),
  },

  // Entreprise : siège et annexe, fenêtres éclairées.
  entreprise: {
    duo: <path d="M14 10h5a1.5 1.5 0 0 1 1.5 1.5V21H14V10Z" />,
    line: (
      <>
        <path d="M4 21V5a1.5 1.5 0 0 1 1.5-1.5h7A1.5 1.5 0 0 1 14 5v16" />
        <path d="M14 10h5a1.5 1.5 0 0 1 1.5 1.5V21" />
        <path d="M2.5 21h19" />
        <path d="M7 7.5h1.5M10.7 7.5h1.5M7 11h1.5M10.7 11h1.5M7 14.5h1.5" />
        <path d="M16.4 13.5h1.6M16.4 17h1.6" />
        <path d="M10.7 21v-3.5" />
      </>
    ),
  },

  // International : globe, méridien et équateur.
  international: {
    duo: <circle cx="12" cy="12" r="8.5" />,
    line: (
      <>
        <circle cx="12" cy="12" r="8.5" />
        <ellipse cx="12" cy="12" rx="4" ry="8.5" />
        <path d="M3.5 12h17" />
      </>
    ),
  },

  /* ── UI ─────────────────────────────────────────────────────────────── */

  // Imprimer : imprimante, page qui sort du bac.
  imprimer: {
    duo: <path d="M4.5 9h15A1.5 1.5 0 0 1 21 10.5v3H3v-3A1.5 1.5 0 0 1 4.5 9Z" />,
    line: (
      <>
        <path d="M7 9V3.5h10V9" />
        <path d="M6.5 17h-2A1.5 1.5 0 0 1 3 15.5v-5A1.5 1.5 0 0 1 4.5 9h15A1.5 1.5 0 0 1 21 10.5v5a1.5 1.5 0 0 1-1.5 1.5h-2" />
        <rect x="6.5" y="13.5" width="11" height="7" rx="0.8" />
        <path d="M9.5 17h5" />
        <path d="M17.6 12h.01" />
      </>
    ),
  },

  // Écouter / audio : haut-parleur et ondes (remplace le pictogramme borne).
  audio: {
    duo: <path d={SPEAKER_OUTLINE} />,
    line: (
      <>
        <path d={SPEAKER_OUTLINE} />
        <path d="M15.3 9.4a4.4 4.4 0 0 1 0 5.2" />
        <path d="M18.2 7a8.4 8.4 0 0 1 0 10" />
      </>
    ),
  },

  // Langue : deux bulles de dialogue (traduction FR/EN).
  langue: {
    duo: (
      <path d="M10.5 13a1.5 1.5 0 0 1 1.5-1.5h7.5A1.5 1.5 0 0 1 21 13v5a1.5 1.5 0 0 1-1.5 1.5h-.6V22l-3.1-2.5H12A1.5 1.5 0 0 1 10.5 18v-5Z" />
    ),
    line: (
      <>
        <path d="M3 4.5A1.5 1.5 0 0 1 4.5 3h8A1.5 1.5 0 0 1 14 4.5V10a1.5 1.5 0 0 1-1.5 1.5H8.2L5 14.2v-2.7h-.5A1.5 1.5 0 0 1 3 10V4.5Z" />
        <path d="M6.7 9.3 8.5 5l1.8 4.3M7.3 8h2.4" />
        <path d="M10.5 13a1.5 1.5 0 0 1 1.5-1.5h7.5A1.5 1.5 0 0 1 21 13v5a1.5 1.5 0 0 1-1.5 1.5h-.6V22l-3.1-2.5H12A1.5 1.5 0 0 1 10.5 18v-5Z" />
        <path d="M13.4 15.5h.01M15.75 15.5h.01M18.1 15.5h.01" />
      </>
    ),
  },

  // Accessibilité : personne aux bras ouverts dans un cercle.
  accessibilite: {
    duo: <circle cx="12" cy="12" r="9" />,
    line: (
      <>
        <circle cx="12" cy="12" r="9" />
        <circle cx="12" cy="6.9" r="1.2" />
        <path d="M7 10c3.3 1 6.7 1 10 0" />
        <path d="M12 10.8v3.6" />
        <path d="M12 14.4 9.4 19.2M12 14.4l2.6 4.8" />
      </>
    ),
  },

  // Hors-ligne : ondes wifi barrées.
  "hors-ligne": {
    duo: <path d={WIFI_WEDGE} />,
    line: (
      <>
        <path d="M4.5 9.8a10.6 10.6 0 0 1 15 0" />
        <path d="M7.7 13a6.2 6.2 0 0 1 8.6 0" />
        <circle cx="12" cy="16.8" r="1.2" />
        <path d="M4 4l16 16" />
      </>
    ),
  },

  // Valider : coche dans un cercle.
  valider: {
    duo: <circle cx="12" cy="12" r="9" />,
    line: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="m7.8 12.4 2.9 2.9 5.7-5.8" />
      </>
    ),
  },

  // Retour : flèche qui revient en arrière.
  retour: {
    duo: <path d="M9 6v9l-4.5-4.5L9 6Z" />,
    line: (
      <>
        <path d="M9 6l-4.5 4.5L9 15" />
        <path d="M4.5 10.5h10.7a4.6 4.6 0 0 1 0 9.2H9" />
      </>
    ),
  },

  // Information : cercle « i ».
  information: {
    duo: <circle cx="12" cy="12" r="9" />,
    line: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 11.2v5.3" />
        <path d="M12 7.6h.01" />
      </>
    ),
  },

  // Alerte : triangle avec point d'exclamation.
  alerte: {
    duo: <path d={ALERT_OUTLINE} />,
    line: (
      <>
        <path d={ALERT_OUTLINE} />
        <path d="M12 9.5v4.2" />
        <path d="M12 16.9h.01" />
      </>
    ),
  },

  // Horloge / attente : cadran et aiguilles.
  horloge: {
    duo: <circle cx="12" cy="12" r="8.5" />,
    line: (
      <>
        <circle cx="12" cy="12" r="8.5" />
        <path d="M12 7.2V12l3.4 2" />
      </>
    ),
  },

  // Statistiques : barres ascendantes sur ligne de base.
  statistiques: {
    duo: (
      <>
        <path d={`${BAR_1}Z`} />
        <path d={`${BAR_2}Z`} />
        <path d={`${BAR_3}Z`} />
      </>
    ),
    line: (
      <>
        <path d="M3.5 20.5h17" />
        <path d={BAR_1} />
        <path d={BAR_2} />
        <path d={BAR_3} />
      </>
    ),
  },

  // Paramètres : trois curseurs de réglage.
  parametres: {
    duo: (
      <>
        <circle cx="9.5" cy="7" r="2.2" />
        <circle cx="15" cy="12" r="2.2" />
        <circle cx="7.5" cy="17" r="2.2" />
      </>
    ),
    line: (
      <>
        <path d="M3.5 7h3.8M12.2 7h8.3" />
        <circle cx="9.5" cy="7" r="2.2" />
        <path d="M3.5 12h9.3M17.7 12h2.8" />
        <circle cx="15" cy="12" r="2.2" />
        <path d="M3.5 17h1.8M10.2 17h10.3" />
        <circle cx="7.5" cy="17" r="2.2" />
      </>
    ),
  },

  // Étoile : jalon or / feedback 5 etoiles (design system).
  etoile: {
    duo: (
      <path d="m12 3.5 2.5 5.2 5.7.7-4.2 4 1.1 5.6L12 16.3 6.9 19 8 13.4l-4.2-4 5.7-.7L12 3.5Z" />
    ),
    line: (
      <path d="m12 3.5 2.5 5.2 5.7.7-4.2 4 1.1 5.6L12 16.3 6.9 19 8 13.4l-4.2-4 5.7-.7L12 3.5Z" />
    ),
  },
} satisfies Record<string, IconArtwork>;
