-- DB-006 : rollback des tables reporting
-- Supprime les tables, index et enum créés par 0005_reporting.sql.
--> statement-breakpoint

DROP TABLE IF EXISTS "export_jobs";
--> statement-breakpoint

DROP TABLE IF EXISTS "daily_agency_stats";
--> statement-breakpoint

DROP TYPE IF EXISTS "export_job_status";
