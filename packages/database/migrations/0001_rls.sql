-- DB-002 : Migration RLS — double rôle + policies tenant_isolation
-- Appliqué sur la base après 0000_dry_nuke.sql (schéma DB-001).
--> statement-breakpoint

-- ── Rôle migrateur (BYPASSRLS) ───────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sigfa_migrator') THEN
    CREATE ROLE sigfa_migrator WITH LOGIN PASSWORD 'sigfa_migrator_secret' BYPASSRLS;
  END IF;
END
$$;
--> statement-breakpoint

-- ── Rôle applicatif (sans BYPASSRLS) ─────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sigfa_app') THEN
    CREATE ROLE sigfa_app WITH LOGIN PASSWORD 'sigfa_app_secret' NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
$$;
--> statement-breakpoint

-- ── GRANT CRUD au rôle applicatif ────────────────────────────────────────────
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
