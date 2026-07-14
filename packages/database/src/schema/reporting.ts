import { isNull, isNotNull } from "drizzle-orm";
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  date,
  integer,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { banks } from "./banks.js";
import { agencies } from "./agencies.js";
import { services } from "./services.js";

// ─────────────────────────────────────────────────────────────────────────────
// Enum DB-006 (aligné LA LOI reporting.yaml)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Statut d'un job d'export asynchrone (LA LOI `ExportJobStatus`, 4 valeurs).
 *
 * - `PENDING`    : job créé, en attente de traitement
 * - `PROCESSING` : traitement en cours
 * - `READY`      : fichier disponible (`file_url` non null)
 * - `FAILED`     : échec de génération
 *
 * SOURCE : DB-006 / reporting.yaml
 */
export const exportJobStatusEnum = pgEnum("export_job_status", [
  "PENDING",
  "PROCESSING",
  "READY",
  "FAILED",
]);

// ─────────────────────────────────────────────────────────────────────────────
// Table 1 : daily_agency_stats
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `daily_agency_stats` — agrégats journaliers matérialisés par agence (DB-006).
 *
 * ## Conformité AnonymizedNetworkAggregate
 * AUCUN champ personnel : pas de `agent_id`, `user_id`, `phone`, `email` en clair.
 * Table d'agrégats purs — conformité RGPD/UEMOA.
 *
 * ## Mesures source des 7 KPIs de LA LOI
 * Les formules exactes vivent dans REP-001 (API) :
 * 1. TMA   = `total_wait_seconds / tickets_served`
 * 2. TMT   = `total_service_seconds / tickets_served`
 * 3. TTS   = `tickets_served / tickets_issued`
 * 4. Abandon = `tickets_abandoned / tickets_issued`
 * 5. SLA   = `sla_met_count / sla_total_count`
 * 6. NPS   = `(nps_promoters - nps_detractors) / (nps_promoters + nps_passives + nps_detractors) * 100`
 * 7. Occupation = `agent_active_seconds / (agents × durée_journée)`
 *
 * ## Unicité (deux index uniques partiels)
 * - `(bank_id, agency_id, day) WHERE service_id IS NULL` — agrégat toutes services
 * - `(bank_id, agency_id, service_id, day) WHERE service_id IS NOT NULL` — agrégat par service
 *
 * ## Décision d'audit (DB-006)
 * `daily_agency_stats` est EXCLUE de AUDITED_TABLES (liste dans 0003_audit_log.sql) car :
 * - C'est une table d'agrégats à volume élevé (recalcul quotidien par cron)
 * - Les mutations sont idempotentes (upsert) — un diff d'audit n'apporterait pas de valeur
 * - La source de vérité reste `tickets` (auditée applicativement via insertAuditEntry)
 *
 * ## RLS
 * Policy `tenant_isolation` (bank_id = app.current_bank_id).
 */
