-- DB-005 : tables notifications — templates, consents, log, devices, test_recipients
-- Appliqué après 0003_audit_log.sql.
--
-- Contenu :
--   1. Enums : notification_channel, notification_type, notification_status,
--      notification_failure_reason, push_platform (alignés LA LOI notifications.yaml)
--   2. Table notification_templates + unicité (bank_id, type, channel, lang) + RLS
--   3. Table notification_consents + unicité (bank_id, phone_hash, channel) + RLS
--   4. Table notification_log + index (bank_id, ticket_id) et (bank_id, status, created_at) + RLS
--   5. Table notification_devices + unique device_token global + RLS
--   6. Table notification_test_recipients + unicité (bank_id, phone_hash) + RLS
--   7. GRANT sigfa_app (SELECT, INSERT, UPDATE, DELETE) sur les 5 tables
--   8. Trigger d'audit sur notification_templates uniquement (décision documentée)
--
-- Décision d'audit consignée (DB-005) :
--   notification_templates : AUDITÉE — configuration bancaire sensible (mutations par BANK_ADMIN).
--   notification_log : EXCLUE — journal haute fréquence, auditer le journal lui-même crée
--     une boucle de fond et une double comptabilité inutile.
--   notification_devices : EXCLUE — registre technique à fréquence d'upsert élevée ;
--     trigger trop bruité pour être utile à la conformité.
--   notification_consents : EXCLUE — données pseudonymisées (phone_hash) sans FK vers users ;
--     le contexte acteur n'est pas résolvable depuis la table seule.
--   notification_test_recipients : EXCLUE — liste de test interne BANK_ADMIN, volume très faible,
--     mutations tracées applicativement (SEC-001/audit applicatif).
--
-- Convention de nommage phone (DB-005 / DB-008) :
--   phone_encrypted text — chiffrement AES-256-GCM (format DB-008 `v1:iv:tag:ct`), opaque ici.
--   phone_hash text — HMAC-SHA256 (clé env), colonne de recherche déterministe.
--   JAMAIS de colonne `phone` en clair ni de forme masquée (`phone_masked`) en base.
--   Le masquage `phoneNumberMasked` est calculé à la volée par l'API (CONTRACT-007).
--> statement-breakpoint

-- ── Enums ────────────────────────────────────────────────────────────────────

CREATE TYPE "notification_channel" AS ENUM ('SMS', 'WHATSAPP', 'EMAIL', 'PUSH');
--> statement-breakpoint

CREATE TYPE "notification_type" AS ENUM (
  'TICKET_CONFIRMATION',
  'POSITION_UPDATE',
  'YOUR_TURN',
  'DAILY_REPORT'
);
--> statement-breakpoint

CREATE TYPE "notification_status" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'FAILED');
--> statement-breakpoint

CREATE TYPE "notification_failure_reason" AS ENUM (
  'PROVIDER_UNREACHABLE',
  'INVALID_NUMBER',
  'OPT_OUT',
  'TEMPLATE_REJECTED',
  'QUOTA_EXCEEDED',
  'UNKNOWN'
);
--> statement-breakpoint

CREATE TYPE "push_platform" AS ENUM ('IOS', 'ANDROID', 'EXPO');
--> statement-breakpoint

-- ── 1. notification_templates ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "notification_templates" (
  "id"         uuid          PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "bank_id"    uuid          NOT NULL REFERENCES "banks"("id") ON DELETE RESTRICT,
  "type"       "notification_type"    NOT NULL,
  "channel"    "notification_channel" NOT NULL,
  "lang"       text          NOT NULL,
  "body"       text          NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "notification_templates_bank_id_type_channel_lang_key"
    UNIQUE ("bank_id", "type", "channel", "lang")
);
--> statement-breakpoint

