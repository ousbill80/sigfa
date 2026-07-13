import {
  pgTable,
  pgEnum,
  uuid,
  text,
  date,
  integer,
  numeric,
  doublePrecision,
  boolean,
  timestamp,
  index,
  uniqueIndex,
  jsonb,
} from "drizzle-orm/pg-core";
import { banks } from "./banks.js";
import { agencies } from "./agencies.js";

// ─────────────────────────────────────────────────────────────────────────────
// Enums DB-007 (alignés LA LOI ai.yaml — CONTRACT-008)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Facteurs contextuels influençant les prédictions d'affluence (LA LOI `ContextualFactor`).
 *
 * SOURCE : ai.yaml § ContextualFactor (CONTRACT-008).
 * - `END_OF_MONTH`        : fin de mois (jours 28–31)
 * - `CIVIL_SERVICE_PAY`   : jour de paie de la fonction publique ivoirienne
 * - `PUBLIC_HOLIDAY`      : jour férié ou veille de férié
 * - `SCHOOL_START`        : rentrée scolaire
 * - `NONE`                : aucun facteur contextuel exceptionnel
 */
export const contextualFactorEnum = pgEnum("contextual_factor", [
  "END_OF_MONTH",
  "CIVIL_SERVICE_PAY",
  "PUBLIC_HOLIDAY",
  "SCHOOL_START",
  "NONE",
]);

/**
 * Statut d'acquittement d'une recommandation de staffing (LA LOI `StaffingAckStatus`).
 *
 * SOURCE : ai.yaml § StaffingAckStatus (CONTRACT-008).
 * - `PENDING` : recommandation non encore prise en compte
 * - `ACKED`   : recommandation acquittée par un manager
 *
 * Note : la LOI utilise "pending"/"acked" en minuscules dans l'API REST,
 * mais la convention DB SIGFA est UPPER_SNAKE_CASE pour les enums PostgreSQL.
 */
export const staffingAckStatusEnum = pgEnum("staffing_ack_status", ["PENDING", "ACKED"]);

/**
 * Types d'anomalies agrégées détectées par le module IA (LA LOI `AnomalyType`).
 *
 * SOURCE : ai.yaml § AnomalyType (CONTRACT-008).
 * - `QUEUE_STUCK`              : file d'attente bloquée sans appel
 * - `AGENT_INACTIVE_PATTERN`   : motif d'inactivité récurrent (≥3 alertes / 7 jours)
 * - `SLA_SYSTEMIC`             : violations SLA systémiques sur plusieurs jours
 */
export const anomalyTypeEnum = pgEnum("anomaly_type", [
  "QUEUE_STUCK",
  "AGENT_INACTIVE_PATTERN",
  "SLA_SYSTEMIC",
]);

/**
 * Statut du cycle de vie d'une anomalie (LA LOI `AnomalyStatus`).
 *
 * SOURCE : ai.yaml § AnomalyStatus (CONTRACT-008).
 * - `open`     : anomalie détectée, non acquittée
 * - `acked`    : anomalie acquittée par un manager
 * - `resolved` : anomalie résolue (disparition du motif ou résolution manuelle)
 *
 * Transitions légales : open→acked · open→resolved · acked→resolved.
 */
export const anomalyStatusEnum = pgEnum("anomaly_status", ["open", "acked", "resolved"]);

