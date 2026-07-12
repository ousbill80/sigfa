-- DB-010 : tickets.required_language — préférence de langue pour le routage API-004
-- Appliqué après 0007_ai_tables.sql.
--
-- Contenu :
--   1. Colonne `required_language` agent_language NULLABLE sur la table `tickets`
--      Nullable : la préférence de langue est optionnelle (NULL = aucune contrainte).
--      Valeurs : FR | DIOULA | BAOULE | EN (LA LOI `AgentLanguage`, enum existant DB-001).
--      Défaut implicite : NULL (aucun DEFAULT défini — valeur absente = aucune contrainte).
--
-- Décision (DB-010) :
--   - Réutilise l'enum `agent_language` déjà créé dans 0000_dry_nuke.sql.
--   - Nullable pour ne pas casser les lignes existantes ni les tests en place.
--   - Aucun GRANT supplémentaire : la table `tickets` est déjà couverte par les GRANTs
--     de la migration 0001_rls.sql.
--
-- Migration down : 0008_required_language.down.sql
--> statement-breakpoint

ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "required_language" "agent_language";
--> statement-breakpoint

COMMENT ON COLUMN "tickets"."required_language" IS
  'Langue préférée du porteur pour le routage par API-004. '
  'Nullable — optionnelle (NULL = aucune contrainte de langue). '
  'Valeurs : FR | DIOULA | BAOULE | EN (enum agent_language, LA LOI AgentLanguage).';
