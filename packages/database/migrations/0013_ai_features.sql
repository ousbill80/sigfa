-- DB-AI-FEATURES : table ai_features — matérialisation du feature-set IA-001
-- Appliquée après 0012_whatsapp_config.sql.
--
-- Couture IA-001 (CONTRACT-008) :
--   Persistance RÉELLE du pipeline features (remplace InMemoryFeatureStore de
--   apps/api/src/ai/feature-store.ts). Chaque colonne reflète un champ du
--   FeatureRecord de computeFeatureSet (apps/api/src/ai/feature-engine.ts) :
--     - mesures de bucket d'affluence (arrivals/served/no_show/abandoned, TMA/TMT,
--       p90, guichets/agents) — issues REP-001, non recalculées
--     - features calendaires (day_of_week + flags + factors JSONB)
--     - features LAG (J-1, J-7, moyenne glissante 4 semaines)
--     - métadonnées (is_partial, available_days, feature_set_version)
--
-- Clé d'idempotence (upsert IA-001) :
--   UNIQUE (bank_id, agency_id, service_id, date, hour_bucket, feature_set_version)
--   NULLS NOT DISTINCT (PG16) — service_id NULL (« tous services ») reste une clé
--   canonique unique. Rejouer la même fenêtre => mêmes lignes (ON CONFLICT DO UPDATE),
--   exactement comme canonicalKey du store en mémoire (serviceId ?? "∅").
--
-- Dénormalisation : bank_id (isolation RLS) + agency_id (requêtes agence), FK RESTRICT.
-- service_id : text nullable SANS FK (identifiant opaque du pipeline, agrégat possible).
--
-- Rétention IA (DB-007/DB-008) : cache de calcul purgé si computed_at < now - 24 mois
--   par purgeAiHistory() (src/ai/index.ts) — cohérent avec les autres tables ai_*.
--
-- Décision d'audit : EXCLUE de AUDITED_TABLES (agrégats IA à volume élevé, upsert idempotent).
-- Zéro donnée personnelle : uniquement des agrégats numériques/calendaires (conformité UEMOA).
--
-- Migration down : 0013_ai_features.down.sql
--> statement-breakpoint

-- ── ai_features ────────────────────────────────────────────────────────────────
--
-- Matérialisation du feature-set d'affluence (DB-AI-FEATURES).

CREATE TABLE IF NOT EXISTS "ai_features" (
  "id"                    uuid    PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "bank_id"               uuid    NOT NULL REFERENCES "banks"("id") ON DELETE RESTRICT,
  "agency_id"             uuid    NOT NULL REFERENCES "agencies"("id") ON DELETE RESTRICT,
  "service_id"            text,
  "date"                  date    NOT NULL,
  "hour_bucket"           integer NOT NULL,
  "bucket_minutes"        integer NOT NULL,
  "arrivals"              integer NOT NULL,
  "served"                integer NOT NULL,
  "no_show"               integer NOT NULL,
  "abandoned"             integer NOT NULL,
  "avg_wait_seconds"      double precision,
  "p90_wait_seconds"      double precision NOT NULL,
  "avg_service_seconds"   double precision,
  "counters_open"         integer NOT NULL,
  "agents_active"         integer NOT NULL,
  "day_of_week"           integer NOT NULL,
  "is_month_end"          boolean NOT NULL,
  "is_public_pay_day"     boolean NOT NULL,
  "is_public_holiday"     boolean NOT NULL,
  "is_eve_of_holiday"     boolean NOT NULL,
  "factors"               jsonb   NOT NULL DEFAULT '["NONE"]'::jsonb,
  "arrivals_lag_1d"       integer,
  "arrivals_lag_7d"       integer,
  "arrivals_roll_mean_4w" double precision,
  "is_partial"            boolean NOT NULL,
  "available_days"        integer NOT NULL,
  "feature_set_version"   text    NOT NULL,
  "computed_at"           timestamp with time zone NOT NULL DEFAULT now(),
  "created_at"            timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"            timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint

COMMENT ON TABLE "ai_features" IS
  'Matérialisation du feature-set d''affluence IA-001 (DB-AI-FEATURES). '
  'Mesures bucket (REP-001) + calendaires + lags + is_partial/available_days/feature_set_version. '
  'Unique (bank,agency,service,date,hour_bucket,feature_set_version) NULLS NOT DISTINCT — upsert idempotent. '
  'service_id nullable = tous services (sans FK). '
  'Rétention : purgée si computed_at < now - 24 mois. '
  'EXCLUE des AUDITED_TABLES (agrégats IA). Zéro donnée personnelle.';
--> statement-breakpoint

COMMENT ON COLUMN "ai_features"."service_id" IS
  'Identifiant opaque du service (nullable = tous services confondus). '
  'Pas de FK : le pipeline IA-001 le traite comme un identifiant opaque.';
--> statement-breakpoint

-- Unicité canonique IA-001 (idempotence upsert). NULLS NOT DISTINCT : service_id
-- NULL est traité comme une valeur — la clé (…, service_id NULL, …) reste unique.
CREATE UNIQUE INDEX IF NOT EXISTS "ai_features_unique_feature"
  ON "ai_features" ("bank_id", "agency_id", "service_id", "date", "hour_bucket", "feature_set_version")
  NULLS NOT DISTINCT;
--> statement-breakpoint

-- Index (bank_id, agency_id, date) — requêtes par agence et date (convention F2).
CREATE INDEX IF NOT EXISTS "ai_features_bank_agency_date_idx"
  ON "ai_features" ("bank_id", "agency_id", "date");
--> statement-breakpoint

-- Index (bank_id, computed_at) — support de la purge rétention 24 mois.
CREATE INDEX IF NOT EXISTS "ai_features_bank_computed_idx"
  ON "ai_features" ("bank_id", "computed_at");
--> statement-breakpoint

-- ── Privilèges sigfa_app ──────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON "ai_features" TO sigfa_app;
--> statement-breakpoint

-- ── RLS : policy tenant_isolation ─────────────────────────────────────────────
ALTER TABLE "ai_features" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "ai_features" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "ai_features";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "ai_features"
  USING (bank_id = nullif(current_setting('app.current_bank_id', true), '')::uuid)
  WITH CHECK (bank_id = nullif(current_setting('app.current_bank_id', true), '')::uuid);
