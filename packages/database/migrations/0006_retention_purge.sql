-- DB-008 : chiffrement AES-GCM des téléphones (applicatif) + purge droit à l'oubli
-- Appliqué après 0005_reporting.sql.
--
-- Contenu SQL de cette migration :
--   1. Table retention_policies (bank_id unique, phone_retention_months défaut 13,
--      CHECK borné 1..60) + RLS + tenant_isolation + GRANT sigfa_app.
--
-- HORS SQL (applicatif, dans src/crypto/) :
--   - phone-cipher.ts : AES-256-GCM (clé PHONE_ENCRYPTION_KEY, jamais en base) +
--     HMAC-SHA256 (clé PHONE_HASH_KEY). AUCUN pgcrypto : la clé ne transite jamais
--     vers PostgreSQL, les dumps sont chiffrés par construction.
--   - purge.ts : purgeExpiredPhones() (anonymisation des tickets clos > rétention et
--     des consentements révoqués expirés) + purgePhone(bankId, phone) (purge manuelle
--     droit à l'oubli). Les deux écrivent une entrée audit_log DATA_PURGE (hash tronqué,
--     jamais le téléphone en clair).
--
-- AUCUNE ALTER sur les colonnes phone_encrypted/phone_hash : elles sont créées au type
-- définitif (text) par DB-001/DB-005.
--
-- Migration down : 0006_retention_purge.down.sql
--> statement-breakpoint

-- ── retention_policies : politique de rétention des téléphones par banque ──────
--
-- phone_retention_months : durée en mois avant anonymisation d'un ticket clos ou
-- d'un consentement révoqué. Défaut 13 (UEMOA). Borné 1..60 (CHECK).
-- Une seule politique par banque (bank_id UNIQUE).

CREATE TABLE IF NOT EXISTS "retention_policies" (
  "id"                     uuid    PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "bank_id"                uuid    NOT NULL REFERENCES "banks"("id") ON DELETE RESTRICT,
  "phone_retention_months" integer NOT NULL DEFAULT 13,
  "created_at"             timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"             timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "retention_policies_bank_id_key" UNIQUE ("bank_id"),
  CONSTRAINT "retention_policies_months_range"
    CHECK ("phone_retention_months" >= 1 AND "phone_retention_months" <= 60)
);
--> statement-breakpoint

COMMENT ON TABLE "retention_policies" IS
  'Politique de rétention des téléphones par banque (DB-008). '
  'phone_retention_months : mois avant anonymisation (défaut 13 UEMOA, borné 1..60). '
  'Consommée par purgeExpiredPhones() — anonymisation, pas suppression du ticket agrégé.';
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "retention_policies_bank_id_idx"
  ON "retention_policies" ("bank_id");
--> statement-breakpoint

-- ── Privilèges sigfa_app ──────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON "retention_policies" TO sigfa_app;
--> statement-breakpoint

-- ── RLS : policy tenant_isolation ─────────────────────────────────────────────
ALTER TABLE "retention_policies" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "retention_policies" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "retention_policies";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "retention_policies"
  USING (bank_id = nullif(current_setting('app.current_bank_id', true), '')::uuid)
  WITH CHECK (bank_id = nullif(current_setting('app.current_bank_id', true), '')::uuid);
