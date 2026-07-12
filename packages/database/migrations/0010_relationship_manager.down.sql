-- MODEL-DB-B : rollback de la migration 0010_relationship_manager.sql
-- Idempotent — s'exécute sans erreur sur une base avec ou sans les objets.
-- Ordre : retrait tickets.target_manager_id (index → FK → colonne) → drop colonnes users.
--> statement-breakpoint

-- ── Retrait tickets.target_manager_id (index → FK → colonne) ──────────────────
DROP INDEX IF EXISTS "tickets_target_manager_id_idx";
--> statement-breakpoint
ALTER TABLE "tickets" DROP CONSTRAINT IF EXISTS "tickets_target_manager_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "tickets" DROP COLUMN IF EXISTS "target_manager_id";
--> statement-breakpoint

-- ── Retrait des colonnes conseiller sur users ────────────────────────────────
ALTER TABLE "users" DROP COLUMN IF EXISTS "photo_url";
--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN IF EXISTS "display_name";
--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN IF EXISTS "is_relationship_manager";