// ─────────────────────────────────────────────────────────────────────────────
// Table 1 : ai_forecasts
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `ai_forecasts` — prédictions d'affluence horaires par agence (DB-007).
 *
 * ## AiMeta (LA LOI)
 * Les colonnes `model_version`, `computed_at`, `data_window` constituent l'objet
 * `AiMeta` défini dans ai.yaml (CONTRACT-008). Toutes les réponses IA l'exposent.
 *
 * ## Facteurs contextuels
 * `factors` : tableau JSONB des `ContextualFactor` ayant influencé le calcul.
 * Valeurs : `["END_OF_MONTH", "PUBLIC_HOLIDAY", ...]` ou `["NONE"]`.
 *
 * ## Unicité upsert
 * UNIQUE `(bank_id, agency_id, target_date, hour, model_version)` — permet un
 * `ON CONFLICT DO UPDATE` idempotent lors du recalcul des prédictions (REP-001).
 *
 * ## Rétention (DB-007)
 * Les prédictions >24 mois sont purgées par `purgeAiHistory()`.
 *
 * ## Décision d'audit
 * `ai_forecasts` est EXCLUE de AUDITED_TABLES : table d'agrégats IA à volume élevé
 * (recalcul quotidien ou à la demande) — les mutations sont idempotentes (upsert).
 *
 * ## Zéro donnée personnelle
 * Aucun champ personnel (phone, email, nom, user_id en clair). Conformité UEMOA.
 *
 * ## RLS
 * Policy `tenant_isolation` (bank_id = app.current_bank_id).
 */
export const aiForecasts = pgTable(
  "ai_forecasts",
  {
    /** Identifiant unique de la prédiction. */
    id: uuid("id").primaryKey().defaultRandom(),
    /** Tenant — banque propriétaire (FK RESTRICT). */
    bankId: uuid("bank_id")
      .notNull()
      /* v8 ignore next — callback de résolution lazy FK Drizzle (pure DSL, non instrumentable) */
      .references(() => banks.id, { onDelete: "restrict" }),
    /** Agence concernée par la prédiction (FK RESTRICT). */
    agencyId: uuid("agency_id")
      .notNull()
      /* v8 ignore next — callback de résolution lazy FK Drizzle (pure DSL, non instrumentable) */
      .references(() => agencies.id, { onDelete: "restrict" }),
    /** Date cible de la prédiction (format YYYY-MM-DD). */
    targetDate: date("target_date").notNull(),
    /** Heure de la prédiction (0–23, heure locale Africa/Abidjan). */
    hour: integer("hour").notNull(),
    /** Nombre de tickets attendus pour cette heure. */
    expectedTickets: integer("expected_tickets").notNull(),
    /**
     * Indice de confiance de la prédiction (0.0 à 1.0).
     * - 0.9–1.0 : très haute confiance
     * - < 0.5   : confiance faible (utiliser avec précaution)
     */
    confidence: numeric("confidence", { precision: 4, scale: 3 }).notNull(),
    /**
     * Facteurs contextuels ayant influencé le calcul (JSONB, enum ContextualFactor).
     * Ex. `["END_OF_MONTH", "PUBLIC_HOLIDAY"]` ou `["NONE"]`.
     */
    factors: jsonb("factors").notNull().default(["NONE"]),
    /**
     * AiMeta — version du modèle utilisé (ex. "forecast-v1.2.0").
     * Élément de `AiMeta` (ai.yaml, CONTRACT-008).
     */
    modelVersion: text("model_version").notNull(),
    /**
     * AiMeta — horodatage UTC du calcul de la prédiction.
     * Élément de `AiMeta` (ai.yaml, CONTRACT-008).
     */
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull(),
    /**
     * AiMeta — fenêtre temporelle des données utilisées (ISO 8601 interval).
     * Format : "YYYY-MM-DD/YYYY-MM-DD". Ex. "2026-01-05/2026-07-14".
     * Élément de `AiMeta` (ai.yaml, CONTRACT-008).
     */
    dataWindow: text("data_window").notNull(),
    /** Horodatage de création de la ligne. */
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /**
     * Contrainte unique : une seule prédiction par (banque, agence, date, heure, version modèle).
     * Permet l'upsert ON CONFLICT DO UPDATE lors du recalcul.
     */
    uniqueIndex("ai_forecasts_unique_forecast").on(
      table.bankId,
      table.agencyId,
      table.targetDate,
      table.hour,
      table.modelVersion
    ),
    /**
     * Index (bank_id, agency_id, target_date) — requêtes par agence et date.
     * bank_id en tête (convention F2).
     */
    index("ai_forecasts_bank_agency_date_idx").on(
      table.bankId,
      table.agencyId,
      table.targetDate
    ),
  ]
);

