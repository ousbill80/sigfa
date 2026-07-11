-- DB-006 : tables reporting — agrégats journaliers matérialisés + export jobs
-- Appliqué après 0004_notifications.sql.
--
-- Contenu :
--   1. Enum : export_job_status (PENDING/PROCESSING/READY/FAILED — aligné LA LOI)
--   2. Table daily_agency_stats
--      - Mesures pour les 7 KPIs de LA LOI (TMA/TMT/TTS/abandon/SLA/NPS/occupation)
--      - agent_active_seconds sourcé d'agent_status_history (DB-001)
--      - Deux index uniques partiels :
--          (bank_id, agency_id, day) WHERE service_id IS NULL
--          (bank_id, agency_id, service_id, day) WHERE service_id IS NOT NULL
--      - Index composites bank_id-first : (bank_id, day) et (bank_id, agency_id, day)
--      - RLS + tenant_isolation
--   3. Table export_jobs
--      - Support du contrat d'export asynchrone (REP-003)
--      - Statuts enum ExportJobStatus
--      - RLS + tenant_isolation
--   4. GRANT sigfa_app sur les 2 tables
--
-- Décision d'audit consignée (DB-006) :
--   daily_agency_stats : EXCLUE des AUDITED_TABLES (décision verrouillée) car :
--     - Table d'agrégats à volume élevé (recalcul quotidien par cron REP-001)
--     - Les mutations sont idempotentes (upsert) — un trigger d'audit crée du bruit sans valeur
--     - La source de vérité reste `tickets` (journalisée applicativement via SEC-001)
--   export_jobs : EXCLUE des AUDITED_TABLES car :
--     - Table de coordination technique à fréquence d'upsert élevée
--     - Les transitions de statut sont des mutations de cycle de vie, non des mutations métier
--     - Les jobs sont créés par des acteurs authentifiés tracés via les routes API
--
-- Migration down : 0005_reporting.down.sql
--> statement-breakpoint

-- ── Enum export_job_status ────────────────────────────────────────────────────

CREATE TYPE "export_job_status" AS ENUM ('PENDING', 'PROCESSING', 'READY', 'FAILED');
--> statement-breakpoint

-- ── 1. daily_agency_stats ─────────────────────────────────────────────────────
--
-- Agrégats journaliers matérialisés par agence (et optionnellement par service).
-- AUCUN champ personnel — conformité AnonymizedNetworkAggregate (DB-006).
--
-- Unicité garantie par deux index partiels (PostgreSQL 16) :
--   - WHERE service_id IS NULL     : agrégat toutes-services de l'agence
--   - WHERE service_id IS NOT NULL : agrégat par service spécifique
--
-- Colonnes mesures (sources des 7 KPIs de LA LOI) :
--   1. TMA (Temps Moyen Attente)      = total_wait_seconds / tickets_served
--   2. TMT (Temps Moyen Traitement)   = total_service_seconds / tickets_served
--   3. TTS (Taux Tickets Servis)      = tickets_served / tickets_issued
--   4. Abandon                        = tickets_abandoned / tickets_issued
--   5. SLA                            = sla_met_count / sla_total_count
--   6. NPS                            = (nps_promoters - nps_detractors) / total_feedback * 100
--   7. Occupation agent               = agent_active_seconds / (agents × durée_journée)

