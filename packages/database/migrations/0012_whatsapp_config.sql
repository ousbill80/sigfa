-- DB-NOTIF (migration 0012) : schéma réel WhatsApp + enums CONTRACT-013.
-- Appliqué après 0011_restrict_agent_language.sql.
--
-- Contexte :
--   Les stories NOTIF-002/003 (déjà livrées) s'appuient sur des éléments de schéma
--   exercés via DDL de harnais de test API mais ABSENTS du schéma réel. Cette
--   migration ferme le trou (additif). Le schéma Drizzle = vérité du modèle
--   (conforme CONTRACT-013 déjà mergé).
--
-- Contenu (additif) :
--   1. Enum notification_type : + POSITION_NEAR, POSITION_NEXT (CONTRACT-013 / NOTIF-002).
--   2. Enum consent_source : AGENT, KIOSK, WEB, INBOUND_WHATSAPP, IMPORT (CONTRACT-013).
--   3. notification_consents : + colonne source consent_source (nullable) — consentement
--      par canal déjà couvert par l'unicité (bank_id, phone_hash, channel) préexistante.
--   4. Table whatsapp_config (config WhatsApp Business par banque) + RLS + GRANT.
--   5. Table whatsapp_menu_mapping (mot-clé → service par banque) + RLS + GRANT.
--   6. Table whatsapp_inbound_messages (idempotence entrant) + RLS + GRANT.
--
-- Consentement PAR CANAL :
--   notification_consents porte déjà la colonne channel + unicité
--   (bank_id, phone_hash, channel) : un abonné a un consentement DISTINCT par canal
--   (SMS ≠ WHATSAPP). Aucune modification de ce contrat — seule la traçabilité
--   d'origine (source) est ajoutée.
--
-- Migration down : 0012_whatsapp_config.down.sql
--> statement-breakpoint

-- ── 1. Enum notification_type : ajout POSITION_NEAR, POSITION_NEXT (additif) ──
ALTER TYPE "notification_type" ADD VALUE IF NOT EXISTS 'POSITION_NEAR';
--> statement-breakpoint
ALTER TYPE "notification_type" ADD VALUE IF NOT EXISTS 'POSITION_NEXT';
--> statement-breakpoint

-- ── 2. Enum consent_source (nouveau, CONTRACT-013) ───────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'consent_source') THEN
    CREATE TYPE "consent_source" AS ENUM ('AGENT', 'KIOSK', 'WEB', 'INBOUND_WHATSAPP', 'IMPORT');
  END IF;
END $$;
--> statement-breakpoint

-- ── 3. notification_consents : colonne source (nullable, traçabilité opt-in) ──
ALTER TABLE "notification_consents"
  ADD COLUMN IF NOT EXISTS "source" "consent_source";
--> statement-breakpoint

COMMENT ON COLUMN "notification_consents"."source" IS
  'Origine tracée du consentement opt-in (LA LOI ConsentSource, nullable — additif CONTRACT-013). '
  'INBOUND_WHATSAPP pour un opt-in créé par un message WhatsApp entrant (NOTIF-003). '
  'Consentement PAR CANAL assuré par l''unicité (bank_id, phone_hash, channel).';
--> statement-breakpoint

