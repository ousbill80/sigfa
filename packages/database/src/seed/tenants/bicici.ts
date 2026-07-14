/**
 * Config du tenant de démonstration/test « BICICI » (Banque Internationale pour
 * le Commerce et l'Industrie de la Côte d'Ivoire — réseau réel, données publiques).
 *
 * RÈGLE PRODUIT : tout ce qui est spécifique BICICI vit ICI (fichier de config
 * de seed) — jamais dans le code applicatif. Le branding passe par la colonne
 * `banks.theme` (jsonb), le token CSS `--brand` (dérivé côté front) et les env
 * vars kiosk (`NEXT_PUBLIC_BANK_LOGO_URL=/tenants/bicici/logo.png`).
 *
 * Sources des agences : site officiel bicici.ci (« Nos agences ») et annuaires
 * publics ivoiriens (Go Africa Online) — consultés 2026-07.
 *
 * ## Horaires
 * Horaires standard BICICI : Lun–Ven 08:00–12:00 puis 13:45–15:45 ; certaines
 * agences ouvertes Sam 07:15–13:00. Le schéma `weekly_schedule` ne supporte
 * QU'UNE plage {start,end} par jour → on modélise Lun–Ven 08:00–15:45
 * (la pause méridienne 12:00–13:45 n'est pas représentable aujourd'hui).
 *
 * Activation : `SEED_TENANTS=bicici` (cumulable : `SEED_TENANTS=demo,bicici`).
 *
 * Logo : `assets/tenants/bicici/logo.png`, synchronisé vers les dossiers
 * `public/` des apps par `scripts/sync-tenant-assets.mjs` (URL servable
 * `/tenants/bicici/logo.png` — valeur de config ci-dessous, jamais en dur
 * dans les composants).
 *
 * @module
 */

import type { TenantAgencyConfig, TenantSeedConfig } from "src/seed/tenant-seed.js";
import type { WeeklySchedule } from "src/schema/agencies.js";

/** UUID déterministe de la banque BICICI (préfixe distinct du tenant démo). */
export const BICICI_BANK_ID = "b1c1c100-1111-4000-8000-000000000001";

/** Génère l'UUID déterministe de la n-ième agence BICICI (1..99). */
function biciciAgencyId(n: number): string {
  return `b1c1c101-1111-4000-8000-0000000000${String(n).padStart(2, "0")}`;
}

/** Génère l'UUID déterministe du n-ième guichet BICICI (1..99). */
function biciciCounterId(n: number): string {
  return `b1c1c102-1111-4000-8000-0000000000${String(n).padStart(2, "0")}`;
}

/** Génère l'UUID déterministe de la n-ième borne BICICI (1..99). */
function biciciKioskId(n: number): string {
  return `b1c1c103-1111-4000-8000-0000000000${String(n).padStart(2, "0")}`;
}

/**
 * Semaine standard BICICI Lun–Ven.
 * Réel : 08:00–12:00 et 13:45–15:45 — une seule plage supportée par jour,
 * donc 08:00–15:45 (voir note d'en-tête).
 */
const WEEKDAYS_STANDARD: WeeklySchedule = {
  monday: { start: "08:00", end: "15:45" },
  tuesday: { start: "08:00", end: "15:45" },
  wednesday: { start: "08:00", end: "15:45" },
  thursday: { start: "08:00", end: "15:45" },
  friday: { start: "08:00", end: "15:45" },
};

/** Semaine standard + samedi matin (agences ouvertes le samedi 07:15–13:00). */
const WEEKDAYS_PLUS_SATURDAY: WeeklySchedule = {
  ...WEEKDAYS_STANDARD,
  saturday: { start: "07:15", end: "13:00" },
};

/**
 * Les 16 agences BICICI seedées (toutes à Abidjan sauf San Pedro, Bouaké,
 * Daloa — timezone Africa/Abidjan par défaut du moteur).
 * Guichets + borne kiosque sur les 2 premières agences (même volume que le
 * tenant démo) ; les autres n'ont que l'agence.
 */
