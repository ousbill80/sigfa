-- Down de 0012_whatsapp_config.sql : retire les tables WhatsApp, la colonne
-- notification_consents.source + le type consent_source, et restaure le type
-- notification_type à 4 valeurs (retrait de POSITION_NEAR / POSITION_NEXT).
--
-- ATTENTION : PostgreSQL ne permet pas de retirer une valeur d'un type enum.
-- La stratégie (comme 0011) est de recréer notification_type puis de re-typer les
-- colonnes qui l'utilisent (notification_templates.type, notification_log.type).
-- Toute ligne portant POSITION_NEAR/POSITION_NEXT bloquerait le re-typage — le down
-- suppose l'absence de telles données (cohérent avec un rollback de forme).
--> statement-breakpoint

-- ── Tables WhatsApp (ordre inverse de création) ──────────────────────────────
DROP TABLE IF EXISTS "whatsapp_inbound_messages";
--> statement-breakpoint
DROP TABLE IF EXISTS "whatsapp_menu_mapping";
--> statement-breakpoint
DROP TABLE IF EXISTS "whatsapp_config";
--> statement-breakpoint

-- ── notification_consents.source + type consent_source ───────────────────────
ALTER TABLE "notification_consents" DROP COLUMN IF EXISTS "source";
--> statement-breakpoint
DROP TYPE IF EXISTS "consent_source";
--> statement-breakpoint

-- ── notification_type : restaure les 4 valeurs (retrait POSITION_NEAR/NEXT) ───
ALTER TYPE "notification_type" RENAME TO "notification_type_old";
--> statement-breakpoint

CREATE TYPE "notification_type" AS ENUM (
  'TICKET_CONFIRMATION',
  'POSITION_UPDATE',
  'YOUR_TURN',
  'DAILY_REPORT'
);
--> statement-breakpoint

ALTER TABLE "notification_templates"
  ALTER COLUMN "type" TYPE "notification_type"
  USING "type"::text::"notification_type";
--> statement-breakpoint

ALTER TABLE "notification_log"
  ALTER COLUMN "type" TYPE "notification_type"
  USING "type"::text::"notification_type";
--> statement-breakpoint

DROP TYPE "notification_type_old";
