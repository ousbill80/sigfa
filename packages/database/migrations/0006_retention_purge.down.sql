-- DB-008 : rollback de la migration 0006_retention_purge.sql
-- Supprime la table retention_policies (et sa policy/index par cascade DROP TABLE).
--> statement-breakpoint

DROP TABLE IF EXISTS "retention_policies";
