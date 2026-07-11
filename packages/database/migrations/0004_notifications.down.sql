-- DB-005 : rollback (down) de 0004_notifications.sql
-- Idempotent — s'exécute sans erreur sur une base seedée.
-- Supprime les triggers, les tables, puis les types enum dans l'ordre inverse.
--> statement-breakpoint

-- ── Triggers d'audit ─────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS audit_change ON "notification_templates";
--> statement-breakpoint

-- ── Tables ───────────────────────────────────────────────────────────────────
DROP TABLE IF EXISTS "notification_test_recipients" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "notification_devices" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "notification_log" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "notification_consents" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "notification_templates" CASCADE;
--> statement-breakpoint

-- ── Enums ────────────────────────────────────────────────────────────────────
DROP TYPE IF EXISTS "push_platform";
--> statement-breakpoint
DROP TYPE IF EXISTS "notification_failure_reason";
--> statement-breakpoint
DROP TYPE IF EXISTS "notification_status";
--> statement-breakpoint
DROP TYPE IF EXISTS "notification_type";
--> statement-breakpoint
DROP TYPE IF EXISTS "notification_channel";