const BICICI_AGENCIES: ReadonlyArray<TenantAgencyConfig> = [
  {
    id: biciciAgencyId(1),
    name: "Agence Plateau Siège",
    city: "Abidjan",
    address: "Avenue Franchet d'Espérey, Plateau",
    phone: "+225 27 20 20 16 00",
    weeklySchedule: WEEKDAYS_PLUS_SATURDAY,
    counters: [
      { id: biciciCounterId(1), number: 1, label: "Guichet 1" },
      { id: biciciCounterId(2), number: 2, label: "Guichet 2" },
    ],
    kiosks: [{ id: biciciKioskId(1), label: "Borne Accueil - Plateau Siège" }],
  },
  {
    id: biciciAgencyId(2),
    name: "Agence Plateau Noguès",
    city: "Abidjan",
    address: "Avenue Noguès, Résidence Nabil, Plateau",
    weeklySchedule: WEEKDAYS_STANDARD,
    counters: [
      { id: biciciCounterId(3), number: 1, label: "Guichet 1" },
      { id: biciciCounterId(4), number: 2, label: "Guichet 2" },
    ],
    kiosks: [{ id: biciciKioskId(2), label: "Borne Accueil - Plateau Noguès" }],
  },
  {
    id: biciciAgencyId(3),
    name: "Centre d'affaires Abidjan Sud",
    city: "Abidjan",
    address: "89 Boulevard de Marseille, Marcory",
    weeklySchedule: WEEKDAYS_STANDARD,
  },
  {
    id: biciciAgencyId(4),
    name: "Agence Marcory",
    city: "Abidjan",
    address: "Marcory",
    weeklySchedule: WEEKDAYS_STANDARD,
  },
  {
    id: biciciAgencyId(5),
    name: "Agence Cocody Deux Plateaux Vallon",
    city: "Abidjan",
    address: "Cocody",
    weeklySchedule: WEEKDAYS_STANDARD,
  },
  {
    id: biciciAgencyId(6),
    name: "Agence Cocody Deux Plateaux Latrille",
    city: "Abidjan",
    address: "Cocody",
    weeklySchedule: WEEKDAYS_STANDARD,
  },
  {
    id: biciciAgencyId(7),
    name: "Agence Riviera Cap Nord",
    city: "Abidjan",
    address: "Centre commercial Cap Nord, Riviera, Cocody",
    weeklySchedule: WEEKDAYS_STANDARD,
  },
  {
    id: biciciAgencyId(8),
    name: "Agence Cocody Cité des Arts",
    city: "Abidjan",
    address: "Cocody",
    weeklySchedule: WEEKDAYS_STANDARD,
  },
  {
    id: biciciAgencyId(9),
    name: "Agence Yopougon Keneya",
    city: "Abidjan",
    address: "Rue principale, Yopougon",
    weeklySchedule: WEEKDAYS_STANDARD,
  },
  {
    id: biciciAgencyId(10),
    name: "Agence Abobo",
    city: "Abidjan",
    address: "Face CI Telecom, Abobo",
    weeklySchedule: WEEKDAYS_PLUS_SATURDAY,
  },
  {
    id: biciciAgencyId(11),
    name: "Agence Adjamé",
    city: "Abidjan",
    address: "Boulevard Nangui Abrogoua, Adjamé",
    weeklySchedule: WEEKDAYS_PLUS_SATURDAY,
  },
  {
    id: biciciAgencyId(12),
    name: "Agence Treichville",
    city: "Abidjan",
    address: "Treichville",
    weeklySchedule: WEEKDAYS_STANDARD,
  },
  {
    id: biciciAgencyId(13),
    name: "Agence Koumassi",
    city: "Abidjan",
    address: "Koumassi",
    weeklySchedule: WEEKDAYS_STANDARD,
  },
  {
    id: biciciAgencyId(14),
    name: "Agence San Pedro",
    city: "San Pedro",
    weeklySchedule: WEEKDAYS_STANDARD,
  },
  {
    id: biciciAgencyId(15),
    name: "Agence Bouaké",
    city: "Bouaké",
    weeklySchedule: WEEKDAYS_STANDARD,
  },
  {
    id: biciciAgencyId(16),
    name: "Agence Daloa",
    city: "Daloa",
    weeklySchedule: WEEKDAYS_STANDARD,
  },
];

/**
 * Tenant BICICI — branding et réseau d'agences en CONFIG uniquement.
 * Vert BICICI #005e42 extrait du logo officiel ; secondary = vert dérivé plus
 * clair ; le contraste WCAG (≥4.5:1) est corrigé par le moteur (`appliedColors`).
 */
export const BICICI_TENANT: TenantSeedConfig = {
  idNamespace: "bicici",
  bankId: BICICI_BANK_ID,
  name: "BICICI",
  slug: "bicici",
  // Comptes de TEST uniquement (sous-domaine de démo SIGFA — jamais @bicici.ci).
  userEmailDomain: "bicici.sigfa-demo.ci",
  theme: {
    requestedColors: {
      primary: "#005e42", // vert BICICI (logo officiel)
      secondary: "#007a55", // vert dérivé plus clair (cohérence de marque)
      background: "#ffffff",
    },
    // FR/EN uniquement (décision PO 2026-07).
    welcomeMessages: {
      fr: "Bienvenue à la BICICI",
      en: "Welcome to BICICI",
    },
    logoUrl: "/tenants/bicici/logo.png",
  },
  agencies: BICICI_AGENCIES,
  // Conseillers publics fictifs (MODEL-DB-B) — aucune personne réelle.
  relationshipManagers: {
    AGENT: {
      displayName: "Mariam Ouattara",
      photoUrl: "https://cdn.sigfa-demo.ci/managers/mariam-ouattara.jpg",
    },
    MANAGER: {
      displayName: "Yao Kouassi",
      photoUrl: "https://cdn.sigfa-demo.ci/managers/yao-kouassi.jpg",
    },
  },
};
