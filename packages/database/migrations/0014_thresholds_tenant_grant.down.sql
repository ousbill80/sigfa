-- DB-THRESHOLDS-TENANT-GRANT : rollback de 0014_thresholds_tenant_grant.sql
-- Retire la policy UPDATE tenant-scopée puis révoque le GRANT UPDATE colonne-scopé,
-- restaurant l'état 0001_rls.sql (banks = SELECT only pour sigfa_app).
--> statement-breakpoint

DROP POLICY IF EXISTS tenant_update ON banks;
--> statement-breakpoint
REVOKE UPDATE (queue_critical_threshold, agent_inactivity_minutes, no_show_timeout_minutes)
  ON banks FROM sigfa_app;
