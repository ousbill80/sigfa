-- DB-THRESHOLDS-GRANT-UPDATEDAT : couture finale d'armement RLS de thresholds.ts.
-- La route PATCH /banks/:id/thresholds (apps/api) fait
--   UPDATE banks SET <3 seuils>, updated_at = NOW() WHERE id = ...
-- 0014_thresholds_tenant_grant.sql accorde à sigfa_app le GRANT UPDATE colonne-scopé
-- sur les 3 seuils UNIQUEMENT + la policy RLS tenant_update. MAIS `updated_at`
-- n'est PAS dans le GRANT colonne : sous connexion armée sigfa_app (NOBYPASSRLS),
-- l'UPDATE incluant `updated_at = NOW()` échoue en `permission denied for table banks`.
--
-- Cette migration élargit le GRANT colonne d'UNE seule colonne (`updated_at`),
-- pour couvrir l'horodatage automatique du PATCH. Elle NE touche NI la policy
-- tenant_update (déjà correcte, WITH CHECK id = current_bank_id), NI la policy
-- SELECT tenant_isolation, NI les révocations INSERT/DELETE. Aucune autre colonne
-- (name, slug, theme, is_active…) n'est accordée : elles restent hors GRANT.
--> statement-breakpoint

-- ── Élargissement du GRANT UPDATE colonne-scopé : ajout de `updated_at` ────────
GRANT UPDATE (queue_critical_threshold, agent_inactivity_minutes, no_show_timeout_minutes, updated_at)
  ON banks TO sigfa_app;