COMMENT ON TABLE "notification_templates" IS
  'Templates de notification par banque (DB-005). Unicité (bank_id, type, channel, lang). '
  'Variables autorisées : {{number}}, {{position}}, {{estimate}} — validées côté API (CONTRACT-005). '
  'AUDITÉE : voir décision d''audit dans le fichier de migration.';
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "notification_templates_bank_id_idx"
  ON "notification_templates" ("bank_id");
--> statement-breakpoint

-- ── 2. notification_consents ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "notification_consents" (
  "id"                uuid          PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "bank_id"           uuid          NOT NULL REFERENCES "banks"("id") ON DELETE RESTRICT,
  "phone_encrypted"   text          NOT NULL,
  "phone_hash"        text          NOT NULL,
  "channel"           "notification_channel" NOT NULL,
  "opted_in"          boolean       NOT NULL DEFAULT false,
  "opted_at"          timestamp with time zone,
  "revoked_at"        timestamp with time zone,
  "created_at"        timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"        timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "notification_consents_bank_id_phone_hash_channel_key"
    UNIQUE ("bank_id", "phone_hash", "channel")
);
--> statement-breakpoint

COMMENT ON TABLE "notification_consents" IS
  'Opt-in/opt-out UEMOA par téléphone et canal (DB-005). '
  'phone_encrypted : chiffrement AES-256 opaque (DB-008). '
  'phone_hash : HMAC-SHA256 (clé env, colonne de recherche). '
  'JAMAIS de numéro en clair. '
  'EXCLUE des triggers d''audit (voir décision dans le fichier de migration).';
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "notification_consents_bank_id_idx"
  ON "notification_consents" ("bank_id");
--> statement-breakpoint

-- ── 3. notification_log ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "notification_log" (
  "id"                   uuid          PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "bank_id"              uuid          NOT NULL REFERENCES "banks"("id") ON DELETE RESTRICT,
  "ticket_id"            uuid,
  "type"                 "notification_type"    NOT NULL,
  "channel"              "notification_channel" NOT NULL,
  "phone_hash"           text,
  "device_id"            uuid,
  "status"               "notification_status"  NOT NULL DEFAULT 'QUEUED',
  "failure_reason"       "notification_failure_reason",
  "provider_message_id"  text,
  "created_at"           timestamp with time zone NOT NULL DEFAULT now(),
  "sent_at"              timestamp with time zone,
  "delivered_at"         timestamp with time zone
);
--> statement-breakpoint

