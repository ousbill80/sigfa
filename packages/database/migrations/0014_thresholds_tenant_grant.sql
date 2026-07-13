-- DB-THRESHOLDS-TENANT-GRANT : couture SEC-002.
-- La route PATCH /banks/:id/thresholds (apps/api) fait un UPDATE des 3 seuils
-- opérationnels sur `banks`. Sous connexion RLS armée (rôle sigfa_app, NOBYPASSRLS),
-- l'UPDATE échouait avec `permission denied for table banks` : 0001_rls.sql révoque
-- INSERT/UPDATE/DELETE sur banks pour sigfa_app (mutations réservées au rôle plateforme).
--
-- Cette migration accorde le MINIMUM nécessaire, tenant-scopé :
--   1. GRANT UPDATE colonne-scopé aux 3 seuils UNIQUEMENT (jamais un UPDATE pleine table :
--      le GRANT colonne verrouille le reste — name, slug, theme, is_active… restent refusés).
--   2. Policy RLS UPDATE tenant-scopée : un tenant ne peut modifier QUE sa propre ligne
--      (id = app.current_bank_id), USING + WITH CHECK. La policy SELECT tenant_isolation
--      existante et les révocations INSERT/DELETE restent inchangées.
--
-- Le paramètre `app.current_bank_id` est le mécanisme déjà utilisé par withTenant /
-- withArmedTenant (SET LOCAL) et les policies tenant existantes — aligné, non réinventé.
--> statement-breakpoint

-- ── GRANT UPDATE colonne-scopé sur les 3 seuils (jamais pleine table) ─────────
GRANT UPDATE (queue_critical_threshold, agent_inactivity_minutes, no_show_timeout_minutes)
  ON banks TO sigfa_app;
--> statement-breakpoint

-- ── Policy RLS UPDATE tenant-scopée sur banks ────────────────────────────────
-- Un tenant ne peut mettre à jour QUE sa propre ligne (id = app.current_bank_id).
-- Combinée au GRANT colonne ci-dessus, seuls les 3 seuils de SA banque sont mutables.
DROP POLICY IF EXISTS tenant_update ON banks;
--> statement-breakpoint
CREATE POLICY tenant_update ON banks
  FOR UPDATE
  USING (id = nullif(current_setting('app.current_bank_id', true), '')::uuid)
  WITH CHECK (id = nullif(current_setting('app.current_bank_id', true), '')::uuid);