export const dailyAgencyStats = pgTable(
  "daily_agency_stats",
  {
    /** Identifiant unique de la ligne d'agrégat. */
    id: uuid("id").primaryKey().defaultRandom(),
    /** Tenant — banque propriétaire (FK RESTRICT). */
    bankId: uuid("bank_id")
      .notNull()
      /* v8 ignore next — callback de résolution lazy FK Drizzle (pure DSL, non instrumentable) */
      .references(() => banks.id, { onDelete: "restrict" }),
    /** Agence concernée (FK RESTRICT). */
    agencyId: uuid("agency_id")
      .notNull()
      /* v8 ignore next — callback de résolution lazy FK Drizzle (pure DSL, non instrumentable) */
      .references(() => agencies.id, { onDelete: "restrict" }),
    /**
     * Service concerné (FK RESTRICT, optionnel).
     * NULL = agrégat toutes services de l'agence confondus.
     * NOT NULL = agrégat par service spécifique.
     */
    /* v8 ignore next — callback de résolution lazy FK Drizzle (pure DSL, non instrumentable) */
    serviceId: uuid("service_id").references(() => services.id, { onDelete: "restrict" }),
    /**
     * Jour de l'agrégat — date locale Africa/Abidjan.
     * Aligné sur `tickets.issued_day` (calculé en timezone Africa/Abidjan).
     */
    day: date("day").notNull(),
    // ── Mesures KPI de LA LOI ─────────────────────────────────────────────────
    /** Nombre de tickets émis dans la journée. */
    ticketsIssued: integer("tickets_issued").notNull().default(0),
    /** Nombre de tickets servis (status DONE). */
    ticketsServed: integer("tickets_served").notNull().default(0),
    /** Nombre de tickets abandonnés (status ABANDONED). */
    ticketsAbandoned: integer("tickets_abandoned").notNull().default(0),
    /** Nombre de tickets non-présentés (status NO_SHOW). */
    ticketsNoShow: integer("tickets_no_show").notNull().default(0),
    /**
     * Somme des temps d'attente en secondes (KPI TMA : total_wait_seconds / tickets_served).
     * Source : `tickets.wait_time_seconds` (calculé par l'API lors de la transition CALLED→SERVING).
     */
    totalWaitSeconds: integer("total_wait_seconds").notNull().default(0),
    /**
     * Somme des temps de service en secondes (KPI TMT : total_service_seconds / tickets_served).
     * Source : `tickets.service_time_seconds` (calculé par l'API lors de la transition SERVING→DONE).
     */
    totalServiceSeconds: integer("total_service_seconds").notNull().default(0),
    /**
     * Nombre de tickets ayant respecté le SLA (KPI taux SLA : sla_met_count / sla_total_count).
     * Un ticket respecte le SLA si `wait_time_seconds ≤ service.sla_minutes * 60`.
     */
    slaMetCount: integer("sla_met_count").notNull().default(0),
    /** Nombre total de tickets éligibles au calcul SLA (tous les tickets servis). */
    slaTotalCount: integer("sla_total_count").notNull().default(0),
    /** Nombre de tickets avec feedback (score non null). */
    feedbackCount: integer("feedback_count").notNull().default(0),
    /** Somme des scores de feedback (pour calcul de la moyenne côté API). */
    feedbackSum: integer("feedback_sum").notNull().default(0),
    /**
     * Nombre de promoteurs NPS (score 5 sur 5 → promoteur).
     * NPS = (nps_promoters - nps_detractors) / total_avec_feedback * 100.
     * Convention SIGFA : score 5 = promoteur, score 4 = passif, score ≤ 3 = détracteur.
     */
    npsPromoters: integer("nps_promoters").notNull().default(0),
    /** Nombre de passifs NPS (score 4 sur 5). */
    npsPassives: integer("nps_passives").notNull().default(0),
    /** Nombre de détracteurs NPS (score 1-3 sur 5). */
    npsDetractors: integer("nps_detractors").notNull().default(0),
    /**
     * Secondes d'activité agent (KPI taux d'occupation).
     * SOURCE : agrégation d'`agent_status_history` (DB-001).
     * Somme des intervalles où `to_status IN ('AVAILABLE', 'SERVING')`.
     * Null si aucune entrée d'historique pour la journée.
     */
    agentActiveSeconds: integer("agent_active_seconds"),
    /**
     * Secondes de disponibilité agent (KPI taux d'occupation, décision D2).
     * SOURCE : agrégation d'`agent_status_history` (DB-001).
     * Somme des intervalles où `to_status IN ('AVAILABLE', 'SERVING')` et `seconds > 0`.
     * Matérialisée par le service d'agrégation (apps/api/reporting/aggregate-service.ts),
     * non stockée par DB-006 d'origine.
     * Null si aucune entrée d'historique pour la journée.
     */
    agentAvailableSeconds: integer("agent_available_seconds"),
    /** Horodatage de création de la ligne. */
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** Horodatage de dernière mise à jour (recalcul par upsertDailyStats). */
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /**
     * Index (bank_id, day) — requêtes dashboard cross-agences pour une banque.
     * bank_id en tête (convention F2).
     */
    index("daily_agency_stats_bank_id_day_idx").on(table.bankId, table.day),
    /**
     * Index (bank_id, agency_id, day) — requêtes par agence.
     * bank_id en tête (convention F2).
     */
    index("daily_agency_stats_bank_id_agency_id_day_idx").on(
      table.bankId,
      table.agencyId,
      table.day
    ),
    /**
     * Index unique partiel WHERE service_id IS NULL.
     * Garantit qu'il n'y a qu'un seul agrégat toutes-services par (bank, agence, jour).
     * Drizzle : `.where(isNull(table.serviceId))`.
     */
    uniqueIndex("daily_agency_stats_no_service_uniq")
      .on(table.bankId, table.agencyId, table.day)
      .where(isNull(table.serviceId)),
    /**
     * Index unique partiel WHERE service_id IS NOT NULL.
     * Garantit qu'il n'y a qu'un seul agrégat par (bank, agence, service, jour).
     * Drizzle : `.where(isNotNull(table.serviceId))`.
     */
    uniqueIndex("daily_agency_stats_with_service_uniq")
      .on(table.bankId, table.agencyId, table.serviceId, table.day)
      .where(isNotNull(table.serviceId)),
  ]
);

