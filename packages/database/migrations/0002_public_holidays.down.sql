-- DB-009 : rollback (down) de 0002_public_holidays.sql
-- Idempotent — s'exécute sans erreur même si la table est peuplée.
-- Supprime la table public_holidays et révoque les droits associés.
--> statement-breakpoint

REVOKE SELECT ON public_holidays FROM sigfa_app;
--> statement-breakpoint

DROP TABLE IF EXISTS "public_holidays" CASCADE;