// ─────────────────────────────────────────────────────────────────────────────
// Table 2 : ai_staffing_recommendations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `ai_staffing_recommendations` — recommandations de staffing IA (DB-007).
 *
 * ## Cycle d'acquittement
 * - `PENDING` : recommandation créée, non encore prise en compte par un manager.
 * - `ACKED`   : acquittée via `POST /ai/staffing-recommendations/{id}/ack`.
 *
 * `acked_by` : identifiant (UUID) du manager ayant acquitté (null avant acquittement).
 * `acked_at` : horodatage de l'acquittement (null avant acquittement).
 *
 * ## Zéro donnée personnelle
 * Aucun verbatim client. `rationale` est une justification technique générée par le
 * modèle IA (ex. "Pic prévu à 10h30 : 38 tickets attendus").
 *
 * ## Décision d'audit
 * EXCLUE de AUDITED_TABLES : table IA à fréquence d'upsert élevée (recalcul quotidien).
 *
 * ## RLS
 * Policy `tenant_isolation` (bank_id = app.current_bank_id).
 */
export const aiStaffingRecommendations = pgTable(
  "ai_staffing_recommendations",
  {
    /** Identifiant unique de la recommandation. */
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
    /** Date cible des recommandations (format YYYY-MM-DD). */
    targetDate: date("target_date").notNull(),
    /**
     * Heure d'application recommandée (format HH:MM).
     * Ex. "10:30" — heure locale Africa/Abidjan.
     */
    time: text("time").notNull(),
    /**
     * Type d'action recommandée (OPEN_COUNTER | CLOSE_COUNTER | BREAK).
     * Validation côté API (CONTRACT-008 § StaffingAction).
     */
    action: text("action").notNull(),
    /** Nombre de guichets concernés par l'action (≥ 1). */
    counters: integer("counters").notNull(),
    /**
     * Justification textuelle de la recommandation.
     * Générée par le modèle IA — aucun verbatim client.
     * Ex. "Pic prévu à 10h30 : 38 tickets attendus, capacité actuelle insuffisante."
     */
    rationale: text("rationale").notNull(),
    /**
     * Statut d'acquittement (PENDING / ACKED).
     * Défaut : PENDING à la création.
     */
    status: staffingAckStatusEnum("status").notNull().default("PENDING"),
    /**
     * Identifiant du manager ayant acquitté la recommandation.
     * Null avant acquittement (PENDING).
     */
    ackedBy: text("acked_by"),
    /**
     * Horodatage de l'acquittement.
     * Null avant acquittement (PENDING).
     */
    ackedAt: timestamp("acked_at", { withTimezone: true }),
    /** Horodatage de création. */
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** Horodatage de dernière mise à jour. */
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /**
     * Index (bank_id, agency_id, target_date) — requêtes par agence et date.
     * bank_id en tête (convention F2).
     */
    index("ai_staffing_recs_bank_agency_date_idx").on(
      table.bankId,
      table.agencyId,
      table.targetDate
    ),
    /**
     * Index (bank_id, status) — filtrage par statut d'acquittement.
     */
    index("ai_staffing_recs_bank_status_idx").on(table.bankId, table.status),
  ]
);