// ─────────────────────────────────────────────────────────────────────────────
// Table 2 : export_jobs
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `export_jobs` — jobs d'export asynchrone de rapports (DB-006).
 *
 * Support du contrat d'export asynchrone REP-003 :
 * - `format` : pdf / xlsx / json
 * - `status` : PENDING → PROCESSING → READY | FAILED
 * - `file_url` : URL du fichier généré (null jusqu'à READY)
 * - `expires_at` : date d'expiration du lien (null si pas d'expiration)
 *
 * ## Décision d'audit (DB-006)
 * `export_jobs` est EXCLUE de AUDITED_TABLES car :
 * - Table de coordination technique à volume élevé (un job par demande d'export)
 * - Les transitions de statut sont des mutations de cycle de vie, non des mutations de données métier
 * - Les jobs sont créés par des acteurs authentifiés dont les actions sont tracées via les routes API
 *
 * ## RLS
 * Policy `tenant_isolation` (bank_id = app.current_bank_id).
 */
export const exportJobs = pgTable(
  "export_jobs",
  {
    /** Identifiant unique du job. */
    id: uuid("id").primaryKey().defaultRandom(),
    /** Tenant — banque propriétaire (FK RESTRICT). */
    bankId: uuid("bank_id")
      .notNull()
      /* v8 ignore next — callback de résolution lazy FK Drizzle (pure DSL, non instrumentable) */
      .references(() => banks.id, { onDelete: "restrict" }),
    /** UUID de l'utilisateur ayant demandé l'export. Stocké sans FK (acteur peut être supprimé). */
    requestedBy: uuid("requested_by").notNull(),
    /** Périmètre de l'export (ex. "agency:uuid", "bank", "service:uuid"). */
    scope: text("scope").notNull(),
    /**
     * Période de l'export (ex. "2026-01-01/2026-01-31" — format ISO 8601 interval).
     * Stocké comme text — validation côté API (REP-003).
     */
    period: text("period").notNull(),
    /**
     * Format du fichier généré.
     * Valeurs : pdf | xlsx | json — validation côté API (REP-003).
     */
    format: text("format").notNull(),
    /**
     * Statut du job (LA LOI `ExportJobStatus`).
     * Transitions : PENDING → PROCESSING → READY | FAILED.
     */
    status: exportJobStatusEnum("status").notNull().default("PENDING"),
    /**
     * URL du fichier généré (null jusqu'à ce que status = READY).
     * URL temporaire signée (S3/equivalent) — expiration gérée par `expires_at`.
     */
    fileUrl: text("file_url"),
    /** Date d'expiration du lien de téléchargement (null si pas d'expiration). */
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    /** Horodatage de création. */
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** Horodatage de dernière mise à jour. */
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /**
     * Index (bank_id, status) — filtrage par statut pour le polling.
     * bank_id en tête (convention F2).
     */
    index("export_jobs_bank_id_status_idx").on(table.bankId, table.status),
    /**
     * Index (bank_id, requested_by) — liste des exports d'un utilisateur.
     */
    index("export_jobs_bank_id_requested_by_idx").on(table.bankId, table.requestedBy),
  ]
);
