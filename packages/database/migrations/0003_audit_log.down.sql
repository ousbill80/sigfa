-- DB-004 : rollback (down) de 0003_audit_log.sql
-- Idempotent — s'exécute sans erreur sur une base seedée (audit_log peuplée).
-- Supprime d'abord les triggers d'audit des tables sensibles, puis les fonctions,
-- puis la table audit_log (avec ses triggers d'immuabilité et sa policy RLS).
--> statement-breakpoint

DROP TRIGGER IF EXISTS audit_change ON "banks";
--> statement-breakpoint
DROP TRIGGER IF EXISTS audit_change ON "agencies";
--> statement-breakpoint
DROP TRIGGER IF EXISTS audit_change ON "services";
--> statement-breakpoint
DROP TRIGGER IF EXISTS audit_change ON "counters";
--> statement-breakpoint
DROP TRIGGER IF EXISTS audit_change ON "users";
--> statement-breakpoint
DROP TRIGGER IF EXISTS audit_change ON "kiosks";
--> statement-breakpoint

DROP FUNCTION IF EXISTS audit_row_change() CASCADE;
--> statement-breakpoint

-- Les triggers d'immuabilité disparaissent avec la table (DROP TABLE CASCADE),
-- mais on les retire explicitement d'abord pour lisibilité.
DROP TRIGGER IF EXISTS audit_log_no_update ON "audit_log";
--> statement-breakpoint
DROP TRIGGER IF EXISTS audit_log_no_delete ON "audit_log";
--> statement-breakpoint

DROP TABLE IF EXISTS "audit_log" CASCADE;
--> statement-breakpoint

DROP FUNCTION IF EXISTS audit_log_reject_mutation() CASCADE;
