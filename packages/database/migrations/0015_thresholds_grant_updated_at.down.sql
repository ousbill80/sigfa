-- DB-THRESHOLDS-GRANT-UPDATEDAT : rollback de 0015_thresholds_grant_updated_at.sql.
-- Révoque `updated_at` du GRANT UPDATE colonne-scopé, restaurant l'état 0014
-- (seuls les 3 seuils opérationnels restent mutables par sigfa_app).
--> statement-breakpoint

REVOKE UPDATE (updated_at)
  ON banks FROM sigfa_app;
