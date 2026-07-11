-- DB-002 : Migration RLS — double rôle + policies tenant_isolation
-- DB-009 : Mots de passe paramétrés + RLS banks + REVOKE mutations banks
-- Appliqué sur la base après 0000_dry_nuke.sql (schéma DB-001).
--
-- ⚠ MOTS DE PASSE : aucun mot de passe en dur dans ce fichier.
-- Défauts DEV : SIGFA_MIGRATOR_PASSWORD=sigfa_migrator_dev (voir .env.example)
--               SIGFA_APP_PASSWORD=sigfa_app_dev     (voir .env.example)
-- Rotation prod : utiliser les variables d'env SIGFA_MIGRATOR_PASSWORD et SIGFA_APP_PASSWORD.
-- Le harness Testcontainers injecte ses propres mots de passe via les connexions pg.
--> statement-breakpoint

-- ── Rôle migrateur (BYPASSRLS) ───────────────────────────────────────────────
-- Mot de passe lu depuis current_setting('app.sigfa_migrator_password', true)
-- ou la variable d'env SIGFA_MIGRATOR_PASSWORD si disponible.
-- En Testcontainers le rôle est créé directement par le harness (pas cette migration).
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
--> statement-breakpoint

-- ── Rôle applicatif (sans BYPASSRLS) ─────────────────────────────────────────
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
--> statement-breakpoint

-- ── GRANT CRUD au rôle applicatif (tables métier sauf banks) ─────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO sigfa_app;
--> statement-breakpoint
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO sigfa_app;
--> statement-breakpoint

-- ── RLS agencies ─────────────────────────────────────────────────────────────
ALTER TABLE agencies ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE agencies FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON agencies;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON agencies
  USING (bank_id = nullif(current_setting('app.current_bank_id', true), '')::uuid)
  WITH CHECK (bank_id = nullif(current_setting('app.current_bank_id', true), '')::uuid);
--> statement-breakpoint

-- ── RLS agency_exceptional_closures ──────────────────────────────────────────
ALTER TABLE agency_exceptional_closures ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE agency_exceptional_closures FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON agency_exceptional_closures;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON agency_exceptional_closures
  USING (bank_id = nullif(current_setting('app.current_bank_id', true), '')::uuid)
  WITH CHECK (bank_id = nullif(current_setting('app.current_bank_id', true), '')::uuid);
--> statement-breakpoint

-- ── RLS services ─────────────────────────────────────────────────────────────
ALTER TABLE services ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE services FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON services;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON services
  USING (bank_id = nullif(current_setting('app.current_bank_id', true), '')::uuid)
  WITH CHECK (bank_id = nullif(current_setting('app.current_bank_id', true), '')::uuid);
--> statement-breakpoint

-- ── RLS queues ───────────────────────────────────────────────────────────────
ALTER TABLE queues ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE queues FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON queues;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON queues
  USING (bank_id = nullif(current_setting('app.current_bank_id', true), '')::uuid)
  WITH CHECK (bank_id = nullif(current_setting('app.current_bank_id', true), '')::uuid);
--> statement-breakpoint

-- ── RLS counter_services ─────────────────────────────────────────────────────
ALTER TABLE counter_services ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE counter_services FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON counter_services;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON counter_services
  USING (bank_id = nullif(current_setting('app.current_bank_id', true), '')::uuid)
  WITH CHECK (bank_id = nullif(current_setting('app.current_bank_id', true), '')::uuid);
--> statement-breakpoint

-- ── RLS counters ─────────────────────────────────────────────────────────────
ALTER TABLE counters ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE counters FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON counters;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON counters
  USING (bank_id = nullif(current_setting('app.current_bank_id', true), '')::uuid)
  WITH CHECK (bank_id = nullif(current_setting('app.current_bank_id', true), '')::uuid);
--> statement-breakpoint

-- ── RLS kiosks ───────────────────────────────────────────────────────────────
ALTER TABLE kiosks ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE kiosks FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON kiosks;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON kiosks
  USING (bank_id = nullif(current_setting('app.current_bank_id', true), '')::uuid)
  WITH CHECK (bank_id = nullif(current_setting('app.current_bank_id', true), '')::uuid);
--> statement-breakpoint

-- ── RLS agency_users ─────────────────────────────────────────────────────────
ALTER TABLE agency_users ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE agency_users FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON agency_users;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON agency_users
  USING (bank_id = nullif(current_setting('app.current_bank_id', true), '')::uuid)
  WITH CHECK (bank_id = nullif(current_setting('app.current_bank_id', true), '')::uuid);
--> statement-breakpoint

-- ── RLS agent_status_history ─────────────────────────────────────────────────
ALTER TABLE agent_status_history ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE agent_status_history FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON agent_status_history;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON agent_status_history
  USING (bank_id = nullif(current_setting('app.current_bank_id', true), '')::uuid)
  WITH CHECK (bank_id = nullif(current_setting('app.current_bank_id', true), '')::uuid);
--> statement-breakpoint

-- ── RLS user_services ────────────────────────────────────────────────────────
ALTER TABLE user_services ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE user_services FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON user_services;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON user_services
  USING (bank_id = nullif(current_setting('app.current_bank_id', true), '')::uuid)
  WITH CHECK (bank_id = nullif(current_setting('app.current_bank_id', true), '')::uuid);
--> statement-breakpoint

-- ── RLS ticket_transfers ──────────────────────────────────────────────────────
ALTER TABLE ticket_transfers ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE ticket_transfers FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON ticket_transfers;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON ticket_transfers
  USING (bank_id = nullif(current_setting('app.current_bank_id', true), '')::uuid)
  WITH CHECK (bank_id = nullif(current_setting('app.current_bank_id', true), '')::uuid);
--> statement-breakpoint

-- ── RLS tickets ──────────────────────────────────────────────────────────────
ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE tickets FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON tickets;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON tickets
  USING (bank_id = nullif(current_setting('app.current_bank_id', true), '')::uuid)
  WITH CHECK (bank_id = nullif(current_setting('app.current_bank_id', true), '')::uuid);
--> statement-breakpoint

-- ── RLS users (exception SUPER_ADMIN documentée) ─────────────────────────────
-- Les lignes SUPER_ADMIN (bank_id IS NULL) sont invisibles par tout contexte tenant.
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE users FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON users;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON users
  USING (
    bank_id IS NOT NULL
    AND bank_id = nullif(current_setting('app.current_bank_id', true), '')::uuid
  )
  WITH CHECK (
    bank_id IS NOT NULL
    AND bank_id = nullif(current_setting('app.current_bank_id', true), '')::uuid
  );
--> statement-breakpoint

-- ── RLS banks (DB-009 MAJOR) ─────────────────────────────────────────────────
-- `banks` est la table racine du tenant (elle EST la banque).
-- sigfa_app peut LIRE sa propre banque (contexte app.current_bank_id requis).
-- Les mutations (INSERT/UPDATE/DELETE) sont réservées au rôle plateforme (sigfa_migrator).
-- Sans contexte → zéro ligne visible (FORCE RLS).
ALTER TABLE banks ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE banks FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON banks;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON banks
  FOR SELECT
  USING (id = nullif(current_setting('app.current_bank_id', true), '')::uuid);
--> statement-breakpoint
-- REVOKE mutations banks sur sigfa_app (SELECT only — mutations via rôle plateforme)
REVOKE INSERT, UPDATE, DELETE ON banks FROM sigfa_app;
