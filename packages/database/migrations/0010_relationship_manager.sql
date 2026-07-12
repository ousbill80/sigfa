-- MODEL-DB-B : Schéma conseiller — flag sur `users` + `tickets.target_manager_id`
-- Appliqué après 0009_operations.sql. STRICTEMENT ADDITIF (non destructif).
--
-- Décisions (docs/prd/model/_arbitrage.md) :
--   D5 — Conseiller = liste publique NOMINATIVE (pas de CRM) :
--        `users.is_relationship_manager` bool NOT NULL default false,
--        `display_name` text NULLABLE, `photo_url` text NULLABLE.
--        `users` est DÉJÀ sous RLS (policy tenant_isolation, exception SUPER_ADMIN) →
--        les nouvelles colonnes HÉRITENT de la policy existante. AUCUNE nouvelle policy.
--        Aucun GRANT supplémentaire : `users` est déjà couverte par 0001_rls.sql.
--   D6 — `tickets.target_manager_id` uuid NULLABLE FK users (RESTRICT) + index.
--        Pas de nouvelle table file — la file conseiller = filtre `target_manager_id`
--        (queue logique, routage en API-B). Additif : ne touche pas service_id/operation_id/queue_id.
--
-- Migration down : 0010_relationship_manager.down.sql
--> statement-breakpoint

-- ── users : flag conseiller + attributs publics (D5) ─────────────────────────
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "is_relationship_manager" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "display_name" text;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "photo_url" text;
--> statement-breakpoint

COMMENT ON COLUMN "users"."is_relationship_manager" IS
  'Conseiller « relationship manager » (MODEL-DB-B, D5). NOT NULL default false. '
  'Filtre de la liste publique nominative (is_relationship_manager AND is_active AND deleted_at IS NULL). '
  'AUCUN lien client↔conseiller attitré (hors-scope CRM, CLAUDE.md §5).';
--> statement-breakpoint
COMMENT ON COLUMN "users"."display_name" IS
  'Nom d''affichage public du conseiller (liste publique — zéro PII). NULLABLE.';
--> statement-breakpoint
COMMENT ON COLUMN "users"."photo_url" IS
  'URL de la photo publique du conseiller (optionnelle). NULLABLE.';
--> statement-breakpoint

-- ── tickets.target_manager_id NULLABLE FK users (RESTRICT) + index (D6) ───────
ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "target_manager_id" uuid;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tickets" ADD CONSTRAINT "tickets_target_manager_id_users_id_fk" FOREIGN KEY ("target_manager_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tickets_target_manager_id_idx" ON "tickets" USING btree ("target_manager_id");
--> statement-breakpoint

COMMENT ON COLUMN "tickets"."target_manager_id" IS
  'Conseiller ciblé par le ticket (FK users, RESTRICT). NULLABLE (MODEL-DB-B, D6). '
  'Quand fourni : file PERSONNELLE du conseiller (routage mono-agent, logique en API-B). '
  'Additif : ne touche pas service_id/operation_id/queue_id. Pas de nouvelle table file.';
