/**
 * Config du tenant de DÉMONSTRATION SIGFA — extraction fidèle de l'ancien
 * `seedDemoTenant()` (DB-003/DB-009). NON-RÉGRESSION : mêmes UUIDs, mêmes
 * agences, mêmes guichets/kiosque, mêmes emails (`@sigfa-demo.ci`), mêmes
 * conseillers publics, même config WhatsApp. Seul ajout : un thème explicite
 * (couleurs neutres SIGFA + messages d'accueil FR/EN), auparavant `{}`.
 *
 * Activation : `SEED_TENANTS=demo` (ou rétro-compat `SEED_DEMO=1`).
 *
 * @module
 */

import type { TenantSeedConfig } from "src/seed/tenant-seed.js";

/** UUIDs déterministes de démo (stables entre exécutions — historiques DB-003). */
export const DEMO_BANK_ID = "d0000000-1111-4000-8000-000000000001";
/** Agence 1 (Centre). */
export const DEMO_AGENCY_1_ID = "d0000001-1111-4000-8000-000000000001";
/** Agence 2 (Plateau). */
export const DEMO_AGENCY_2_ID = "d0000001-1111-4000-8000-000000000002";
/** Guichet 1 de l'agence 1. */
export const DEMO_COUNTER_1_ID = "d0000002-1111-4000-8000-000000000001";
/** Guichet 2 de l'agence 1. */
export const DEMO_COUNTER_2_ID = "d0000002-1111-4000-8000-000000000002";
/** Borne kiosque de l'agence 1. */
export const DEMO_KIOSK_1_ID = "d0000003-1111-4000-8000-000000000001";

/**
 * Tenant de démonstration SIGFA (banque fictive — aucune donnée réelle).
 * `idNamespace: "demo"` conserve les IDs déterministes historiques
 * (`demo-service-…`, `demo-user-…`).
 */
export const DEMO_TENANT: TenantSeedConfig = {
  idNamespace: "demo",
  bankId: DEMO_BANK_ID,
  name: "Banque de Démonstration SIGFA",
  slug: "demo-sigfa",
  userEmailDomain: "sigfa-demo.ci",
  theme: {
    // Couleurs neutres SIGFA (config de démo — modifiables par la banque via API-009).
    requestedColors: {
      primary: "#1d4ed8",
      secondary: "#475569",
      background: "#ffffff",
    },
    welcomeMessages: {
      fr: "Bienvenue à la Banque de Démonstration SIGFA",
      en: "Welcome to the SIGFA Demo Bank",
    },
  },
  agencies: [
    {
      id: DEMO_AGENCY_1_ID,
      name: "Agence Centre - Démo",
      city: "Abidjan",
      counters: [
        { id: DEMO_COUNTER_1_ID, number: 1, label: "Guichet 1" },
        { id: DEMO_COUNTER_2_ID, number: 2, label: "Guichet 2" },
      ],
      kiosks: [{ id: DEMO_KIOSK_1_ID, label: "Borne Accueil - Démo" }],
    },
    {
      id: DEMO_AGENCY_2_ID,
      name: "Agence Plateau - Démo",
      city: "Abidjan",
    },
  ],
  relationshipManagers: {
    AGENT: {
      displayName: "Awa Koné",
      photoUrl: "https://cdn.sigfa-demo.ci/managers/awa-kone.jpg",
    },
    MANAGER: {
      displayName: "Kouadio N'Guessan",
      photoUrl: "https://cdn.sigfa-demo.ci/managers/kouadio-nguessan.jpg",
    },
  },
  whatsapp: {
    businessNumber: "+2250700000000",
    webhookSecret: "demo-whatsapp-webhook-secret",
    defaultAgencyId: DEMO_AGENCY_1_ID,
    menuMappings: [{ keyword: "1", agencyId: DEMO_AGENCY_1_ID, serviceCode: "OC" }],
  },
};
