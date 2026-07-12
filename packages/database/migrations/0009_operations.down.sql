-- MODEL-DB-A : rollback de la migration 0009_operations.sql
-- Idempotent — s'exécute sans erreur sur une base avec ou sans données/objets.
-- Ordre : revert RLS operations → drop tickets.operation_id (index/FK/colonne) → drop table operations.
--> statement-breakpoint

-- ── Revert RLS operations ─────────────────────────────────────────────────────
DROP POLICY IF EXISTS tenant_isolation ON operations;
--> statement-breakpoint
ALTER TABLE IF EXISTS "operations" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- ── Retrait tickets.operation_id (index → FK → colonne) ───────────────────────
DROP INDEX IF EXISTS "tickets_operation_id_idx";
--> statement-breakpoint
ALTER TABLE "tickets" DROP CONSTRAINT IF EXISTS "tickets_operation_id_operations_id_fk";
--> statement-breakpoint
ALTER TABLE "tickets" DROP COLUMN IF EXISTS "operation_id";
--> statement-breakpoint

-- ── Drop table operations (index et contraintes tombent avec la table) ────────
DROP TABLE IF EXISTS "operations";
