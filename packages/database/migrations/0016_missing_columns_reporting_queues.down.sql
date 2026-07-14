-- DB-MISSING-COLUMNS-REPORTING-QUEUES : rollback de
-- 0016_missing_columns_reporting_queues.sql.
--
-- Retire les 3 colonnes ajoutées, restaurant l'état 0015 (schéma en retard sur
-- le code — état bogué d'origine). Réversibilité up→down→up validée par le test.
--> statement-breakpoint

ALTER TABLE "queues" DROP COLUMN IF EXISTS "close_at";
--> statement-breakpoint

ALTER TABLE "queues" DROP COLUMN IF EXISTS "open_at";
--> statement-breakpoint

ALTER TABLE "daily_agency_stats" DROP COLUMN IF EXISTS "agent_available_seconds";