COMMENT ON TABLE "notification_log" IS
  'Journal d''envoi des notifications (DB-005). '
  'phone_hash uniquement (jamais phone_encrypted ni masquage stocké). '
  'Le masquage phoneNumberMasked est calculé par l''API (CONTRACT-007). '
  'failure_reason : enum NotificationFailureReason de LA LOI. '
  'EXCLUE des triggers d''audit (voir décision dans le fichier de migration).';
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "notification_log_bank_id_ticket_id_idx"
  ON "notification_log" ("bank_id", "ticket_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "notification_log_bank_id_status_created_at_idx"
  ON "notification_log" ("bank_id", "status", "created_at");
--> statement-breakpoint

-- ── 4. notification_devices ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "notification_devices" (
  "id"            uuid          PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "bank_id"       uuid          NOT NULL REFERENCES "banks"("id") ON DELETE RESTRICT,
  "device_token"  text          NOT NULL UNIQUE,
  "platform"      "push_platform" NOT NULL,
  "phone_hash"    text,
  "last_seen"     timestamp with time zone NOT NULL DEFAULT now(),
  "revoked_at"    timestamp with time zone,
  "created_at"    timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint

COMMENT ON TABLE "notification_devices" IS
  'Registre des devices push (DB-005). '
  'device_token UNIQUE global : un token appartient à une seule banque. '
  'Ré-enregistrement idempotent : ON CONFLICT (device_token) DO UPDATE. '
  'phone_hash optionnel (lien abonné). JAMAIS phone_encrypted dans cette table. '
  'EXCLUE des triggers d''audit (voir décision dans le fichier de migration).';
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "notification_devices_bank_id_idx"
  ON "notification_devices" ("bank_id");
--> statement-breakpoint

-- ── 5. notification_test_recipients ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "notification_test_recipients" (
  "id"                uuid          PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "bank_id"           uuid          NOT NULL REFERENCES "banks"("id") ON DELETE RESTRICT,
  "phone_hash"        text          NOT NULL,
  "phone_encrypted"   text          NOT NULL,
  "added_by"          uuid          NOT NULL,
  "added_at"          timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "notification_test_recipients_bank_id_phone_hash_key"
    UNIQUE ("bank_id", "phone_hash")
);
--> statement-breakpoint

COMMENT ON TABLE "notification_test_recipients" IS
  'Liste blanche des destinataires de test (DB-005). '
  'Support du 422 TEST_RECIPIENT_NOT_ALLOWED (CONTRACT-007). '
  'Unicité (bank_id, phone_hash). JAMAIS de numéro en clair. '
  'EXCLUE des triggers d''audit (voir décision dans le fichier de migration).';
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "notification_test_recipients_bank_id_idx"
  ON "notification_test_recipients" ("bank_id");
--> statement-breakpoint

-- ── Privilèges sigfa_app sur les 5 tables ────────────────────────────────────
-- notification_log : pas de DELETE (journal — suppression par job d'exploitation DB-008)
GRANT SELECT, INSERT, UPDATE, DELETE ON "notification_templates" TO sigfa_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "notification_consents" TO sigfa_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "notification_log" TO sigfa_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "notification_devices" TO sigfa_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "notification_test_recipients" TO sigfa_app;
--> statement-breakpoint

-- ── RLS : policy tenant_isolation sur les 5 tables ───────────────────────────

ALTER TABLE "notification_templates" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "notification_templates" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "notification_templates";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "notification_templates"
  USING (bank_id = nullif(current_setting('app.current_bank_id', true), '')::uuid)
  WITH CHECK (bank_id = nullif(current_setting('app.current_bank_id', true), '')::uuid);
--> statement-breakpoint

ALTER TABLE "notification_consents" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "notification_consents" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "notification_consents";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "notification_consents"
  USING (bank_id = nullif(current_setting('app.current_bank_id', true), '')::uuid)
  WITH CHECK (bank_id = nullif(current_setting('app.current_bank_id', true), '')::uuid);
--> statement-breakpoint

ALTER TABLE "notification_log" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "notification_log" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "notification_log";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "notification_log"
  USING (bank_id = nullif(current_setting('app.current_bank_id', true), '')::uuid)
  WITH CHECK (bank_id = nullif(current_setting('app.current_bank_id', true), '')::uuid);
--> statement-breakpoint

ALTER TABLE "notification_devices" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "notification_devices" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "notification_devices";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "notification_devices"
  USING (bank_id = nullif(current_setting('app.current_bank_id', true), '')::uuid)
  WITH CHECK (bank_id = nullif(current_setting('app.current_bank_id', true), '')::uuid);
--> statement-breakpoint

ALTER TABLE "notification_test_recipients" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "notification_test_recipients" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "notification_test_recipients";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "notification_test_recipients"
  USING (bank_id = nullif(current_setting('app.current_bank_id', true), '')::uuid)
  WITH CHECK (bank_id = nullif(current_setting('app.current_bank_id', true), '')::uuid);
--> statement-breakpoint

-- ── Trigger d'audit sur notification_templates uniquement ────────────────────
-- Les autres tables notifications sont exclues (décision documentée ci-dessus).
DROP TRIGGER IF EXISTS audit_change ON "notification_templates";
--> statement-breakpoint
CREATE TRIGGER audit_change
  AFTER INSERT OR UPDATE OR DELETE ON "notification_templates"
  FOR EACH ROW EXECUTE FUNCTION audit_row_change();
