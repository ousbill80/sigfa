-- DB-003 : Migration public_holidays — référentiel national jours fériés ivoiriens
-- Table hors-tenant (pas de bank_id) : référentiel national, géré par la plateforme.
--
-- Règles d'accès :
--   - GRANT SELECT uniquement au rôle applicatif sigfa_app
--   - REVOKE INSERT, UPDATE, DELETE sur sigfa_app
--   - Exception RLS documentée : pas de policy RLS sur cette table (référentiel national)
--
-- ⚠ Mise à jour annuelle :
--   Les fêtes mobiles (fêtes islamiques) doivent être mises à jour manuellement chaque année.
--   Si l'année courante dépasse max(year) des fériés mobiles, un avertissement est loggé
--   au démarrage du seed (voir src/seed/index.ts). Story d'exploitation : créer un ticket
--   annuel "Mettre à jour les fériés islamiques" avant le 1er janvier de l'année concernée.
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "public_holidays" (
  "id"             uuid        PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "date"           date        NOT NULL,
  "name"           text        NOT NULL,
  "description"    text,
  "is_approximate" boolean     NOT NULL DEFAULT false,
  "created_at"     timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "public_holidays_date_name_key" UNIQUE ("date", "name")
);
--> statement-breakpoint

COMMENT ON TABLE "public_holidays" IS
  'Référentiel national des jours fériés ivoiriens. '
  'Hors tenant (pas de bank_id). '
  'is_approximate = true pour les fêtes islamiques dont la date exacte dépend du croissant de lune. '
  'Mise à jour manuelle annuelle requise pour les fêtes mobiles.';
--> statement-breakpoint

-- ── Accès GRANT SELECT only pour sigfa_app ───────────────────────────────────
-- Le rôle applicatif peut LIRE les fériés mais jamais les modifier.
-- Les migrations (sigfa_migrator) conservent le plein accès.
GRANT SELECT ON public_holidays TO sigfa_app;
--> statement-breakpoint

-- REVOKE explicite des droits d'écriture sur sigfa_app
-- (le GRANT ALL précédent dans 0001_rls.sql doit être restreint pour cette table)
REVOKE INSERT, UPDATE, DELETE ON public_holidays FROM sigfa_app;
