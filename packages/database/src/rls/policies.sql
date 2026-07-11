-- DB-002 : Policies RLS pour toutes les tables métier portant bank_id
-- Chaque table reçoit :
--   ENABLE ROW LEVEL SECURITY
--   FORCE ROW LEVEL SECURITY (les owners ne contournent pas silencieusement)
--   POLICY tenant_isolation : USING + WITH CHECK sur bank_id = app.current_bank_id
--
-- Exception documentée : table `users`
--   Les lignes SUPER_ADMIN (bank_id IS NULL) ne sont visibles par AUCUN contexte tenant.
--   La policy s'applique uniquement aux lignes où bank_id IS NOT NULL
--   ET bank_id = current_setting('app.current_bank_id', true)::uuid.

-- ── agencies ────────────────────────────────────────────────────────────────
ALTER TABLE agencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE agencies FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON agencies;
CREATE POLICY tenant_isolation ON agencies
  USING (bank_id = nullif(current_setting('app.current_bank_id', true), '')::uuid)
  WITH CHECK (bank_id = nullif(current_setting('app.current_bank_id', true), '')::uuid);

-- ── agency_exceptional_closures ──────────────────────────────────────────────
ALTER TABLE agency_exceptional_closures ENABLE ROW LEVEL SECURITY;
ALTER TABLE agency_exceptional_closures FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON agency_exceptional_closures;
CREATE POLICY tenant_isolation ON agency_exceptional_closures
  USING (bank_id = nullif(current_setting('app.current_bank_id', true), '')::uuid)
  WITH CHECK (bank_id = nullif(current_setting('app.current_bank_id', true), '')::uuid);

-- ── services ─────────────────────────────────────────────────────────────────
ALTER TABLE services ENABLE ROW LEVEL SECURITY;
ALTER TABLE services FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON services;
CREATE POLICY tenant_isolation ON services
  USING (bank_id = nullif(current_setting('app.current_bank_id', true), '')::uuid)
  WITH CHECK (bank_id = nullif(current_setting('app.current_bank_id', true), '')::uuid);

-- ── queues ───────────────────────────────────────────────────────────────────
ALTER TABLE queues ENABLE ROW LEVEL SECURITY;
ALTER TABLE queues FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON queues;
CREATE POLICY tenant_isolation ON queues
  USING (bank_id = nullif(current_setting('app.current_bank_id', true), '')::uuid)
  WITH CHECK (bank_id = nullif(current_setting('app.current_bank_id', true), '')::uuid);

-- ── counter_services ─────────────────────────────────────────────────────────
ALTER TABLE counter_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE counter_services FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON counter_services;
CREATE POLICY tenant_isolation ON counter_services
  USING (bank_id = nullif(current_setting('app.current_bank_id', true), '')::uuid)
  WITH CHECK (bank_id = nullif(current_setting('app.current_bank_id', true), '')::uuid);

-- ── counters ─────────────────────────────────────────────────────────────────
ALTER TABLE counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE counters FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON counters;
CREATE POLICY tenant_isolation ON counters
  USING (bank_id = nullif(current_setting('app.current_bank_id', true), '')::uuid)
  WITH CHECK (bank_id = nullif(current_setting('app.current_bank_id', true), '')::uuid);

-- ── kiosks ───────────────────────────────────────────────────────────────────
ALTER TABLE kiosks ENABLE ROW LEVEL SECURITY;
ALTER TABLE kiosks FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON kiosks;
CREATE POLICY tenant_isolation ON kiosks
  USING (bank_id = nullif(current_setting('app.current_bank_id', true), '')::uuid)
  WITH CHECK (bank_id = nullif(current_setting('app.current_bank_id', true), '')::uuid);

-- ── agency_users ─────────────────────────────────────────────────────────────
ALTER TABLE agency_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE agency_users FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON agency_users;
CREATE POLICY tenant_isolation ON agency_users
  USING (bank_id = nullif(current_setting('app.current_bank_id', true), '')::uuid)
  WITH CHECK (bank_id = nullif(current_setting('app.current_bank_id', true), '')::uuid);

-- ── agent_status_history ─────────────────────────────────────────────────────
ALTER TABLE agent_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_status_history FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON agent_status_history;
CREATE POLICY tenant_isolation ON agent_status_history
  USING (bank_id = nullif(current_setting('app.current_bank_id', true), '')::uuid)
  WITH CHECK (bank_id = nullif(current_setting('app.current_bank_id', true), '')::uuid);

-- ── user_services ────────────────────────────────────────────────────────────
ALTER TABLE user_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_services FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON user_services;
CREATE POLICY tenant_isolation ON user_services
  USING (bank_id = nullif(current_setting('app.current_bank_id', true), '')::uuid)
  WITH CHECK (bank_id = nullif(current_setting('app.current_bank_id', true), '')::uuid);

-- ── ticket_transfers ──────────────────────────────────────────────────────────
ALTER TABLE ticket_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_transfers FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON ticket_transfers;
CREATE POLICY tenant_isolation ON ticket_transfers
  USING (bank_id = nullif(current_setting('app.current_bank_id', true), '')::uuid)
  WITH CHECK (bank_id = nullif(current_setting('app.current_bank_id', true), '')::uuid);

-- ── tickets ──────────────────────────────────────────────────────────────────
ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE tickets FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON tickets;
CREATE POLICY tenant_isolation ON tickets
  USING (bank_id = nullif(current_setting('app.current_bank_id', true), '')::uuid)
  WITH CHECK (bank_id = nullif(current_setting('app.current_bank_id', true), '')::uuid);

-- ── users ────────────────────────────────────────────────────────────────────
-- Exception documentée : les lignes SUPER_ADMIN (bank_id IS NULL) sont
-- invisibles par TOUT contexte tenant (elles ne peuvent satisfaire bank_id = uuid).
-- La policy s'applique aux lignes avec bank_id NOT NULL uniquement.
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON users;
CREATE POLICY tenant_isolation ON users
  USING (
    bank_id IS NOT NULL
    AND bank_id = nullif(current_setting('app.current_bank_id', true), '')::uuid
  )
  WITH CHECK (
    bank_id IS NOT NULL
    AND bank_id = nullif(current_setting('app.current_bank_id', true), '')::uuid
  );