-- ── 4. whatsapp_config (config WhatsApp Business par banque, C4) ──────────────
CREATE TABLE IF NOT EXISTS "whatsapp_config" (
  "bank_id"            uuid          PRIMARY KEY REFERENCES "banks"("id") ON DELETE RESTRICT,
  "business_number"    text,
  "webhook_secret"     text,
  "default_agency_id"  uuid          REFERENCES "agencies"("id") ON DELETE RESTRICT,
  "enabled"            boolean       NOT NULL DEFAULT false,
  "created_at"         timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"         timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint

COMMENT ON TABLE "whatsapp_config" IS
  'Configuration WhatsApp Business par banque (DB-NOTIF, C4). bank_id = clé primaire (une config par banque). '
  'webhook_secret : secret HMAC-SHA256 propre à la banque (jamais journalisé). '
  'default_agency_id : agence par défaut des tickets créés par message entrant.';
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "whatsapp_config_bank_id_idx"
  ON "whatsapp_config" ("bank_id");
--> statement-breakpoint

-- ── 5. whatsapp_menu_mapping (mot-clé → service par banque, C4) ───────────────
CREATE TABLE IF NOT EXISTS "whatsapp_menu_mapping" (
  "id"          uuid          PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "bank_id"     uuid          NOT NULL REFERENCES "banks"("id") ON DELETE RESTRICT,
  "keyword"     text          NOT NULL,
  "service_id"  uuid          NOT NULL REFERENCES "services"("id") ON DELETE RESTRICT,
  "created_at"  timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"  timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "whatsapp_menu_mapping_bank_id_keyword_key" UNIQUE ("bank_id", "keyword")
);
--> statement-breakpoint

COMMENT ON TABLE "whatsapp_menu_mapping" IS
  'Mapping menu (mot-clé → service) par banque (DB-NOTIF, C4). Unicité (bank_id, keyword). '
  'Utilisé par le routage NLU règles des messages WhatsApp entrants (NOTIF-003).';
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "whatsapp_menu_mapping_bank_id_idx"
  ON "whatsapp_menu_mapping" ("bank_id");
--> statement-breakpoint

-- ── 6. whatsapp_inbound_messages (idempotence entrant, NOTIF-003) ─────────────
CREATE TABLE IF NOT EXISTS "whatsapp_inbound_messages" (
  "id"                   uuid          PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "bank_id"              uuid          NOT NULL REFERENCES "banks"("id") ON DELETE RESTRICT,
  "provider_message_id"  text          NOT NULL,
  "created_at"           timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "whatsapp_inbound_messages_bank_id_provider_message_id_key"
    UNIQUE ("bank_id", "provider_message_id")
);
--> statement-breakpoint

COMMENT ON TABLE "whatsapp_inbound_messages" IS
  'Idempotence des messages WhatsApp entrants (DB-NOTIF, NOTIF-003). '
  'Unicité (bank_id, provider_message_id) : un message fournisseur traité une seule fois par banque.';
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "whatsapp_inbound_messages_bank_id_idx"
  ON "whatsapp_inbound_messages" ("bank_id");
--> statement-breakpoint

-- ── Privilèges sigfa_app sur les 3 nouvelles tables ──────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON "whatsapp_config" TO sigfa_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "whatsapp_menu_mapping" TO sigfa_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "whatsapp_inbound_messages" TO sigfa_app;
--> statement-breakpoint

-- ── RLS : ENABLE + FORCE + policy tenant_isolation(bank_id) sur les 3 tables ──
ALTER TABLE "whatsapp_config" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "whatsapp_config" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "whatsapp_config";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "whatsapp_config"
  USING (bank_id = nullif(current_setting('app.current_bank_id', true), '')::uuid)
  WITH CHECK (bank_id = nullif(current_setting('app.current_bank_id', true), '')::uuid);
--> statement-breakpoint

ALTER TABLE "whatsapp_menu_mapping" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "whatsapp_menu_mapping" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "whatsapp_menu_mapping";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "whatsapp_menu_mapping"
  USING (bank_id = nullif(current_setting('app.current_bank_id', true), '')::uuid)
  WITH CHECK (bank_id = nullif(current_setting('app.current_bank_id', true), '')::uuid);
--> statement-breakpoint

ALTER TABLE "whatsapp_inbound_messages" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "whatsapp_inbound_messages" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "whatsapp_inbound_messages";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "whatsapp_inbound_messages"
  USING (bank_id = nullif(current_setting('app.current_bank_id', true), '')::uuid)
  WITH CHECK (bank_id = nullif(current_setting('app.current_bank_id', true), '')::uuid);
