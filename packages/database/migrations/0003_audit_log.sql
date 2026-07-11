-- DB-004 : audit_log immuable + triggers d'écriture
-- Appliqué après 0002_public_holidays.sql.
--
-- Contenu :
--   1. Table audit_log (append-only) + index (bank_id, occurred_at) et (bank_id, entity_type, entity_id)
--   2. GRANT SELECT, INSERT à sigfa_app ; REVOKE UPDATE, DELETE (immuabilité côté privilèges)
--   3. RLS ENABLE + FORCE + policy tenant_isolation (lecture scopée banque — écran Auditor)
--   4. Triggers BEFORE UPDATE/DELETE → RAISE EXCEPTION (immuabilité côté données, même owner)
--   5. Fonction générique d'audit sur les tables sensibles (diff old/new,
--      exclusion des colonnes *_hash/*_encrypted/*_cipher par motif de nom) + triggers
--
-- Décision consignée : tickets est INTENTIONNELLEMENT exclue des triggers (fréquence
-- d'UPDATE incompatible avec un trigger synchrone) ; ses mutations sont journalisées
-- applicativement par SEC-001 via insertAuditEntry(). L'immuabilité (triggers) est distincte
-- de la rétention 24 mois (job d'exploitation, voir src/rls/audit-retention.md).
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "audit_log" (
  "id"          uuid          PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "bank_id"     uuid          NOT NULL REFERENCES "banks"("id") ON DELETE RESTRICT,
  "actor_id"    uuid,
  "actor_role"  "role",
  "actor_email" text,
  "action"      varchar(500)  NOT NULL,
  "entity_type" text          NOT NULL,
  "entity_id"   uuid,
  "occurred_at" timestamp with time zone NOT NULL DEFAULT now(),
  "ip"          inet,
  "diff"        jsonb
);
--> statement-breakpoint

COMMENT ON TABLE "audit_log" IS
  'Journal d''audit IMMUABLE (append-only). UPDATE/DELETE impossibles (triggers + REVOKE). '
  'Mapping DB->API : occurred_at->timestamp, actor_* composés en objet actor, entity_* en objet entity.';
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "audit_log_bank_id_occurred_at_idx"
  ON "audit_log" ("bank_id", "occurred_at");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "audit_log_bank_id_entity_idx"
  ON "audit_log" ("bank_id", "entity_type", "entity_id");
--> statement-breakpoint

-- ── Privilèges : append-only pour sigfa_app ──────────────────────────────────
-- Le GRANT ALL de 0001_rls.sql inclut UPDATE/DELETE : on les REVOKE ici.
GRANT SELECT, INSERT ON "audit_log" TO sigfa_app;
--> statement-breakpoint
REVOKE UPDATE, DELETE ON "audit_log" FROM sigfa_app;
--> statement-breakpoint

-- ── RLS : lecture/écriture scopées banque (écran Auditor) ────────────────────
ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "audit_log" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "audit_log";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "audit_log"
  USING (bank_id = nullif(current_setting('app.current_bank_id', true), '')::uuid)
  WITH CHECK (bank_id = nullif(current_setting('app.current_bank_id', true), '')::uuid);
--> statement-breakpoint

-- ── Immuabilité côté données : rejet de tout UPDATE/DELETE (même owner) ───────
CREATE OR REPLACE FUNCTION audit_log_reject_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is immutable: % is forbidden', TG_OP
    USING ERRCODE = 'raise_exception';
END;
$$;
--> statement-breakpoint

DROP TRIGGER IF EXISTS audit_log_no_update ON "audit_log";
--> statement-breakpoint
CREATE TRIGGER audit_log_no_update
  BEFORE UPDATE ON "audit_log"
  FOR EACH ROW EXECUTE FUNCTION audit_log_reject_mutation();
--> statement-breakpoint

DROP TRIGGER IF EXISTS audit_log_no_delete ON "audit_log";
--> statement-breakpoint
CREATE TRIGGER audit_log_no_delete
  BEFORE DELETE ON "audit_log"
  FOR EACH ROW EXECUTE FUNCTION audit_log_reject_mutation();
--> statement-breakpoint

-- ── Fonction générique d'audit des tables sensibles ──────────────────────────
-- SECURITY DEFINER : s'exécute avec les droits du propriétaire de la fonction
-- (rôle migrateur/owner, BYPASSRLS) afin de pouvoir INSÉRER dans audit_log même
-- lorsque la mutation est déclenchée par sigfa_app (qui n'a que SELECT/INSERT et est
-- soumis à RLS). L'exclusion des colonnes sensibles se fait PAR MOTIF DE NOM
-- (suffixes _hash / _encrypted / _cipher), robuste aux colonnes futures.
CREATE OR REPLACE FUNCTION audit_row_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bank_id   uuid;
  v_entity_id uuid;
  v_old       jsonb;
  v_new       jsonb;
  v_diff      jsonb;
  v_col       text;
BEGIN
  -- Sérialiser OLD/NEW en jsonb selon l'opération
  IF (TG_OP = 'DELETE') THEN
    v_old := to_jsonb(OLD);
    v_new := NULL;
  ELSIF (TG_OP = 'INSERT') THEN
    v_old := NULL;
    v_new := to_jsonb(NEW);
  ELSE
    v_old := to_jsonb(OLD);
    v_new := to_jsonb(NEW);
  END IF;

  -- Retirer les colonnes sensibles PAR MOTIF DE NOM (robuste aux colonnes futures)
  FOR v_col IN
    SELECT key FROM jsonb_object_keys(COALESCE(v_new, v_old)) AS key
  LOOP
    IF v_col LIKE '%\_hash' ESCAPE '\'
       OR v_col LIKE '%\_encrypted' ESCAPE '\'
       OR v_col LIKE '%\_cipher' ESCAPE '\' THEN
      v_old := v_old - v_col;
      v_new := v_new - v_col;
    END IF;
  END LOOP;

  -- Résoudre bank_id : la table racine `banks` n'a pas de colonne bank_id — son `id`
  -- EST le tenant. Sinon on lit bank_id, avec repli sur id (défensif).
  IF (TG_TABLE_NAME = 'banks') THEN
    v_bank_id := (COALESCE(v_new, v_old) ->> 'id')::uuid;
  ELSE
    v_bank_id := (COALESCE(v_new, v_old) ->> 'bank_id')::uuid;
  END IF;
  v_entity_id := (COALESCE(v_new, v_old) ->> 'id')::uuid;

  -- Ligne sans tenant résoluble (ex. SUPER_ADMIN plateforme, bank_id NULL) :
  -- non journalisée dans le log per-banque (audit_log.bank_id NOT NULL, FK banks).
  IF (v_bank_id IS NULL) THEN
    IF (TG_OP = 'DELETE') THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  -- Construire le diff : {old, new} (les clés NULL sont omises)
  v_diff := jsonb_strip_nulls(jsonb_build_object('old', v_old, 'new', v_new));

  INSERT INTO audit_log (bank_id, action, entity_type, entity_id, diff)
  VALUES (
    v_bank_id,
    TG_OP || ' ' || TG_TABLE_NAME,
    TG_TABLE_NAME,
    v_entity_id,
    v_diff
  );

  IF (TG_OP = 'DELETE') THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

-- ── Attacher le trigger d'audit aux tables sensibles (liste versionnée) ───────
-- banks, agencies, services, counters, users, kiosks — PAS tickets (décision verrouillée).
DROP TRIGGER IF EXISTS audit_change ON "banks";
--> statement-breakpoint
CREATE TRIGGER audit_change
  AFTER INSERT OR UPDATE OR DELETE ON "banks"
  FOR EACH ROW EXECUTE FUNCTION audit_row_change();
--> statement-breakpoint

DROP TRIGGER IF EXISTS audit_change ON "agencies";
--> statement-breakpoint
CREATE TRIGGER audit_change
  AFTER INSERT OR UPDATE OR DELETE ON "agencies"
  FOR EACH ROW EXECUTE FUNCTION audit_row_change();
--> statement-breakpoint

DROP TRIGGER IF EXISTS audit_change ON "services";
--> statement-breakpoint
CREATE TRIGGER audit_change
  AFTER INSERT OR UPDATE OR DELETE ON "services"
  FOR EACH ROW EXECUTE FUNCTION audit_row_change();
--> statement-breakpoint

DROP TRIGGER IF EXISTS audit_change ON "counters";
--> statement-breakpoint
CREATE TRIGGER audit_change
  AFTER INSERT OR UPDATE OR DELETE ON "counters"
  FOR EACH ROW EXECUTE FUNCTION audit_row_change();
--> statement-breakpoint

DROP TRIGGER IF EXISTS audit_change ON "users";
--> statement-breakpoint
CREATE TRIGGER audit_change
  AFTER INSERT OR UPDATE OR DELETE ON "users"
  FOR EACH ROW EXECUTE FUNCTION audit_row_change();
--> statement-breakpoint

DROP TRIGGER IF EXISTS audit_change ON "kiosks";
--> statement-breakpoint
CREATE TRIGGER audit_change
  AFTER INSERT OR UPDATE OR DELETE ON "kiosks"
  FOR EACH ROW EXECUTE FUNCTION audit_row_change();
