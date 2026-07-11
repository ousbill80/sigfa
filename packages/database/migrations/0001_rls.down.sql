-- DB-009 : rollback (down) de 0001_rls.sql
-- Idempotent — s'exécute sans erreur sur une base avec ou sans données.
-- Supprime les policies RLS et désactive RLS sur toutes les tables métier,
-- puis révoque les droits et supprime les rôles applicatifs.
--> statement-breakpoint

-- ── Suppression policies RLS sur banks (DB-009) ──────────────────────────────
DROP POLICY IF EXISTS tenant_isolation ON banks;
--> statement-breakpoint
ALTER TABLE banks DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- ── Suppression policies RLS sur les tables métier ───────────────────────────
DROP POLICY IF EXISTS tenant_isolation ON users;
--> statement-breakpoint
ALTER TABLE users DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint

DROP POLICY IF EXISTS tenant_isolation ON tickets;
--> statement-breakpoint
ALTER TABLE tickets DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint

DROP POLICY IF EXISTS tenant_isolation ON ticket_transfers;
--> statement-breakpoint
ALTER TABLE ticket_transfers DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint

DROP POLICY IF EXISTS tenant_isolation ON user_services;
--> statement-breakpoint
ALTER TABLE user_services DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint

DROP POLICY IF EXISTS tenant_isolation ON agent_status_history;
--> statement-breakpoint
ALTER TABLE agent_status_history DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint

DROP POLICY IF EXISTS tenant_isolation ON agency_users;
--> statement-breakpoint
ALTER TABLE agency_users DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint

DROP POLICY IF EXISTS tenant_isolation ON kiosks;
--> statement-breakpoint
ALTER TABLE kiosks DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint

DROP POLICY IF EXISTS tenant_isolation ON counters;
--> statement-breakpoint
ALTER TABLE counters DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint

DROP POLICY IF EXISTS tenant_isolation ON counter_services;
--> statement-breakpoint
ALTER TABLE counter_services DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint

DROP POLICY IF EXISTS tenant_isolation ON queues;
--> statement-breakpoint
ALTER TABLE queues DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint

DROP POLICY IF EXISTS tenant_isolation ON services;
--> statement-breakpoint
ALTER TABLE services DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint

DROP POLICY IF EXISTS tenant_isolation ON agency_exceptional_closures;
--> statement-breakpoint
ALTER TABLE agency_exceptional_closures DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint

DROP POLICY IF EXISTS tenant_isolation ON agencies;
--> statement-breakpoint
ALTER TABLE agencies DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- ── Révocation des droits et suppression des rôles ────────────────────────────
-- Révocation des droits sur sigfa_app avant DROP ROLE
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM sigfa_app;
--> statement-breakpoint
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM sigfa_app;
--> statement-breakpoint

DROP ROLE IF EXISTS sigfa_app;
--> statement-breakpoint
DROP ROLE IF EXISTS sigfa_migrator;