// ─────────────────────────────────────────────────────────────────────────────
// Table 3 : ai_anomalies
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `ai_anomalies` — anomalies agrégées détectées par le module IA (DB-007).
 *
 * ## Types d'anomalies (LA LOI `AnomalyType`)
 * - `QUEUE_STUCK`            : file bloquée sans appel > seuil configuré
 * - `AGENT_INACTIVE_PATTERN` : ≥3 alertes AGENT_INACTIVE / 7 jours glissants
 * - `SLA_SYSTEMIC`           : violations SLA sur plusieurs jours consécutifs
 *
 * ## Cycle de vie (LA LOI `AnomalyStatus`)
 * - `open`     : détectée, non acquittée — `detected_at` peuplé
 * - `acked`    : acquittée par un manager — `acked_by` + `acked_at` peuplés
 * - `resolved` : résolue (motif disparu ou résolution manuelle) — `resolved_at` peuplé
 *
 * Transitions légales : open→acked · open→resolved · acked→resolved.
 * Toute autre transition → 409 `ILLEGAL_TRANSITION` (côté API, CONTRACT-008).
 *
 * ## agency_id nullable
 * Certaines anomalies sont au niveau banque (bank_id seul, agency_id NULL).
 * Ex. violation SLA systémique cross-agences.
 *
 * ## Index
 * `(bank_id, status, detected_at)` — index composé pour les requêtes paginées
 * par statut avec tri chronologique (bank_id en tête, convention F2).
 *
 * ## Rétention (DB-007)
 * Les anomalies >24 mois sont purgées par `purgeAiHistory()`.
 *
 * ## Décision d'audit
 * EXCLUE de AUDITED_TABLES : table IA à volume élevé (détection automatique).
 *
 * ## Zéro donnée personnelle
 * `payload` est un JSONB de métriques agrégées — aucun verbatim client ni PII.
 *
 * ## RLS
 * Policy `tenant_isolation` (bank_id = app.current_bank_id).
 */
export const aiAnomalies = pgTable(
  "ai_anomalies",
  {
    /** Identifiant unique de l'anomalie. */
    id: uuid("id").primaryKey().defaultRandom(),
    /** Tenant — banque propriétaire (FK RESTRICT). */
    bankId: uuid("bank_id")
      .notNull()
      /* v8 ignore next — callback de résolution lazy FK Drizzle (pure DSL, non instrumentable) */
      .references(() => banks.id, { onDelete: "restrict" }),
    /**
     * Agence concernée (FK RESTRICT, nullable).
     * NULL = anomalie au niveau banque (ex. SLA_SYSTEMIC cross-agences).
     */
    agencyId: uuid("agency_id")
      /* v8 ignore next — callback de résolution lazy FK Drizzle (pure DSL, non instrumentable) */
      .references(() => agencies.id, { onDelete: "restrict" }),
    /**
     * Type d'anomalie (LA LOI `AnomalyType`).
     * QUEUE_STUCK | AGENT_INACTIVE_PATTERN | SLA_SYSTEMIC.
     */
    type: anomalyTypeEnum("type").notNull(),
    /**
     * Statut du cycle de vie (LA LOI `AnomalyStatus`).
     * Défaut : open à la détection.
     */
    status: anomalyStatusEnum("status").notNull().default("open"),
    /**
     * Payload JSONB de métriques agrégées (aucun PII).
     * Ex. `{ "alertCount": 4, "windowDays": 7, "agentId": "..." }`.
     * Note : `agentId` dans payload est un UUID technique, non une donnée personnelle.
     */
    payload: jsonb("payload").notNull().default({}),
    /** Horodatage UTC de détection de l'anomalie. */
    detectedAt: timestamp("detected_at", { withTimezone: true }).notNull(),
    /**
     * Identifiant du manager ayant acquitté l'anomalie.
     * Null si status = open.
     */
    ackedBy: text("acked_by"),
    /**
     * Horodatage de l'acquittement (open → acked).
     * Null si status = open.
     */
    ackedAt: timestamp("acked_at", { withTimezone: true }),
    /**
     * Horodatage de résolution (open | acked → resolved).
     * Null si status ≠ resolved.
     */
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    /** Horodatage de création de la ligne. */
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** Horodatage de dernière mise à jour. */
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /**
     * Index (bank_id, status, detected_at) — requêtes paginées par statut.
     * bank_id en tête (convention F2). Exigé par DB-007.
     */
    index("ai_anomalies_bank_status_detected_idx").on(
      table.bankId,
      table.status,
      table.detectedAt
    ),
    /**
     * Index (bank_id, agency_id) — filtrage par agence.
     */
    index("ai_anomalies_bank_agency_idx").on(table.bankId, table.agencyId),
  ]
);

