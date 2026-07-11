-- DB-002 : Provisioning des rôles PostgreSQL (double rôle)
-- Appliqué en migration sur toute base fraîche.
--
-- Rôle migrateur : sigfa_migrator (owner, BYPASSRLS)
--   Utilisé par drizzle-kit et les migrations. Contourne FORCE RLS.
--
-- Rôle applicatif : sigfa_app (non-owner, sans BYPASSRLS)
--   Utilisé par le runtime API. Soumis à toutes les policies RLS.
--   Ne peut PAS contourner FORCE RLS silencieusement.

-- Rôle migrateur (BYPASSRLS, peut posséder les tables)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sigfa_migrator') THEN
    CREATE ROLE sigfa_migrator WITH LOGIN PASSWORD 'sigfa_migrator_secret' BYPASSRLS;
  END IF;
END
$$;

-- Rôle applicatif (sans BYPASSRLS, CRUD uniquement)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sigfa_app') THEN
    CREATE ROLE sigfa_app WITH LOGIN PASSWORD 'sigfa_app_secret' NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
$$;

-- GRANT CRUD sur toutes les tables métier au rôle applicatif
-- (appliqué après création des tables par 0000_dry_nuke.sql)
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO sigfa_app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO sigfa_app;
