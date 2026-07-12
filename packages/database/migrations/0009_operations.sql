-- MODEL-DB-A : Schéma `operations` + `tickets.operation_id` + RLS + backfill idempotent
-- Appliqué après 0008_required_language.sql.
--
-- Décisions (docs/prd/model/_arbitrage.md) :
--   D1 — ADDITIF : `tickets.operation_id` NULLABLE ajouté ; `tickets.service_id` CONSERVÉ NOT NULL.
--   D3 — Migration additive : les services RESTENT des services ; backfill idempotent
--        d'une opération « défaut » par service existant (PAS de service par défaut global).
--   D4 — `sla_minutes` NULLABLE (NULL → hérite du service). AUCUNE colonne `priority`.
--   D8 — RLS ENABLE + FORCE + policy tenant_isolation(bank_id) + GRANT sigfa_app.
--
-- Migration down : 0009_operations.down.sql
--> statement-breakpoint

-- ── Table operations (enfant de services) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS "operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bank_id" uuid NOT NULL,
	"agency_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"code" varchar(6) NOT NULL,
	"name" text NOT NULL,
	"sla_minutes" integer,
	"display_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"icon_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operations_service_id_code_key" UNIQUE("service_id","code"),
	CONSTRAINT "operations_code_format" CHECK ("operations"."code" ~ '^[A-Z0-9]{2,6}$'),
	CONSTRAINT "operations_sla_minutes_positive" CHECK ("operations"."sla_minutes" IS NULL OR "operations"."sla_minutes" >= 1)
);
--> statement-breakpoint

-- ── FK operations → banks / agencies / services (RESTRICT) ────────────────────
DO $$ BEGIN
 ALTER TABLE "operations" ADD CONSTRAINT "operations_bank_id_banks_id_fk" FOREIGN KEY ("bank_id") REFERENCES "public"."banks"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "operations" ADD CONSTRAINT "operations_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "operations" ADD CONSTRAINT "operations_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- ── Index operations ──────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "operations_bank_id_agency_id_idx" ON "operations" USING btree ("bank_id","agency_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "operations_service_id_idx" ON "operations" USING btree ("service_id");
--> statement-breakpoint

-- ── tickets.operation_id NULLABLE FK RESTRICT (D1 — service_id CONSERVÉ NOT NULL) ─
ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "operation_id" uuid;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tickets" ADD CONSTRAINT "tickets_operation_id_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."operations"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tickets_operation_id_idx" ON "tickets" USING btree ("operation_id");
--> statement-breakpoint

COMMENT ON COLUMN "tickets"."operation_id" IS
  'Opération demandée (FK operations, RESTRICT). NULLABLE (MODEL-DB-A, D1). '
  'Additif : service_id reste NOT NULL, dérivé applicativement de operations.service_id.';
--> statement-breakpoint

-- ── GRANT CRUD au rôle applicatif (D8) ────────────────────────────────────────
-- Idempotent : GRANT sur une table déjà accordée est un no-op.
GRANT SELECT, INSERT, UPDATE, DELETE ON "operations" TO sigfa_app;
--> statement-breakpoint

-- ── RLS operations : ENABLE + FORCE + policy tenant_isolation(bank_id) (D8) ────
-- Pattern COPIÉ à l'identique de 0001_rls.sql (uniformité des 27 tables).
ALTER TABLE "operations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "operations" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON operations;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON operations
  USING (bank_id = nullif(current_setting('app.current_bank_id', true), '')::uuid)
  WITH CHECK (bank_id = nullif(current_setting('app.current_bank_id', true), '')::uuid);
--> statement-breakpoint

-- ── Backfill idempotent : une opération « défaut » par service existant (D3) ──
-- Les services RESTENT des services. Le code de l'opération défaut = code du service
-- (déjà conforme ^[A-Z0-9]{2,6}$ car services.code ~ ^[A-Z]{2,4}$), unique par service.
-- sla_minutes = NULL → hérite du service. name = nom du service. Réexécutable sans doublon
-- grâce au WHERE NOT EXISTS (garde d'existence sur (service_id, code)).
INSERT INTO "operations" (bank_id, agency_id, service_id, code, name, sla_minutes, display_order, is_active)
SELECT s.bank_id, s.agency_id, s.id, s.code, s.name, NULL, 0, true
FROM "services" s
WHERE NOT EXISTS (
  SELECT 1 FROM "operations" o
  WHERE o.service_id = s.id AND o.code = s.code
);