// ─────────────────────────────────────────────────────────────────────────────
// Table 4 : ai_quality_scores
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `ai_quality_scores` — scores de qualité agrégés (DB-007).
 *
 * ## Anonymisation UEMOA
 * Cette table stocke uniquement des agrégats anonymisés — AUCUN verbatim client
 * ni donnée personnelle en clair. Conformité BCEAO/UEMOA.
 *
 * ## Contenu
 * - `score` : score de qualité calculé (ex. 4.1 sur une échelle de 5)
 * - `components` : décomposition JSONB du score (sentiments, thèmes, etc.)
 * - `model_version` : version du modèle NLP ayant généré le score (AiMeta)
 *
 * ## agent_id
 * `agent_id` est nullable : dans la vue réseau anonymisée (BANK_ADMIN), les scores
 * ne sont PAS associés à un agent individuel. Pour la vue agence, l'`agent_id` peut
 * être présent à titre d'agrégat interne (non exposé en API réseau).
 *
 * ## Rétention (DB-007)
 * Les scores >24 mois sont purgés par `purgeAiHistory()`.
 *
 * ## Décision d'audit
 * EXCLUE de AUDITED_TABLES : agrégats IA à volume élevé (recalcul mensuel).
 *
 * ## RLS
 * Policy `tenant_isolation` (bank_id = app.current_bank_id).
 */
export const aiQualityScores = pgTable(
  "ai_quality_scores",
  {
    /** Identifiant unique du score de qualité. */
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
     * Identifiant de l'agent (UUID, nullable).
     * NULL dans la vue réseau anonymisée (BANK_ADMIN) — agrégat sans référence individuelle.
     * Peut être présent pour les agrégats internes agence (non exposé en API réseau).
     */
    agentId: uuid("agent_id"),
    /**
     * Période de calcul (date de début de période).
     * Format YYYY-MM-01 pour un agrégat mensuel, ou YYYY-MM-DD pour hebdomadaire.
     */
    period: date("period").notNull(),
    /**
     * Score de qualité calculé (ex. 4.1 sur une échelle de 5).
     * Agrégat — jamais un score individuel brut.
     */
    score: numeric("score", { precision: 5, scale: 2 }).notNull(),
    /**
     * Décomposition JSONB du score (composantes anonymisées).
     * Ex. `{ "sentiment": 0.8, "waitTime": 0.7, "agentBehavior": 0.9 }`.
     * AUCUN verbatim client ni PII.
     */
    components: jsonb("components").notNull().default({}),
    /**
     * AiMeta — version du modèle NLP ayant calculé le score.
     * Élément de `AiMeta` (ai.yaml, CONTRACT-008).
     */
    modelVersion: text("model_version").notNull(),
    /** Horodatage de création. */
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** Horodatage de dernière mise à jour. */
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /**
     * Index (bank_id, agency_id, period) — requêtes par agence et période.
     * bank_id en tête (convention F2).
     */
    index("ai_quality_scores_bank_agency_period_idx").on(
      table.bankId,
      table.agencyId,
      table.period
    ),
    /**
     * Index (bank_id, period) — requêtes réseau par banque.
     */
    index("ai_quality_scores_bank_period_idx").on(table.bankId, table.period),
  ]
);

