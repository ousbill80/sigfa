-- DB-007 : rollback de la migration 0007_ai_tables.sql
-- Supprime les 4 tables IA et les 4 enums (par cascade DROP TABLE).
--> statement-breakpoint

DROP TABLE IF EXISTS "ai_quality_scores";
--> statement-breakpoint

DROP TABLE IF EXISTS "ai_anomalies";
--> statement-breakpoint

DROP TABLE IF EXISTS "ai_staffing_recommendations";
--> statement-breakpoint

DROP TABLE IF EXISTS "ai_forecasts";
--> statement-breakpoint

DROP TYPE IF EXISTS "anomaly_status";
--> statement-breakpoint

DROP TYPE IF EXISTS "anomaly_type";
--> statement-breakpoint

DROP TYPE IF EXISTS "staffing_ack_status";
--> statement-breakpoint

DROP TYPE IF EXISTS "contextual_factor";
