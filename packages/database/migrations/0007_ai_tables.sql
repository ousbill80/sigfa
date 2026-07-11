-- DB-007 : tables IA — prédictions, anomalies, recommandations, scores + rétention
-- Appliqué après 0006_retention_purge.sql.
--
-- Contenu :
--   1. Enum contextual_factor (END_OF_MONTH/CIVIL_SERVICE_PAY/PUBLIC_HOLIDAY/SCHOOL_START/NONE)
--   2. Enum staffing_ack_status (PENDING/ACKED)
--   3. Enum anomaly_type (QUEUE_STUCK/AGENT_INACTIVE_PATTERN/SLA_SYSTEMIC)
--   4. Enum anomaly_status (open/acked/resolved)
--   5. Table ai_forecasts — prédictions horaires, unique (bank,agency,date,hour,model_version),
--      AiMeta (model_version/computed_at/data_window), factors JSONB, RLS + tenant_isolation
--   6. Table ai_staffing_recommendations — cycle PENDING/ACKED, acked_by/acked_at
--   7. Table ai_anomalies — types + statuts enum LA LOI, cycle open→acked→resolved timestamped,
--      index (bank_id, status, detected_at)
--   8. Table ai_quality_scores — agrégats anonymisés, agent_id nullable, RLS + tenant_isolation
--   9. GRANT sigfa_app sur les 4 tables
--
-- Décision d'audit (DB-007) :
--   Toutes les tables IA sont EXCLUES de AUDITED_TABLES car :
--   - Tables d'agrégats à volume élevé (recalcul quotidien ou à la demande)
--   - Les mutations sont idempotentes (upsert) — un trigger d'audit crée du bruit sans valeur
--   - La source de vérité reste `tickets` (journalisée applicativement via insertAuditEntry)
--   - `document` est également exclu (volume trop élevé, décision de la vague F2)
--
-- Rétention IA (DB-007) :
--   purgeAiHistory() dans src/ai/index.ts — supprime les lignes > 24 mois.
--   Idempotente, horloge injectable. Même pattern connexion migrateur que DB-008.
--
-- Zéro donnée personnelle :
--   Aucune colonne phone/email/first_name/last_name dans ces tables.
--   ai_quality_scores.agent_id est un UUID technique (optionnel) — non exposé en vue réseau.
--
-- Migration down : 0007_ai_tables.down.sql
--> statement-breakpoint

-- ── Enum contextual_factor ────────────────────────────────────────────────────
--
-- Facteurs contextuels influençant les prédictions d'affluence (LA LOI ai.yaml).

CREATE TYPE "contextual_factor" AS ENUM (
  'END_OF_MONTH',
  'CIVIL_SERVICE_PAY',
  'PUBLIC_HOLIDAY',
  'SCHOOL_START',
  'NONE'
);
--> statement-breakpoint

-- ── Enum staffing_ack_status ──────────────────────────────────────────────────
--
-- Statut d'acquittement d'une recommandation staffing (LA LOI ai.yaml).

CREATE TYPE "staffing_ack_status" AS ENUM ('PENDING', 'ACKED');
--> statement-breakpoint

-- ── Enum anomaly_type ─────────────────────────────────────────────────────────
--
-- Types d'anomalies agrégées (LA LOI ai.yaml § AnomalyType).

CREATE TYPE "anomaly_type" AS ENUM (
  'QUEUE_STUCK',
  'AGENT_INACTIVE_PATTERN',
  'SLA_SYSTEMIC'
);
--> statement-breakpoint

-- ── Enum anomaly_status ───────────────────────────────────────────────────────
--
-- Cycle de vie d'une anomalie (LA LOI ai.yaml § AnomalyStatus).
-- Transitions légales : open→acked · open→resolved · acked→resolved.

CREATE TYPE "anomaly_status" AS ENUM ('open', 'acked', 'resolved');
--> statement-breakpoint

-- ── 1. ai_forecasts ──────────────────────────────────────────────────────────
--
-- Prédictions d'affluence horaires par agence (DB-007).
--
-- AiMeta (LA LOI) : model_version + computed_at + data_window.
-- factors : JSONB (tableau de contextual_factor).
-- Unique : (bank_id, agency_id, target_date, hour, model_version) — upsert idempotent.
-- Rétention : purgées si computed_at < now - 24 mois (purgeAiHistory).
-- EXCLUE des AUDITED_TABLES (agrégats à volume élevé).

