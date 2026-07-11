-- DB-009 : rollback (down) de 0000_dry_nuke.sql
-- Idempotent — s'exécute sans erreur même si les tables sont peuplées.
-- Supprime toutes les tables du schéma initial SIGFA dans l'ordre inverse
-- des dépendances FK, puis les types ENUM.
--> statement-breakpoint

-- ── Tables (ordre inverse des FK) ────────────────────────────────────────────
DROP TABLE IF EXISTS "tickets" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "ticket_transfers" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "agent_status_history" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "user_services" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "agency_users" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "kiosks" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "counter_services" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "counters" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "queues" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "services" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "agency_exceptional_closures" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "agencies" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "users" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "banks" CASCADE;
--> statement-breakpoint

-- ── Types ENUM ───────────────────────────────────────────────────────────────
DROP TYPE IF EXISTS "public"."ticket_status" CASCADE;
--> statement-breakpoint
DROP TYPE IF EXISTS "public"."ticket_priority" CASCADE;
--> statement-breakpoint
DROP TYPE IF EXISTS "public"."ticket_channel" CASCADE;
--> statement-breakpoint
DROP TYPE IF EXISTS "public"."role" CASCADE;
--> statement-breakpoint
DROP TYPE IF EXISTS "public"."queue_status" CASCADE;
--> statement-breakpoint
DROP TYPE IF EXISTS "public"."printer_status" CASCADE;
--> statement-breakpoint
DROP TYPE IF EXISTS "public"."counter_status" CASCADE;
--> statement-breakpoint
DROP TYPE IF EXISTS "public"."agent_status" CASCADE;
--> statement-breakpoint
DROP TYPE IF EXISTS "public"."agent_language" CASCADE;