CREATE TABLE IF NOT EXISTS "daily_agency_stats" (
  "id"                    uuid          PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "bank_id"               uuid          NOT NULL REFERENCES "banks"("id") ON DELETE RESTRICT,
  "agency_id"             uuid          NOT NULL REFERENCES "agencies"("id") ON DELETE RESTRICT,
  "service_id"            uuid          REFERENCES "services"("id") ON DELETE RESTRICT,
  "day"                   date          NOT NULL,
  -- Compteurs de tickets
  "tickets_issued"        integer       NOT NULL DEFAULT 0,
  "tickets_served"        integer       NOT NULL DEFAULT 0,
  "tickets_abandoned"     integer       NOT NULL DEFAULT 0,
  "tickets_no_show"       integer       NOT NULL DEFAULT 0,
  -- Durées cumulées (KPI TMA, TMT)
  "total_wait_seconds"    integer       NOT NULL DEFAULT 0,
  "total_service_seconds" integer       NOT NULL DEFAULT 0,
  -- SLA (KPI taux SLA)
  "sla_met_count"         integer       NOT NULL DEFAULT 0,
  "sla_total_count"       integer       NOT NULL DEFAULT 0,
  -- Feedback satisfaction
  "feedback_count"        integer       NOT NULL DEFAULT 0,
  "feedback_sum"          integer       NOT NULL DEFAULT 0,
  -- NPS (Net Promoter Score)
  "nps_promoters"         integer       NOT NULL DEFAULT 0,
  "nps_passives"          integer       NOT NULL DEFAULT 0,
  "nps_detractors"        integer       NOT NULL DEFAULT 0,
  -- Occupation agent — source : agent_status_history (DB-001)
  -- NULL si aucune entrée d'historique pour la journée
  "agent_active_seconds"  integer,
  "created_at"            timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"            timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint

COMMENT ON TABLE "daily_agency_stats" IS
  'Agrégats journaliers matérialisés par agence (DB-006). '
  'AUCUN champ personnel — conformité AnonymizedNetworkAggregate. '
  'Sources des 7 KPIs de LA LOI : TMA/TMT/TTS/abandon/SLA/NPS/occupation. '
  'agent_active_seconds sourcé d''agent_status_history (DB-001). '
  'EXCLUE des AUDITED_TABLES (agrégats à volume élevé — voir décision dans migration).';
--> statement-breakpoint

COMMENT ON COLUMN "daily_agency_stats"."service_id" IS
  'NULL = agrégat toutes-services de l''agence. NOT NULL = agrégat par service spécifique.';
--> statement-breakpoint

COMMENT ON COLUMN "daily_agency_stats"."agent_active_seconds" IS
  'Secondes d''activité agent (KPI occupation). SOURCE : agent_status_history (DB-001). '
  'Somme des intervalles où to_status IN (AVAILABLE, SERVING). NULL si pas d''historique.';
--> statement-breakpoint

-- Index composites bank_id-first (convention F2)
CREATE INDEX IF NOT EXISTS "daily_agency_stats_bank_id_day_idx"
  ON "daily_agency_stats" ("bank_id", "day");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "daily_agency_stats_bank_id_agency_id_day_idx"
  ON "daily_agency_stats" ("bank_id", "agency_id", "day");
--> statement-breakpoint

-- Index unique partiel WHERE service_id IS NULL
-- Garantit l'unicité de l'agrégat toutes-services par (banque, agence, jour)
CREATE UNIQUE INDEX IF NOT EXISTS "daily_agency_stats_no_service_uniq"
  ON "daily_agency_stats" ("bank_id", "agency_id", "day")
  WHERE service_id IS NULL;
--> statement-breakpoint

-- Index unique partiel WHERE service_id IS NOT NULL
-- Garantit l'unicité de l'agrégat par (banque, agence, service, jour)
CREATE UNIQUE INDEX IF NOT EXISTS "daily_agency_stats_with_service_uniq"
  ON "daily_agency_stats" ("bank_id", "agency_id", "service_id", "day")
  WHERE service_id IS NOT NULL;
--> statement-breakpoint

-- ── 2. export_jobs ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "export_jobs" (
  "id"           uuid               PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "bank_id"      uuid               NOT NULL REFERENCES "banks"("id") ON DELETE RESTRICT,
  "requested_by" uuid               NOT NULL,
  "scope"        text               NOT NULL,
  "period"       text               NOT NULL,
  "format"       text               NOT NULL,
  "status"       "export_job_status" NOT NULL DEFAULT 'PENDING',
  "file_url"     text,
  "expires_at"   timestamp with time zone,
  "created_at"   timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"   timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint

COMMENT ON TABLE "export_jobs" IS
  'Jobs d''export asynchrone de rapports (DB-006). '
  'format : pdf | xlsx | json — validation côté API (REP-003). '
  'status : PENDING → PROCESSING → READY | FAILED. '
  'file_url : URL temporaire signée (null jusqu''à READY). '
  'EXCLUE des AUDITED_TABLES (voir décision dans migration).';
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "export_jobs_bank_id_status_idx"
  ON "export_jobs" ("bank_id", "status");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "export_jobs_bank_id_requested_by_idx"
  ON "export_jobs" ("bank_id", "requested_by");
--> statement-breakpoint

-- ── Privilèges sigfa_app ──────────────────────────────────────────────────────

GRANT SELECT, INSERT, UPDATE, DELETE ON "daily_agency_stats" TO sigfa_app;
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "export_jobs" TO sigfa_app;
--> statement-breakpoint

-- ── RLS : policy tenant_isolation sur les 2 tables ───────────────────────────

ALTER TABLE "daily_agency_stats" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "daily_agency_stats" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "daily_agency_stats";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "daily_agency_stats"
  USING (bank_id = nullif(current_setting('app.current_bank_id', true), '')::uuid)
  WITH CHECK (bank_id = nullif(current_setting('app.current_bank_id', true), '')::uuid);
--> statement-breakpoint

ALTER TABLE "export_jobs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "export_jobs" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "export_jobs";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "export_jobs"
  USING (bank_id = nullif(current_setting('app.current_bank_id', true), '')::uuid)
  WITH CHECK (bank_id = nullif(current_setting('app.current_bank_id', true), '')::uuid);
