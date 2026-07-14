/**
 * Matrice RBAC versionnée SIGFA — DB-003
 *
 * Source : SIGFA_PROMPT_v5.md §MODULE 4 — Matrice des droits.
 * Consommable par l'API (API-001/002 — hors scope F2) comme source de vérité des droits.
 *
 * ATTENTION — EXCLUDED (volontaire, documenté) :
 *   - `NONE` : convention de route "accès public" — JAMAIS persisté en base.
 *   - `AUTHENTICATED` : convention de route "authentifié" — JAMAIS persisté en base.
 *   Ces deux valeurs sont des sentinelles de routage Hono/middleware ;
 *   elles n'ont aucune représentation dans `pg_enum role`.
 *   Voir aussi : `enums.ts` ligne 81 et le test d'alignement `enums.test.ts`.
 *
 * @module
 */

/**
 * Actions RBAC SIGFA (v5 §MODULE 4 — Matrice des droits).
 * Chaque action correspond à une ligne de la matrice officielle.
 */
export type RbacAction =
  | "create_bank"          // Créer une banque
  | "create_agency"        // Créer une agence
  | "configure_services"   // Configurer services
  | "manage_agents"        // Gérer agents
  | "dashboard_realtime"   // Dashboard temps réel
  | "process_tickets"      // Traiter tickets
  | "view_reports"         // Voir rapports
  | "export_data";         // Export données

/**
 * Droits d'un rôle pour toutes les actions RBAC.
 * `true` = autorisé, `false` = refusé.
 */
export type RolePermissions = Record<RbacAction, boolean>;

/**
 * Rôles persistables en base de données (sous-ensemble strict de LA LOI `Role`).
 *
 * NONE et AUTHENTICATED sont EXPLICITEMENT exclus :
 *   - NONE = accès public (convention de route, pas de rôle utilisateur)
 *   - AUTHENTICATED = tout utilisateur connecté (convention de route)
 * Ces deux valeurs n'ont aucune représentation dans pg_enum `role`.
 */
export const PERSISTABLE_ROLES = [
  "SUPER_ADMIN",
  "BANK_ADMIN",
  "AGENCY_DIRECTOR",
  "MANAGER",
  "AGENT",
  "AUDITOR",
] as const;

/** Type union des rôles persistables. */
export type PersistableRole = (typeof PERSISTABLE_ROLES)[number];

/**
 * Matrice des droits SIGFA v5 §MODULE 4 — 6 rôles × 8 actions.
 * Légende : X = autorisé · - = refusé.
 *
 * | Action              | SUPER_ADMIN | BANK_ADMIN | AGENCY_DIRECTOR | MANAGER | AGENT | AUDITOR |
 * |---------------------|:-----------:|:----------:|:---------------:|:-------:|:-----:|:-------:|
 * | create_bank         | X          | -         | -              | -      | -    | -      |
 * | create_agency       | X          | X         | -              | -      | -    | -      |
 * | configure_services  | X          | X         | X              | -      | -    | -      |
 * | manage_agents       | X          | X         | X              | -      | -    | -      |
 * | dashboard_realtime  | X          | X         | X              | X      | -    | X      |
 * | process_tickets     | -          | -         | -              | -      | X    | -      |
 * | view_reports        | X          | X         | X              | X      | -    | X      |
 * | export_data         | X          | X         | X              | -      | -    | X      |
 *
 * Source : SIGFA_PROMPT_v5.md §MODULE 4 — Matrice des droits (recopie fidèle).
 */
export const RBAC_MATRIX: Record<PersistableRole, RolePermissions> = {
  /**
   * SUPER_ADMIN — Éditeur SIGFA.
   * Accès total sauf traitement de tickets (réservé aux agents).
   */
  SUPER_ADMIN: {
    create_bank: true,
    create_agency: true,
    configure_services: true,
    manage_agents: true,
    dashboard_realtime: true,
    process_tickets: false,
    view_reports: true,
    export_data: true,
  },

  /**
   * BANK_ADMIN — DSI / Admin banque.
   * Peut tout faire sur son tenant sauf créer une banque et traiter des tickets.
   */
  BANK_ADMIN: {
    create_bank: false,
    create_agency: true,
    configure_services: true,
    manage_agents: true,
    dashboard_realtime: true,
    process_tickets: false,
    view_reports: true,
    export_data: true,
  },

  /**
   * AGENCY_DIRECTOR — Directeur d'agence.
   * Configure les services et gère les agents de son agence ; accès lecture étendu.
   */
  AGENCY_DIRECTOR: {
    create_bank: false,
    create_agency: false,
    configure_services: true,
    manage_agents: true,
    dashboard_realtime: true,
    process_tickets: false,
    view_reports: true,
    export_data: true,
  },

  /**
   * MANAGER — Superviseur.
   * Dashboard temps réel + rapports, sans configuration ni gestion d'agents.
   */
  MANAGER: {
    create_bank: false,
    create_agency: false,
    configure_services: false,
    manage_agents: false,
    dashboard_realtime: true,
    process_tickets: false,
    view_reports: true,
    export_data: false,
  },

  /**
   * AGENT — Agent de guichet.
   * Traite les tickets uniquement — interface simplifiée 3 boutons.
   */
  AGENT: {
    create_bank: false,
    create_agency: false,
    configure_services: false,
    manage_agents: false,
    dashboard_realtime: false,
    process_tickets: true,
    view_reports: false,
    export_data: false,
  },

  /**
   * AUDITOR — Lecture seule.
   * Accès aux rapports et à l'export de données ; aucune écriture.
   */
  AUDITOR: {
    create_bank: false,
    create_agency: false,
    configure_services: false,
    manage_agents: false,
    dashboard_realtime: true,
    process_tickets: false,
    view_reports: true,
    export_data: true,
  },
} as const;
