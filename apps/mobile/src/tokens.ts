// tokens.ts — Design System SIGFA v2 « Sérénité Premium » (miroir React Native).
//
// STRATÉGIE TOKENS (contrainte MOB-001 / Metro) :
//   Le package `@sigfa/ui` est `"type":"module"` avec des composants DOM et
//   `react@19` en peer — l'importer sous Metro/Jest (react@18) est fragile.
//   Conformément à la directive de refonte, ce module est un MIROIR FIDÈLE des
//   VALEURS de `packages/ui/src/tokens.ts` (palette « Or & Forêt », rayons,
//   ombres, espacements, échelle typo). Toute valeur hex vit ICI uniquement ;
//   aucun composant mobile ne code de couleur en dur.
//
// Les clés historiques (`colors.surface0/surface1/inkStrong/…`, `spacing.xs…`,
// `radius.card/button/badge`, `fontSize.display/title/body/caption`,
// `minTouchTarget`) sont CONSERVÉES (contrat de test MOB-001) mais leurs
// valeurs sont remappées sur la palette v2. Les nouveaux jetons v2 (night, or,
// forêt, ombres chaudes) sont ajoutés à côté.

export const tokens = {
  colors: {
    // — Surfaces chaudes (base « papier ivoire », jamais gris clinique) —
    surface0: '#FBF8F3', // --paper (fond principal)
    surface1: '#FFFFFF', // --surface-1 (cartes)
    surface2: '#F4EEE4', // --surface-2 (champs au repos, sections)
    hairline: '#ECE3D6', // --hairline (séparateurs 1px)

    // — Encre chaude —
    inkStrong: '#1A130C', // --ink (brun-noir chaud, pas bleuté)
    inkSoft: '#6B5D4F', // --ink-soft (taupe chaud)
    inkFaint: '#A99C8B', // --ink-faint (placeholder, métadonnées)
    inkInverse: '#FBF6EE', // --ink-inverse (texte sur sombre — blanc chaud)
    inkInverseSoft: '#B8AB98', // --ink-inverse-soft

    // — Sombre (moments forts « Ticket vivant ») —
    night: '#16110B', // --night (brun-nuit qui fait vibrer l'or)
    night2: '#0E0A06', // --night-2

    // — Marque « Or & Forêt » (identité ivoirienne premium) —
    brand: '#C25A16', // --brand (terracotta/ambre brûlé)
    brandStrong: '#9C400C', // --brand-strong (pressé)
    brandSoft: '#F7E7D6', // --brand-soft (fonds de badge, surbrillance douce)
    brandContrast: '#FFFFFF', // --brand-contrast
    forest: '#0F6B4A', // --forest (confiance, « servi »)
    forestSoft: '#DBEFE6', // --forest-soft
    gold: '#C79A3A', // --gold (accents premium, jalons, 5★)
    goldSoft: '#F6ECD2', // --gold-soft

    // — Sémantiques (harmonisées à la palette chaude) —
    success: '#0F7A4D', // --success (= forest cohérent)
    successSoft: '#DBEFE6',
    warning: '#C77D0A', // --warning (ambre, pas orange criard)
    warningSoft: '#F9EBD1',
    danger: '#C0362C', // --danger (rouge terre, jamais fluo)
    dangerSoft: '#F7DED9',
    info: '#2C6E9B', // --info (bleu ardoise doux, offline)
    infoSoft: '#DCEAF3',
  },

  // Espacement — base 4, généreux (respiration = signal premium n°1).
  // Clés historiques conservées (contrat test MOB-001).
  spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48, xxxxl: 64 },

  // Rayons v2 : sm 8 / md 12 (champs, boutons) / lg 18 (cartes) / xl 28 (moments forts).
  // Alias historiques (card/button/badge) conservés + valeurs v2 nommées.
  radius: {
    card: 18, // --r-lg (v2 : cartes = 18)
    button: 12, // --r-md (champs, boutons)
    badge: 999, // --r-full
    sm: 8, // --r-sm
    md: 12, // --r-md
    lg: 18, // --r-lg
    xl: 28, // --r-xl (feuilles, « Moment Ticket »)
    full: 999, // --r-full
  },

  // Échelle typo (modulaire 1.25, base 16). Alias historiques conservés + échelle v2.
  fontSize: {
    display: 32, // grand nombre mobile
    title: 20, // --text-lg
    body: 15,
    caption: 13,
    // Échelle v2 nommée
    xs: 12,
    sm: 14,
    md: 16,
    lg: 20,
    xl: 25,
    '2xl': 31,
    '3xl': 39,
    '4xl': 49,
    hero: 64, // numéro de ticket « Moment Ticket » sur mobile
  },

  // Ombres chaudes v2 (teintées brun, jamais noir pur). Format RN.
  shadow: {
    // --shadow-1 : cartes au repos
    card: {
      shadowColor: '#1A130C',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.08,
      shadowRadius: 8,
      elevation: 2,
    },
    // --shadow-2 : cartes survolées / sections
    raised: {
      shadowColor: '#1A130C',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.1,
      shadowRadius: 14,
      elevation: 4,
    },
    // --shadow-3 : feuilles, moments forts
    lifted: {
      shadowColor: '#1A130C',
      shadowOffset: { width: 0, height: 12 },
      shadowOpacity: 0.14,
      shadowRadius: 28,
      elevation: 8,
    },
    // --shadow-brand : bouton primaire = présence
    brand: {
      shadowColor: '#C25A16',
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.28,
      shadowRadius: 20,
      elevation: 6,
    },
    // --shadow-gold : halo du numéro au « Moment Ticket »
    gold: {
      shadowColor: '#C79A3A',
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0.45,
      shadowRadius: 40,
      elevation: 10,
    },
  },

  minTouchTarget: 44, // mobile — pouce d'abord (kiosque = 72)
} as const;

export type Tokens = typeof tokens;