// ─────────────────────────────────────────────────────────────────────────────
// Table 5 : ai_features (DB-AI-FEATURES — couture IA-001)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `ai_features` — matérialisation du feature-set d'affluence (DB-AI-FEATURES).
 *
 * ## Couture IA-001 (CONTRACT-008)
 * Table de persistance RÉELLE du pipeline features IA-001. Elle remplace le
 * substitut `InMemoryFeatureStore` (`apps/api/src/ai/feature-store.ts`). Chaque
 * colonne reflète un champ du `FeatureRecord` produit par `computeFeatureSet`
 * (`apps/api/src/ai/feature-engine.ts`) :
 *  - mesures de bucket d'affluence (arrivals/served/no_show/abandoned, TMA/TMT,
 *    p90, guichets/agents) — issues REP-001 / extraction, jamais recalculées ;
 *  - features calendaires (day_of_week + flags + factors JSONB) ;
 *  - features LAG (J-1, J-7, moyenne glissante 4 semaines) ;
 *  - métadonnées (is_partial, available_days, feature_set_version).
 *
 * ## Clé d'idempotence (upsert IA-001)
 * UNIQUE `(bank_id, agency_id, service_id, date, hour_bucket, feature_set_version)`
 * avec `NULLS NOT DISTINCT` (PG16) — `service_id` NULL = « tous services confondus »
 * reste une clé canonique unique. Rejouer la même fenêtre produit exactement les
 * mêmes lignes (aucun doublon) via `ON CONFLICT DO UPDATE`, exactement comme
 * `canonicalKey` du store en mémoire (qui mappe `serviceId ?? "∅"`).
 *
 * ## Dénormalisation bank_id + agency_id
 * `bank_id` (FK RESTRICT) porte l'isolation tenant RLS ; `agency_id` (FK RESTRICT)
 * est dénormalisé pour les requêtes par agence (convention F2 : bank_id en tête).
 *
 * ## service_id
 * `text` nullable (SANS FK) : le pipeline traite `serviceId` comme un identifiant
 * opaque pouvant être `null` (agrégat tous services). Pas de FK — cohérent avec le
 * contrat IA-001 et l'absence d'imputation.
 *
 * ## Rétention (DB-007 / DB-008)
 * Cache de calcul (pas une source de vérité) : purgé si `computed_at` < now - 24
 * mois par `purgeAiHistory()` — cohérent avec les autres tables `ai_*`.
 *
 * ## Décision d'audit
 * EXCLUE de AUDITED_TABLES : table d'agrégats IA à volume élevé, mutations
 * idempotentes (upsert). La source de vérité reste `tickets`.
 *
 * ## Zéro donnée personnelle
 * Uniquement des agrégats numériques et calendaires — aucun phone/email/nom, aucun
 * identifiant client, aucun verbatim. Conformité UEMOA.
 *
 * ## RLS
 * ENABLE + FORCE + policy `tenant_isolation` (bank_id = app.current_bank_id).
 */
