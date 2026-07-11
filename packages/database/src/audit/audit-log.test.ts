/**
 * DB-004 — Suite de tests audit_log immuable + triggers
 *
 * TDD rouge→vert : ces tests échouent AVANT la migration 0003 et l'implémentation.
 * PostgreSQL réelle via Testcontainers (double rôle sigfa_app / sigfa_migrator) —
 * aucun mock (LA LOI T5).
 *
 * Les 7 critères d'acceptation de DB-004 sont mappés 1:1 aux `it("DB-004: ...")`.
 *
 * @module
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { startPostgresContainerWithRoles } from "@sigfa/testing/tenant-isolation";
import type { DualConnectionHarness } from "@sigfa/testing/tenant-isolation";
import { applyMigrations } from "src/test-support/migrate.js";
import { withTenant } from "src/tenant.js";
import { insertAuditEntry } from "src/audit/insert-audit-entry.js";
import { AUDITED_TABLES } from "src/audit/index.js";

describe("DB-004 — audit_log immuable + triggers", () => {
  let harness: DualConnectionHarness;

  const bankA = "aaaaaaaa-0000-4000-8000-00000000db04";
  const bankB = "bbbbbbbb-0000-4000-8000-00000000db04";
  const agencyA = "aa000000-0000-4000-8000-00000000db04";
  const actorId = "cc000000-0000-4000-8000-00000000db04";

  beforeAll(async () => {
    harness = await startPostgresContainerWithRoles();
    await applyMigrations(harness);

    // Fixtures via connexion migrateur (owner, BYPASSRLS)
    await harness.query(`INSERT INTO banks (id, name, slug) VALUES
      ('${bankA}', 'Banque A DB004', 'banque-a-db004'),
      ('${bankB}', 'Banque B DB004', 'banque-b-db004')
      ON CONFLICT (id) DO NOTHING`);

    await harness.query(`INSERT INTO agencies (id, bank_id, name) VALUES
      ('${agencyA}', '${bankA}', 'Agence A1 DB004')
      ON CONFLICT (id) DO NOTHING`);
  }, 180_000);

  afterAll(async () => {
    await harness?.stop();
  }, 30_000);

  // Nettoyer audit_log entre les tests (via migrateur : TRUNCATE contourne les triggers
  // BEFORE DELETE — c'est l'opération d'exploitation, pas une mutation applicative).
  beforeEach(async () => {
    await harness.query("TRUNCATE audit_log");
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Critère 1 : UPDATE/DELETE sur audit_log → exception (même rôle applicatif)
  // ───────────────────────────────────────────────────────────────────────────
  it(
    "DB-004: UPDATE/DELETE sur audit_log → exception, même en tant que rôle applicatif (tests)",
    async () => {
      // Insérer une entrée via le rôle applicatif dans le contexte tenant A
      const inserted = await withTenant(harness.appQuery.bind(harness), bankA, async (q) => {
        return insertAuditEntry(q, {
          bankId: bankA,
          action: "TEST immutability",
          entityType: "bank",
          entityId: bankA,
        });
      });
      expect(inserted.id).toBeDefined();

      // UPDATE via rôle applicatif → doit lever une exception (trigger BEFORE UPDATE)
      await expect(
        withTenant(harness.appQuery.bind(harness), bankA, async (q) => {
          return q(`UPDATE audit_log SET action = 'tampered' WHERE id = '${inserted.id}'`);
        })
      ).rejects.toThrow();

      // DELETE via rôle applicatif → doit lever une exception (trigger BEFORE DELETE)
      await expect(
        withTenant(harness.appQuery.bind(harness), bankA, async (q) => {
          return q(`DELETE FROM audit_log WHERE id = '${inserted.id}'`);
        })
      ).rejects.toThrow();

      // UPDATE/DELETE via rôle MIGRATEUR (owner/superuser) → aussi bloqué par les triggers
      await expect(
        harness.query(`UPDATE audit_log SET action = 'tampered' WHERE id = '${inserted.id}'`)
      ).rejects.toThrow();
      await expect(
        harness.query(`DELETE FROM audit_log WHERE id = '${inserted.id}'`)
      ).rejects.toThrow();

      // La ligne est toujours intacte
      const check = await harness.query(`SELECT action FROM audit_log WHERE id = '${inserted.id}'`);
      expect(check.rows).toHaveLength(1);
      expect(check.rows[0]!.action).toBe("TEST immutability");

      // De plus : sigfa_app ne doit PAS avoir les privilèges UPDATE/DELETE (REVOKE)
      const priv = await harness.query(`
        SELECT privilege_type FROM information_schema.role_table_grants
        WHERE grantee = 'sigfa_app' AND table_name = 'audit_log'
        ORDER BY privilege_type
      `);
      const privs = priv.rows.map((r) => r.privilege_type);
      expect(privs).toContain("SELECT");
      expect(privs).toContain("INSERT");
      expect(privs).not.toContain("UPDATE");
      expect(privs).not.toContain("DELETE");
    },
    60_000
  );

  // ───────────────────────────────────────────────────────────────────────────
  // Critère 2 : INSERT/UPDATE/DELETE sur table auditée → entrée audit_log avec diff
  // ───────────────────────────────────────────────────────────────────────────
  it(
    "DB-004: INSERT/UPDATE/DELETE sur une table auditée → entrée audit_log avec diff (tests par opération)",
    async () => {
      const serviceId = "5e000000-0000-4000-8000-00000000db04";

      // INSERT sur une table auditée (services) via migrateur (fixture)
      await harness.query(
        `INSERT INTO services (id, bank_id, agency_id, name, code)
         VALUES ('${serviceId}', '${bankA}', '${agencyA}', 'Service Audit', 'AUD')`
      );
      let entries = await harness.query(
        `SELECT action, entity_type, entity_id, diff FROM audit_log
         WHERE entity_type = 'services' AND entity_id = '${serviceId}'
         ORDER BY occurred_at`
      );
      expect(entries.rows.some((r) => String(r.action).startsWith("INSERT"))).toBe(true);
      const insertRow = entries.rows.find((r) => String(r.action).startsWith("INSERT"))!;
      expect(insertRow.entity_type).toBe("services");
      // diff INSERT contient les nouvelles valeurs
      expect(insertRow.diff).toBeTruthy();

      // UPDATE
      await harness.query(
        `UPDATE services SET name = 'Service Audit Modifié' WHERE id = '${serviceId}'`
      );
      entries = await harness.query(
        `SELECT action, diff FROM audit_log
         WHERE entity_type = 'services' AND entity_id = '${serviceId}'
           AND action LIKE 'UPDATE%'`
      );
      expect(entries.rows).toHaveLength(1);
      const updateDiff = entries.rows[0]!.diff as { old?: Record<string, unknown>; new?: Record<string, unknown> };
      expect(updateDiff.old?.name).toBe("Service Audit");
      expect(updateDiff.new?.name).toBe("Service Audit Modifié");

      // DELETE
      await harness.query(`DELETE FROM services WHERE id = '${serviceId}'`);
      entries = await harness.query(
        `SELECT action, diff FROM audit_log
         WHERE entity_type = 'services' AND entity_id = '${serviceId}'
           AND action LIKE 'DELETE%'`
      );
      expect(entries.rows).toHaveLength(1);
      const deleteDiff = entries.rows[0]!.diff as { old?: Record<string, unknown> };
      expect(deleteDiff.old?.name).toBe("Service Audit Modifié");
    },
    60_000
  );

  // ───────────────────────────────────────────────────────────────────────────
  // Critère 3 : exclusion par motif — *_hash/*_encrypted/*_cipher absents du diff
  // ───────────────────────────────────────────────────────────────────────────
  it(
    "DB-004: exclusion par motif — toute colonne *_hash/*_encrypted/*_cipher absente du diff, y compris colonne factice future (test)",
    async () => {
      const userId = "d5000000-0000-4000-8000-00000000db04";

      // users porte password_hash + phone_encrypted (colonnes sensibles réelles)
      await harness.query(
        `INSERT INTO users (id, bank_id, email, password_hash, first_name, last_name, role, phone_encrypted, phone_hash)
         VALUES ('${userId}', '${bankA}', 'audit-db004@x.io', 'bcrypt-secret', 'Aud', 'It', 'AGENT', 'v1:iv:tag:ct', 'phash')`
      );

      // Ajouter une colonne factire FUTURE se terminant par _cipher pour prouver la robustesse
      await harness.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS future_secret_cipher text`);
      await harness.query(
        `UPDATE users SET future_secret_cipher = 'ciphered-secret', first_name = 'Aud2' WHERE id = '${userId}'`
      );

      const entries = await harness.query(
        `SELECT action, diff FROM audit_log
         WHERE entity_type = 'users' AND entity_id = '${userId}'
         ORDER BY occurred_at`
      );
      expect(entries.rows.length).toBeGreaterThan(0);

      // Aucune entrée ne doit exposer une colonne sensible (motif de nom)
      const serialized = JSON.stringify(entries.rows.map((r) => r.diff));
      expect(serialized).not.toContain("password_hash");
      expect(serialized).not.toContain("phone_encrypted");
      expect(serialized).not.toContain("phone_hash");
      expect(serialized).not.toContain("future_secret_cipher");
      // Les valeurs sensibles elles-mêmes ne doivent pas fuiter
      expect(serialized).not.toContain("bcrypt-secret");
      expect(serialized).not.toContain("v1:iv:tag:ct");
      expect(serialized).not.toContain("ciphered-secret");
      // Mais une colonne non sensible modifiée doit apparaître
      expect(serialized).toContain("Aud2");

      // Nettoyage de la colonne factice pour ne pas polluer les autres tests
      await harness.query(`ALTER TABLE users DROP COLUMN IF EXISTS future_secret_cipher`);
    },
    60_000
  );

  // ───────────────────────────────────────────────────────────────────────────
  // Critère 4 : AUCUN trigger d'audit sur tickets (décision verrouillée)
  // ───────────────────────────────────────────────────────────────────────────
  it(
    "DB-004: AUCUN trigger d'audit sur tickets (test pg_trigger — décision verrouillée)",
    async () => {
      // Aucun trigger d'audit (préfixe audit_) sur la table tickets
      const ticketTriggers = await harness.query(`
        SELECT tg.tgname
        FROM pg_trigger tg
        JOIN pg_class c ON c.oid = tg.tgrelid
        WHERE c.relname = 'tickets'
          AND NOT tg.tgisinternal
          AND tg.tgname LIKE 'audit_%'
      `);
      expect(ticketTriggers.rows).toHaveLength(0);

      // Et chaque table AUDITÉE, elle, DOIT porter le trigger d'audit
      for (const table of AUDITED_TABLES) {
        const triggers = await harness.query(`
          SELECT tg.tgname
          FROM pg_trigger tg
          JOIN pg_class c ON c.oid = tg.tgrelid
          WHERE c.relname = '${table}'
            AND NOT tg.tgisinternal
            AND tg.tgname LIKE 'audit_%'
        `);
        expect(triggers.rows.length, `${table} doit porter un trigger d'audit`).toBeGreaterThan(0);
      }
    },
    60_000
  );

  // ───────────────────────────────────────────────────────────────────────────
  // Critère 5 : lecture cross-tenant impossible (suite tenant-isolation)
  // ───────────────────────────────────────────────────────────────────────────
  it(
    "DB-004: lecture cross-tenant impossible (cas ajoutés à la suite tenant-isolation)",
    async () => {
      // Insérer une entrée pour A et une pour B (via applicatif, chacun dans son contexte)
      await withTenant(harness.appQuery.bind(harness), bankA, async (q) =>
        insertAuditEntry(q, { bankId: bankA, action: "A-only", entityType: "bank", entityId: bankA })
      );
      await withTenant(harness.appQuery.bind(harness), bankB, async (q) =>
        insertAuditEntry(q, { bankId: bankB, action: "B-only", entityType: "bank", entityId: bankB })
      );

      // Contexte A ne voit QUE ses entrées
      const rowsA = await withTenant(harness.appQuery.bind(harness), bankA, async (q) => {
        const res = await q("SELECT bank_id, action FROM audit_log");
        return res.rows as Array<{ bank_id: string; action: string }>;
      });
      expect(rowsA.length).toBeGreaterThan(0);
      expect(rowsA.every((r) => r.bank_id === bankA)).toBe(true);
      expect(rowsA.some((r) => r.action === "B-only")).toBe(false);

      // La policy tenant_isolation doit exister sur audit_log
      const policy = await harness.query(`
        SELECT policyname FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'audit_log'
          AND policyname = 'tenant_isolation'
      `);
      expect(policy.rows).toHaveLength(1);

      // RLS ENABLED + FORCED sur audit_log
      const rls = await harness.query(`
        SELECT pc.relrowsecurity, pc.relforcerowsecurity
        FROM pg_class pc
        WHERE pc.relname = 'audit_log' AND pc.relnamespace = 'public'::regnamespace
      `);
      expect(rls.rows[0]!.relrowsecurity).toBe(true);
      expect(rls.rows[0]!.relforcerowsecurity).toBe(true);
    },
    60_000
  );

  // ───────────────────────────────────────────────────────────────────────────
  // Critère 6 : insertAuditEntry typé — entrée manuelle API insérée et relue
  // ───────────────────────────────────────────────────────────────────────────
  it(
    "DB-004: insertAuditEntry typé — entrée manuelle API insérée et relue (test)",
    async () => {
      const row = await withTenant(harness.appQuery.bind(harness), bankA, async (q) => {
        return insertAuditEntry(q, {
          bankId: bankA,
          actorId,
          actorRole: "BANK_ADMIN",
          actorEmail: "admin@banque-a.io",
          action: "PATCH /banks/:id/theme",
          entityType: "bank",
          entityId: bankA,
          ip: "196.200.10.5",
          diff: { new: { theme: "dark" } },
        });
      });

      expect(row.id).toBeDefined();
      expect(row.bank_id).toBe(bankA);
      expect(row.actor_id).toBe(actorId);
      expect(row.actor_role).toBe("BANK_ADMIN");
      expect(row.actor_email).toBe("admin@banque-a.io");
      expect(row.action).toBe("PATCH /banks/:id/theme");
      expect(row.entity_type).toBe("bank");
      expect(row.ip).toBe("196.200.10.5");
      expect(row.diff).toEqual({ new: { theme: "dark" } });
      // occurred_at fixé par la base (jamais fourni par le client)
      expect(row.occurred_at).toBeInstanceOf(Date);

      // Relecture indépendante sous contexte A
      const reread = await withTenant(harness.appQuery.bind(harness), bankA, async (q) => {
        const res = await q(`SELECT action, occurred_at FROM audit_log WHERE id = '${row.id}'`);
        return res.rows;
      });
      expect(reread).toHaveLength(1);
      expect(reread[0]!.action).toBe("PATCH /banks/:id/theme");
    },
    60_000
  );

  // ───────────────────────────────────────────────────────────────────────────
  // Critère 7 : migration up/down propre sur base seedée
  // ───────────────────────────────────────────────────────────────────────────
  it(
    "DB-004: migration up/down propre sur base seedée",
    async () => {
      // Base seedée : audit_log existe déjà (up appliqué en beforeAll) avec des données
      await withTenant(harness.appQuery.bind(harness), bankA, async (q) =>
        insertAuditEntry(q, { bankId: bankA, action: "seed-row", entityType: "bank", entityId: bankA })
      );
      const before = await harness.query("SELECT count(*)::int AS n FROM audit_log");
      expect(Number(before.rows[0]!.n)).toBeGreaterThan(0);

      // La migration 0003 down doit être documentée et idempotente : le down teardown
      // supprime triggers/fonctions/table sans erreur sur base seedée.
      const { readFileSync } = await import("node:fs");
      const { fileURLToPath } = await import("node:url");
      const { dirname, join } = await import("node:path");
      const migDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "migrations");
      const downSql = readFileSync(join(migDir, "0003_audit_log.down.sql"), "utf8");
      const statements = downSql
        .split("--> statement-breakpoint")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      for (const stmt of statements) {
        await harness.query(stmt);
      }

      // Après down : la table audit_log n'existe plus, et les tables auditées n'ont plus
      // de trigger d'audit → aucune erreur sur des mutations normales.
      const tableExists = await harness.query(`
        SELECT to_regclass('public.audit_log') IS NOT NULL AS present
      `);
      expect(tableExists.rows[0]!.present).toBe(false);

      const remaining = await harness.query(`
        SELECT count(*)::int AS n FROM pg_trigger tg
        JOIN pg_class c ON c.oid = tg.tgrelid
        WHERE tg.tgname LIKE 'audit_%' AND NOT tg.tgisinternal
      `);
      expect(Number(remaining.rows[0]!.n)).toBe(0);

      // Réappliquer up (0003) → base de nouveau saine (idempotence up)
      const upSql = readFileSync(join(migDir, "0003_audit_log.sql"), "utf8");
      const upStatements = upSql
        .split("--> statement-breakpoint")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      for (const stmt of upStatements) {
        await harness.query(stmt);
      }
      const restored = await harness.query(`
        SELECT to_regclass('public.audit_log') IS NOT NULL AS present
      `);
      expect(restored.rows[0]!.present).toBe(true);
    },
    60_000
  );
});
