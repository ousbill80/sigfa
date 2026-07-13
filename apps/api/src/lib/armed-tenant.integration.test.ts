/**
 * Test d'intégration — `withArmedTenant` armé sur PostgreSQL 16 réelle (SEC-002).
 *
 * Prouve la DÉFENSE-EN-PROFONDEUR RLS sur la connexion `sigfa_app` NOBYPASSRLS
 * (jamais l'owner qui contourne FORCE RLS) :
 *   - contexte A armé → voit ses lignes, ZÉRO ligne de B (RLS, pas `WHERE bank_id`) ;
 *   - injection `bank_id=B` sous contexte A → rejet WITH CHECK ;
 *   - COMPOSITION SEC-001 : `withAudit(inTransaction:true)` dans la transaction
 *     armée écrit une entrée `audit_log` qui HÉRITE du contexte `app.current_bank_id`
 *     (mutation + audit atomiques, RLS armée AVANT les deux).
 *
 * @module
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  startPostgresContainerWithRoles,
  type DualConnectionHarness,
} from "@sigfa/testing/tenant-isolation";
import { applyMigrations } from "@sigfa/database/test-support";
import { withArmedTenant, type ArmableConnection } from "src/lib/armed-tenant.js";
import { withAudit, type AuditRequestContext } from "src/audit/with-audit.js";
import type { Client } from "pg";
import type { TenantContext } from "src/middleware/tenant.js";

let h: DualConnectionHarness;

const bankA = "aaaaaaaa-0000-4000-8000-00000000000a";
const bankB = "bbbbbbbb-0000-4000-8000-00000000000b";
const agencyA = "aa000000-0000-4000-8000-00000000000a";
const agencyB = "bb000000-0000-4000-8000-00000000000b";

/** Adapte `appQuery` (connexion sigfa_app) en `ArmableConnection`. */
function armable(harness: DualConnectionHarness): ArmableConnection {
  return {
    query: async (sql: string, values?: unknown[]) => {
      const res =
        values !== undefined
          ? await harness.appQuery(sql, values)
          : await harness.appQuery(sql);
      return { rows: res.rows };
    },
  };
}

beforeAll(async () => {
  h = await startPostgresContainerWithRoles();
  await applyMigrations(h);
  await h.query(
    `INSERT INTO banks (id, name, slug) VALUES
       ('${bankA}','Banque A','banque-a-sec002'),
       ('${bankB}','Banque B','banque-b-sec002') ON CONFLICT (id) DO NOTHING`
  );
  await h.query(
    `INSERT INTO agencies (id, bank_id, name) VALUES
       ('${agencyA}','${bankA}','Agence A'),
       ('${agencyB}','${bankB}','Agence B') ON CONFLICT (id) DO NOTHING`
  );
}, 180_000);

afterAll(async () => {
  await h?.stop();
}, 30_000);

describe("SEC-002: withArmedTenant armé sur PG réelle (sigfa_app NOBYPASSRLS)", () => {
  it("SEC-002: contexte A armé → voit ses lignes, ZÉRO ligne de B (RLS forcée, pas WHERE bank_id)", async () => {
    const rows = await withArmedTenant(armable(h), bankA, async (conn) => {
      // Requête SANS `WHERE bank_id` : seule la RLS armée filtre.
      const res = await conn.query("SELECT bank_id FROM agencies");
      return res.rows as Array<{ bank_id: string }>;
    });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.bank_id === bankA)).toBe(true);
    expect(rows.some((r) => r.bank_id === bankB)).toBe(false);
  }, 60_000);

  it("SEC-002: injection bank_id=B en INSERT sous contexte A → rejet WITH CHECK", async () => {
    await expect(
      withArmedTenant(armable(h), bankA, async (conn) => {
        return conn.query(
          `INSERT INTO agencies (id, bank_id, name)
             VALUES (gen_random_uuid(), '${bankB}', 'injection') RETURNING id`
        );
      })
    ).rejects.toThrow();
  }, 60_000);

  it("SEC-002: composition SEC-001 — withAudit(inTransaction) hérite du contexte armé, audit atomique", async () => {
    const tenant: TenantContext = {
      requestId: "req-sec002",
      userId: "cccccccc-0000-4000-8000-00000000000c",
      bankId: bankA,
      role: "AGENCY_DIRECTOR",
      agencyIds: [agencyA],
    };

    const auditedAgencyId = await withArmedTenant(armable(h), bankA, async (conn) => {
      // La connexion armée expose `query(sql)` → compatible `Client` pour withAudit.
      const ctx: AuditRequestContext = {
        db: conn as unknown as Client,
        tenant,
        ip: "41.67.128.9",
        inTransaction: true,
      };
      return withAudit(ctx, async (db) => {
        const res = await db.query(
          `UPDATE agencies SET name = 'A renommée' WHERE id = '${agencyA}' RETURNING id`
        );
        const id = (res.rows[0] as { id: string }).id;
        return {
          result: id,
          audit: {
            action: "PATCH /agencies/:id",
            entityType: "agency",
            entityId: id,
            actorEmail: "dir@banque-a.ci",
          },
        };
      });
    });

    expect(auditedAgencyId).toBe(agencyA);

    // L'entrée d'audit APPLICATIVE (SEC-001) a bien été committée pour la banque A
    // avec le contexte armé hérité. (Le trigger de base peut aussi journaliser la
    // même mutation — on cible donc précisément l'action applicative.)
    const audit = await withArmedTenant(armable(h), bankA, async (conn) => {
      const res = await conn.query(
        `SELECT bank_id, action, entity_id FROM audit_log
           WHERE entity_id = '${agencyA}' AND action = 'PATCH /agencies/:id'`
      );
      return res.rows as Array<{ bank_id: string; action: string; entity_id: string }>;
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]?.bank_id).toBe(bankA);
    expect(audit[0]?.action).toBe("PATCH /agencies/:id");

    // Contexte B ne voit PAS cette entrée d'audit (isolation RLS sur audit_log).
    const auditFromB = await withArmedTenant(armable(h), bankB, async (conn) => {
      const res = await conn.query(
        `SELECT id FROM audit_log WHERE entity_id = '${agencyA}'`
      );
      return res.rows;
    });
    expect(auditFromB).toHaveLength(0);
  }, 60_000);

  it("SEC-002: échec métier dans la transaction armée → ROLLBACK global, aucune mutation ni audit persistés", async () => {
    await expect(
      withArmedTenant(armable(h), bankA, async (conn) => {
        const ctx: AuditRequestContext = {
          db: conn as unknown as Client,
          tenant: {
            requestId: "req-fail",
            userId: "cccccccc-0000-4000-8000-00000000000c",
            bankId: bankA,
            role: "AGENCY_DIRECTOR",
            agencyIds: [agencyA],
          },
          ip: null,
          inTransaction: true,
        };
        await withAudit(ctx, async (db) => {
          await db.query(
            `UPDATE agencies SET name = 'ne doit pas persister' WHERE id = '${agencyA}'`
          );
          throw new Error("échec métier après mutation");
        });
      })
    ).rejects.toThrow("échec métier après mutation");

    // La mutation a été annulée : le nom reste celui du test précédent.
    const after = await withArmedTenant(armable(h), bankA, async (conn) => {
      const res = await conn.query(
        `SELECT name FROM agencies WHERE id = '${agencyA}'`
      );
      return (res.rows[0] as { name: string }).name;
    });
    expect(after).not.toBe("ne doit pas persister");
  }, 60_000);
});