export const aiFeatures = pgTable(
  "ai_features",
  {
    /** Identifiant unique de la feature. */
    id: uuid("id").primaryKey().defaultRandom(),
    // ── Clé canonique ──────────────────────────────────────────────────────────
    /** Tenant — banque propriétaire (FK RESTRICT, isolation RLS). */
    bankId: uuid("bank_id")
      .notNull()
      /* v8 ignore next — callback de résolution lazy FK Drizzle (pure DSL, non instrumentable) */
      .references(() => banks.id, { onDelete: "restrict" }),
    /** Agence (FK RESTRICT, dénormalisée). */
    agencyId: uuid("agency_id")
      .notNull()
      /* v8 ignore next — callback de résolution lazy FK Drizzle (pure DSL, non instrumentable) */
      .references(() => agencies.id, { onDelete: "restrict" }),
    /** Service (opaque, nullable — NULL = tous services confondus). Pas de FK. */
    serviceId: text("service_id"),
    /** Jour civil Abidjan (YYYY-MM-DD). */
    date: date("date").notNull(),
    /** Index du bucket dans la journée (0-based). Horaire : 0–23. 30 min : 0–47. */
    hourBucket: integer("hour_bucket").notNull(),
    /** Largeur du bucket en minutes (30 ou 60). */
    bucketMinutes: integer("bucket_minutes").notNull(),
    // ── Mesures de bucket (REP-001 / extraction, non recalculées) ───────────────
    /** Tickets émis (arrivées) dans le bucket. */
    arrivals: integer("arrivals").notNull(),
    /** Tickets servis (DONE). */
    served: integer("served").notNull(),
    /** Tickets non-présentés (NO_SHOW). */
    noShow: integer("no_show").notNull(),
    /** Tickets abandonnés (ABANDONED). */
    abandoned: integer("abandoned").notNull(),
    /** TMA du bucket (moyenne attente s). NULL si served = 0 (aucune imputation). */
    avgWaitSeconds: doublePrecision("avg_wait_seconds"),
    /** 90e centile du temps d'attente (secondes). */
    p90WaitSeconds: doublePrecision("p90_wait_seconds").notNull(),
    /** TMT du bucket (moyenne service s). NULL si served = 0. */
    avgServiceSeconds: doublePrecision("avg_service_seconds"),
    /** Nb de guichets ouverts observés. */
    countersOpen: integer("counters_open").notNull(),
    /** Nb d'agents actifs observés. */
    agentsActive: integer("agents_active").notNull(),
    // ── Features calendaires (CONTRACT-008) ─────────────────────────────────────
    /** Jour de la semaine (0=dimanche … 6=samedi, aligné calendarFlags). */
    dayOfWeek: integer("day_of_week").notNull(),
    /** Fin de mois. */
    isMonthEnd: boolean("is_month_end").notNull(),
    /** Jour de paie de la fonction publique. */
    isPublicPayDay: boolean("is_public_pay_day").notNull(),
    /** Jour férié. */
    isPublicHoliday: boolean("is_public_holiday").notNull(),
    /** Veille de jour férié. */
    isEveOfHoliday: boolean("is_eve_of_holiday").notNull(),
    /**
     * Facteurs contextuels (JSONB, enum ContextualFactor).
     * Ex. `["END_OF_MONTH", "PUBLIC_HOLIDAY"]` ou `["NONE"]`.
     */
    factors: jsonb("factors").notNull().default(["NONE"]),
    // ── Features LAG ────────────────────────────────────────────────────────────
    /** Arrivées du même bucket la veille (J-1). NULL si absent. */
    arrivalsLag1d: integer("arrivals_lag_1d"),
    /** Arrivées du même bucket 7 jours avant (J-7). NULL si absent. */
    arrivalsLag7d: integer("arrivals_lag_7d"),
    /**
     * Moyenne des arrivées du même bucket sur 4 semaines glissantes
     * (J-7, J-14, J-21, J-28). NULL si aucun des 4 points n'est disponible.
     */
    arrivalsRollMean4w: doublePrecision("arrivals_roll_mean_4w"),
    // ── Métadonnées ─────────────────────────────────────────────────────────────
    /** Bucket incomplet — aucune imputation. */
    isPartial: boolean("is_partial").notNull(),
    /** Nb de jours civils distincts observés pour l'agence (base seuil 90 j). */
    availableDays: integer("available_days").notNull(),
    /** Version du schéma de features (CONTRACT-008). */
    featureSetVersion: text("feature_set_version").notNull(),
    // ── AiMeta / horodatages ────────────────────────────────────────────────────
    /**
     * AiMeta — horodatage UTC du calcul de la feature (base de la rétention 24 mois).
     */
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
    /** Horodatage de création de la ligne. */
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** Horodatage de dernière mise à jour (upsert idempotent). */
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /**
     * Contrainte unique (idempotence upsert IA-001) :
     * (bank_id, agency_id, service_id, date, hour_bucket, feature_set_version).
     *
     * NOTE : la migration SQL 0013 crée cet index avec `NULLS NOT DISTINCT` (PG16)
     * pour que `service_id` NULL (« tous services ») reste une clé canonique unique.
     * Drizzle 0.36 n'exposant pas de builder `NULLS NOT DISTINCT`, la clause est
     * portée par la migration hand-authored (source de vérité DDL) ; ce descripteur
     * garantit l'alignement des colonnes de la clé.
     */
    uniqueIndex("ai_features_unique_feature").on(
      table.bankId,
      table.agencyId,
      table.serviceId,
      table.date,
      table.hourBucket,
      table.featureSetVersion
    ),
    /**
     * Index (bank_id, agency_id, date) — requêtes par agence et date.
     * bank_id en tête (convention F2).
     */
    index("ai_features_bank_agency_date_idx").on(
      table.bankId,
      table.agencyId,
      table.date
    ),
    /**
     * Index (bank_id, computed_at) — support de la purge rétention 24 mois.
     */
    index("ai_features_bank_computed_idx").on(table.bankId, table.computedAt),
  ]
);