CREATE TABLE IF NOT EXISTS "ai_forecasts" (
  "id"              uuid          PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "bank_id"         uuid          NOT NULL REFERENCES "banks"("id") ON DELETE RESTRICT,
  "agency_id"       uuid          NOT NULL REFERENCES "agencies"("id") ON DELETE RESTRICT,
  "target_date"     date          NOT NULL,
  "hour"            integer       NOT NULL,
  "expected_tickets" integer      NOT NULL,
  "confidence"      numeric(4, 3) NOT NULL,
  "factors"         jsonb         NOT NULL DEFAULT '["NONE"]'::jsonb,
  "model_version"   text          NOT NULL,
  "computed_at"     timestamp with time zone NOT NULL,
  "data_window"     text          NOT NULL,
  "created_at"      timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint

COMMENT ON TABLE "ai_forecasts" IS
  'Prédictions d''affluence horaires par agence (DB-007). '
  'AiMeta : model_version/computed_at/data_window. factors : jsonb (ContextualFactor). '
  'Unique (bank,agency,date,hour,model_version) — upsert idempotent. '
  'Rétention : purgée si computed_at < now - 24 mois. '
  'EXCLUE des AUDITED_TABLES (agrégats IA à volume élevé). Zéro donnée personnelle.';
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "ai_forecasts_unique_forecast"
  ON "ai_forecasts" ("bank_id", "agency_id", "target_date", "hour", "model_version");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "ai_forecasts_bank_agency_date_idx"
  ON "ai_forecasts" ("bank_id", "agency_id", "target_date");
--> statement-breakpoint

-- ── Privilèges sigfa_app ──────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON "ai_forecasts" TO sigfa_app;
--> statement-breakpoint

-- ── RLS : policy tenant_isolation ─────────────────────────────────────────────
ALTER TABLE "ai_forecasts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "ai_forecasts" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "ai_forecasts";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "ai_forecasts"
  USING (bank_id = nullif(current_setting('app.current_bank_id', true), '')::uuid)
  WITH CHECK (bank_id = nullif(current_setting('app.current_bank_id', true), '')::uuid);
--> statement-breakpoint

-- ── 2. ai_staffing_recommendations ───────────────────────────────────────────
--
-- Recommandations de staffing IA (DB-007).
--
-- Cycle : PENDING → ACKED (via POST /ai/staffing-recommendations/{id}/ack).
-- acked_by : id manager (text, sans FK — l'acteur peut être désactivé).
-- Zéro verbatim client : rationale est une justification IA technique.
-- EXCLUE des AUDITED_TABLES.

CREATE TABLE IF NOT EXISTS "ai_staffing_recommendations" (
  "id"          uuid          PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "bank_id"     uuid          NOT NULL REFERENCES "banks"("id") ON DELETE RESTRICT,
  "agency_id"   uuid          NOT NULL REFERENCES "agencies"("id") ON DELETE RESTRICT,
  "target_date" date          NOT NULL,
  "time"        text          NOT NULL,
  "action"      text          NOT NULL,
  "counters"    integer       NOT NULL,
  "rationale"   text          NOT NULL,
  "status"      staffing_ack_status NOT NULL DEFAULT 'PENDING',
  "acked_by"    text,
  "acked_at"    timestamp with time zone,
  "created_at"  timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"  timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint

COMMENT ON TABLE "ai_staffing_recommendations" IS
  'Recommandations de staffing IA (DB-007). '
  'Cycle PENDING → ACKED. acked_by/acked_at peuplés après acquittement. '
  'EXCLUE des AUDITED_TABLES. Zéro donnée personnelle.';
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "ai_staffing_recs_bank_agency_date_idx"
  ON "ai_staffing_recommendations" ("bank_id", "agency_id", "target_date");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "ai_staffing_recs_bank_status_idx"
  ON "ai_staffing_recommendations" ("bank_id", "status");
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "ai_staffing_recommendations" TO sigfa_app;
--> statement-breakpoint

ALTER TABLE "ai_staffing_recommendations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "ai_staffing_recommendations" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "ai_staffing_recommendations";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "ai_staffing_recommendations"
  USING (bank_id = nullif(current_setting('app.current_bank_id', true), '')::uuid)
  WITH CHECK (bank_id = nullif(current_setting('app.current_bank_id', true), '')::uuid);
--> statement-breakpoint

-- ── 3. ai_anomalies ───────────────────────────────────────────────────────────
--
-- Anomalies agrégées détectées par le module IA (DB-007).
--
-- Types (enum anomaly_type) : QUEUE_STUCK / AGENT_INACTIVE_PATTERN / SLA_SYSTEMIC.
-- Cycle (enum anomaly_status) : open → acked → resolved (horodatages timestamptz).
-- agency_id nullable : certaines anomalies sont au niveau banque.
-- Index : (bank_id, status, detected_at) — exigé par DB-007.
-- Rétention : purgées si detected_at < now - 24 mois.
-- payload JSONB : métriques agrégées — AUCUN PII.
-- EXCLUE des AUDITED_TABLES.

CREATE TABLE IF NOT EXISTS "ai_anomalies" (
  "id"          uuid          PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "bank_id"     uuid          NOT NULL REFERENCES "banks"("id") ON DELETE RESTRICT,
  "agency_id"   uuid          REFERENCES "agencies"("id") ON DELETE RESTRICT,
  "type"        anomaly_type  NOT NULL,
  "status"      anomaly_status NOT NULL DEFAULT 'open',
  "payload"     jsonb         NOT NULL DEFAULT '{}'::jsonb,
  "detected_at" timestamp with time zone NOT NULL,
  "acked_by"    text,
  "acked_at"    timestamp with time zone,
  "resolved_at" timestamp with time zone,
  "created_at"  timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"  timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint

COMMENT ON TABLE "ai_anomalies" IS
  'Anomalies agrégées IA (DB-007). '
  'Types : QUEUE_STUCK/AGENT_INACTIVE_PATTERN/SLA_SYSTEMIC (enum anomaly_type). '
  'Cycle : open→acked→resolved avec horodatages (acked_at, resolved_at). '
  'agency_id nullable (anomalie peut être au niveau banque). '
  'payload JSONB : métriques agrégées — zéro PII. '
  'Rétention : purgée si detected_at < now - 24 mois. '
  'EXCLUE des AUDITED_TABLES (agrégats IA à volume élevé).';
--> statement-breakpoint

-- Index (bank_id, status, detected_at) — exigé par DB-007
CREATE INDEX IF NOT EXISTS "ai_anomalies_bank_status_detected_idx"
  ON "ai_anomalies" ("bank_id", "status", "detected_at");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "ai_anomalies_bank_agency_idx"
  ON "ai_anomalies" ("bank_id", "agency_id");
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "ai_anomalies" TO sigfa_app;
--> statement-breakpoint

ALTER TABLE "ai_anomalies" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "ai_anomalies" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "ai_anomalies";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "ai_anomalies"
  USING (bank_id = nullif(current_setting('app.current_bank_id', true), '')::uuid)
  WITH CHECK (bank_id = nullif(current_setting('app.current_bank_id', true), '')::uuid);
--> statement-breakpoint

-- ── 4. ai_quality_scores ─────────────────────────────────────────────────────
--
-- Scores de qualité agrégés (DB-007).
--
-- Agrégats anonymisés uniquement — AUCUN verbatim client ni donnée personnelle.
-- agent_id nullable : absent dans la vue réseau anonymisée (BANK_ADMIN).
-- components JSONB : décomposition du score (sentiment, thèmes, etc.) — zéro PII.
-- Rétention : purgées si created_at < now - 24 mois.
-- EXCLUE des AUDITED_TABLES.

CREATE TABLE IF NOT EXISTS "ai_quality_scores" (
  "id"            uuid          PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "bank_id"       uuid          NOT NULL REFERENCES "banks"("id") ON DELETE RESTRICT,
  "agency_id"     uuid          NOT NULL REFERENCES "agencies"("id") ON DELETE RESTRICT,
  "agent_id"      uuid,
  "period"        date          NOT NULL,
  "score"         numeric(5, 2) NOT NULL,
  "components"    jsonb         NOT NULL DEFAULT '{}'::jsonb,
  "model_version" text          NOT NULL,
  "created_at"    timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"    timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint

COMMENT ON TABLE "ai_quality_scores" IS
  'Scores de qualité agrégés (DB-007). '
  'Agrégats anonymisés uniquement — AUCUN verbatim client ni PII. '
  'agent_id nullable : absent dans la vue réseau anonymisée (BANK_ADMIN). '
  'components JSONB : décomposition du score (sentiment, thèmes) — zéro PII. '
  'Rétention : purgée si created_at < now - 24 mois. '
  'EXCLUE des AUDITED_TABLES (agrégats IA à volume élevé).';
--> statement-breakpoint

COMMENT ON COLUMN "ai_quality_scores"."agent_id" IS
  'UUID technique de l''agent (optionnel). Absent en vue réseau anonymisée. '
  'Non exposé via API réseau (BANK_ADMIN). Pas de FK (acteur peut être désactivé).';
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "ai_quality_scores_bank_agency_period_idx"
  ON "ai_quality_scores" ("bank_id", "agency_id", "period");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "ai_quality_scores_bank_period_idx"
  ON "ai_quality_scores" ("bank_id", "period");
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "ai_quality_scores" TO sigfa_app;
--> statement-breakpoint

ALTER TABLE "ai_quality_scores" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "ai_quality_scores" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "ai_quality_scores";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "ai_quality_scores"
  USING (bank_id = nullif(current_setting('app.current_bank_id', true), '')::uuid)
  WITH CHECK (bank_id = nullif(current_setting('app.current_bank_id', true), '')::uuid);
