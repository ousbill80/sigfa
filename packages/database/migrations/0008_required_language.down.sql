-- DB-010 : rollback de la migration 0008_required_language.sql
-- Supprime la colonne required_language de la table tickets.
--> statement-breakpoint

ALTER TABLE "tickets" DROP COLUMN IF EXISTS "required_language";
