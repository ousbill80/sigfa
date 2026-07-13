-- DB-AI-FEATURES : rollback de la migration 0013_ai_features.sql
-- Supprime la table ai_features (les index, policy RLS et GRANT tombent par CASCADE).
--> statement-breakpoint

DROP TABLE IF EXISTS "ai_features";
