-- DB-002 : Provisioning des rôles PostgreSQL (double rôle)
-- DB-009 : Mots de passe paramétrés — aucun mot de passe en dur.
-- Appliqué en migration sur toute base fraîche.
--
-- Rôle migrateur : sigfa_migrator (owner, BYPASSRLS)
--   Utilisé par drizzle-kit et les migrations. Contourne FORCE RLS.
--
-- Rôle applicatif : sigfa_app (non-owner, sans BYPASSRLS)
--   Utilisé par le runtime API. Soumis à toutes les policies RLS.
--   Ne peut PAS contourner FORCE RLS silencieusement.
--
-- ⚠ MOTS DE PASSE : lus depuis current_setting() ou défauts DEV.
--   Défauts DEV (voir .env.example) :
--     SIGFA_MIGRATOR_PASSWORD=sigfa_migrator_dev
--     SIGFA_APP_PASSWORD=sigfa_app_dev
--   Rotation prod : SET app.sigfa_migrator_password = '...' avant d'appliquer.

-- Rôle migrateur (BYPASSRLS, peut posséder les tables)
DO $$
DECLARE
  v_password text;
BEGIN
  v_password := coalesce(
    nullif(current_setting('app.sigfa_migrator_password', true), ''),
    'sigfa_migrator_dev'
  );
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sigfa_migrator') THEN
    EXECUTE format('CREATE ROLE sigfa_migrator WITH LOGIN PASSWORD %L BYPASSRLS', v_password);
  END IF;
END
$$;

-- Rôle applicatif (sans BYPASSRLS, CRUD uniquement)
DO $$
DECLARE
  v_password text;
BEGIN
  v_password := coalesce(
    nullif(current_setting('app.sigfa_app_password', true), ''),
    'sigfa_app_dev'
  );
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sigfa_app') THEN
    EXECUTE format(
      'CREATE ROLE sigfa_app WITH LOGIN PASSWORD %L NOCREATEDB NOCREATEROLE NOBYPASSRLS',
      v_password
    );
  END IF;
END
$$;

-- GRANT CRUD sur toutes les tables métier au rôle applicatif
-- (appliqué après création des tables par 0000_dry_nuke.sql)
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO sigfa_app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO sigfa_app;
