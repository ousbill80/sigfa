-- DB-MISSING-COLUMNS-REPORTING-QUEUES : réconciliation schéma ↔ code + contrat.
--
-- Deux colonnes que le code de production ET le contrat OpenAPI attendent déjà
-- étaient absentes du schéma DB → 500 en prod (`column ... does not exist`).
-- Cette migration ajoute ces colonnes (aucun DROP délibéré préalable — vérifié).
--
-- Bug 1 — daily_agency_stats.agent_available_seconds (MANQUANTE)
--   - 0005_reporting.sql ne matérialise QUE `agent_active_seconds`.
--   - Le service d'agrégation (apps/api/src/reporting/aggregate-service.ts) écrit
--     et lit `agent_available_seconds` (décision D2 : temps agent « disponible »,
--     to_status IN ('AVAILABLE','SERVING') AND seconds > 0), consommée aussi par
--     report-build.job.ts, export-build.job.ts et routes/reports.ts.
--   - Sémantique : secondes de DISPONIBILITÉ agent (AVAILABLE/SERVING), source
--     agent_status_history (DB-001). NULL si aucune entrée d'historique pour la
--     journée — nullable comme `agent_active_seconds`.
--
-- Bug 2 — queues.open_at / queues.close_at (MANQUANTES)
--   - apps/api/src/routes/queues.ts SELECT/UPDATE ces colonnes (open_at/close_at)
--     et expose openAt/closeAt en réponse.
--   - Le contrat (LA LOI) packages/contracts/generated/bundled/core.yaml déclare
--     openAt/closeAt sur la ressource queue, format HH:MM (pattern
--     ^[0-2][0-9]:[0-5][0-9]$, ex. '08:00' / '17:00').
--   - Type `text` nullable (heure locale au format HH:MM), NULL = pas d'horaire.
--
-- sigfa_app dispose déjà de SELECT/INSERT/UPDATE/DELETE sur ces tables via
-- `GRANT ... ON ALL TABLES IN SCHEMA public` (0001_rls.sql) : les nouvelles
-- colonnes sont couvertes sans GRANT supplémentaire (grant au niveau table).
--
-- Migration down : 0016_missing_columns_reporting_queues.down.sql
--> statement-breakpoint

-- ── Bug 1 : daily_agency_stats.agent_available_seconds ────────────────────────
ALTER TABLE "daily_agency_stats" ADD COLUMN IF NOT EXISTS "agent_available_seconds" integer;
--> statement-breakpoint

COMMENT ON COLUMN "daily_agency_stats"."agent_available_seconds" IS
  'Secondes de disponibilité agent (KPI occupation, décision D2). SOURCE : agent_status_history (DB-001). '
  'Somme des intervalles où to_status IN (AVAILABLE, SERVING) et seconds > 0. NULL si pas d''historique. '
  'Matérialisée par aggregate-service.ts (apps/api), non stockée par DB-006 d''origine.';
--> statement-breakpoint

-- ── Bug 2 : queues.open_at / queues.close_at ──────────────────────────────────
ALTER TABLE "queues" ADD COLUMN IF NOT EXISTS "open_at" text;
--> statement-breakpoint

ALTER TABLE "queues" ADD COLUMN IF NOT EXISTS "close_at" text;
--> statement-breakpoint

COMMENT ON COLUMN "queues"."open_at" IS
  'Heure d''ouverture de la file au format HH:MM (heure locale). NULL = pas d''horaire. '
  'Contrat OpenAPI : openAt (pattern ^[0-2][0-9]:[0-5][0-9]$).';
--> statement-breakpoint

COMMENT ON COLUMN "queues"."close_at" IS
  'Heure de fermeture de la file au format HH:MM (heure locale). NULL = pas d''horaire. '
  'Contrat OpenAPI : closeAt (pattern ^[0-2][0-9]:[0-5][0-9]$).';
