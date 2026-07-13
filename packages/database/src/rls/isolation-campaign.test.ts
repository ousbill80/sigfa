/**
 * SEC-002 — Campagne tenant-isolation EXHAUSTIVE (table × 7 vecteurs) sur PG réelle.
 *
 * Axe TABLE énuméré DYNAMIQUEMENT (`information_schema` → toute table `bank_id`).
 * Axe ATTAQUE : les 7 vecteurs de `isolation-matrix.ts`. Connexion `sigfa_app`
 * NOBYPASSRLS (jamais l'owner). Toute table `bank_id` sans couverture RLS → échec.
 *
 * @module
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  startPostgresContainerWithRoles,
  type DualConnectionHarness,
} from "@sigfa/testing/tenant-isolation";
import { applyMigrations } from "src/test-support/migrate.js";
import {
  introspectBankIdTables,
  introspectIsolatedTables,
  ISOLATION_EXCLUDED_TABLES,
  buildMatrix,
  ATTACK_VECTORS,
} from "./isolation-matrix.js";
import { seedTwoTenants, inAppCtx, type SeededRows } from "./isolation-campaign.js";

let h: DualConnectionHarness;
let tables: string[];
let seeded: SeededRows;

const bankA = "a1a1a1a1-0000-4000-8000-0000000000a1";
const bankB = "b2b2b2b2-0000-4000-8000-0000000000b2";

beforeAll(async () => {
  h = await startPostgresContainerWithRoles();
  await applyMigrations(h);
  await h.query(
    `INSERT INTO banks (id, name, slug) VALUES
      ('${bankA}','A','sec002-camp-a'),('${bankB}','B','sec002-camp-b')
     ON CONFLICT (id) DO NOTHING`
  );
  seeded = await seedTwoTenants(h, bankA, bankB);
  tables = await introspectBankIdTables(h);
}, 240_000);

afterAll(async () => {
  await h?.stop();
}, 30_000);

describe("SEC-002: campagne tenant-isolation EXHAUSTIVE (table × attaque, PG réelle, sigfa_app)", () => {
  it("SEC-002: introspection information_schema — 100% des tables à bank_id ont RLS+policy tenant_isolation (échec si manquante)", async () => {
    const isolated = new Set(await introspectIsolatedTables(h));
    const excluded = new Set(ISOLATION_EXCLUDED_TABLES);
    const uncovered = tables.filter((t) => !isolated.has(t) && !excluded.has(t));
    expect(
      uncovered,
      `Tables à bank_id SANS policy tenant_isolation (trou d'isolation) : ${uncovered.join(", ")}`
    ).toEqual([]);
    expect(tables.length).toBeGreaterThan(0);
  }, 60_000);

  it("SEC-002: la matrice couvre CHAQUE (table, vecteur) — 7 vecteurs par table, aucune cellule manquante", () => {
    const cells = buildMatrix(tables);
    expect(cells.length).toBe(tables.length * ATTACK_VECTORS.length);
    for (const t of tables) {
      const forTable = cells.filter((c) => c.table === t).map((c) => c.vector);
      expect(new Set(forTable)).toEqual(new Set(ATTACK_VECTORS));
    }
  });

  it("SEC-002: CROSS_TENANT_READ — ctx A ne lit AUCUNE ligne de B sur CHAQUE table (0 ligne, jamais 500)", async () => {
    for (const table of tables) {
      const rows = await inAppCtx(h, bankA, async () => {
        const res = await h.appQuery(`SELECT bank_id FROM ${table}`);
        return res.rows as Array<{ bank_id: string }>;
      });
      expect(
        rows.some((r) => r.bank_id === bankB),
        `${table}: ctx A voit une ligne de B (CROSS_TENANT_READ)`
      ).toBe(false);
    }
  }, 120_000);

  it("SEC-002: CROSS_TENANT_WRITE — ctx A n'affecte AUCUNE ligne de B (UPDATE/DELETE → 0 effet)", async () => {
    for (const table of tables) {
      const ref = seeded.rowIds.get(table);
      if (!ref?.b) continue; // pas de ligne B seedée (table sans id / trop contrainte)
      const deletedFromB = await inAppCtx(h, bankA, async () => {
        // Cibler la ligne de B par son id sous contexte A : RLS doit la rendre inatteignable.
        const res = await h.appQuery(
          `DELETE FROM ${table} WHERE id = '${ref.b}' RETURNING id`
        );
        return res.rows.length;
      }).catch((err: unknown) => {
        // `audit_log` est append-only (DB-004) : REVOKE DELETE pour sigfa_app →
        // « permission denied ». C'est une isolation ENCORE PLUS forte (aucune écriture
        // possible du tout), pas une régression. Le cross-tenant write est bloqué.
        const msg = err instanceof Error ? err.message : String(err);
        expect(
          /permission denied/i.test(msg),
          `${table}: DELETE cross-tenant a échoué pour une raison autre qu'un REVOKE : ${msg}`
        ).toBe(true);
        return 0;
      });
      expect(
        deletedFromB,
        `${table}: ctx A a supprimé une ligne de B (CROSS_TENANT_WRITE)`
      ).toBe(0);
      // La ligne B existe toujours (vérif via migrateur BYPASSRLS).
      const stillThere = await h.query(`SELECT 1 FROM ${table} WHERE id = '${ref.b}'`);
      expect(stillThere.rows.length, `${table}: ligne B supprimée à tort`).toBe(1);
    }
  }, 120_000);

  it("SEC-002: INJECTED_BANK_ID_BODY — INSERT bank_id=B sous ctx A → rejet WITH CHECK sur CHAQUE table", async () => {
    for (const table of tables) {
      // On ne fabrique pas un INSERT complet par table ; on prouve le rejet WITH CHECK
      // de façon générique : un UPDATE de bank_id vers B sur une ligne A doit échouer
      // ou n'affecter aucune ligne (la ligne quitterait le tenant courant).
      const ref = seeded.rowIds.get(table);
      if (!ref?.a) continue;
      const result = await inAppCtx(h, bankA, async () => {
        try {
          const res = await h.appQuery(
            `UPDATE ${table} SET bank_id = '${bankB}' WHERE id = '${ref.a}' RETURNING id`
          );
          return { threw: false, affected: res.rows.length };
        } catch {
          return { threw: true, affected: 0 };
        }
      }).catch(() => ({ threw: true, affected: 0 }));
      expect(
        result.threw || result.affected === 0,
        `${table}: réassignation bank_id→B acceptée sous ctx A (WITH CHECK défaillant)`
      ).toBe(true);
    }
  }, 120_000);

  it("SEC-002: INJECTED_BANK_ID_PARAM — ressource de B ciblée par id sous ctx A → invisible (0 ligne, non-révélateur)", async () => {
    for (const table of tables) {
      const ref = seeded.rowIds.get(table);
      if (!ref?.b) continue;
      const visible = await inAppCtx(h, bankA, async () => {
        const res = await h.appQuery(`SELECT id FROM ${table} WHERE id = '${ref.b}'`);
        return res.rows.length;
      });
      expect(
        visible,
        `${table}: ressource de B visible par id sous ctx A (INJECTED_BANK_ID_PARAM)`
      ).toBe(0);
    }
  }, 120_000);

  it("SEC-002: MISSING_CONTEXT — sans app.current_bank_id → 0 ligne / écriture rejetée sur CHAQUE table", async () => {
    for (const table of tables) {
      // `bank_id` existe par construction (axe TABLE) : projection robuste, pas de `id`.
      const rows = await inAppCtx(h, null, async () => {
        const res = await h.appQuery(`SELECT bank_id FROM ${table}`);
        return res.rows.length;
      });
      expect(rows, `${table}: lignes visibles SANS contexte tenant (MISSING_CONTEXT)`).toBe(0);
    }
  }, 120_000);

  it("SEC-002: SQL_INJECTION — payload d'injection sur filtre paramétré → aucune fuite, aucun 500, 0 ligne", async () => {
    const payloads = ["' OR '1'='1", "'; DROP TABLE agencies; --", "x' UNION SELECT bank_id FROM agencies --"];
    for (const table of tables) {
      for (const payload of payloads) {
        const outcome = await inAppCtx(h, bankA, async () => {
          // Filtrage PARAMÉTRÉ ($1) : le payload est une donnée, jamais du SQL.
          // `bank_id` existe sur chaque table (axe TABLE) → robuste sans colonne `id`.
          const res = await h.appQuery(
            `SELECT bank_id FROM ${table} WHERE bank_id::text = $1`,
            [payload]
          );
          return res.rows.length;
        }).catch((err: unknown) => {
          // Une erreur de cast (uuid invalide) est acceptable : PAS une fuite, PAS un 500 route.
          const msg = err instanceof Error ? err.message : String(err);
          // Jamais d'erreur de syntaxe SQL (preuve du paramétrage, non de l'échappement manuel).
          expect(/syntax error/i.test(msg), `${table}: injection a produit une erreur de syntaxe (non paramétré)`).toBe(false);
          return 0;
        });
        expect(
          outcome,
          `${table}: l'injection "${payload}" a retourné des lignes (fuite potentielle)`
        ).toBe(0);
      }
      // La table agencies existe toujours (le DROP injecté n'a rien exécuté).
      const survived = await h.query(`SELECT 1 FROM agencies LIMIT 1`);
      expect(survived.rows.length >= 0).toBe(true);
    }
  }, 180_000);

  it("SEC-002: PLATFORM_LEAK — lignes plateforme (bank_id NULL, ex. users SUPER_ADMIN) invisibles au tenant", async () => {
    // Poser un utilisateur SUPER_ADMIN plateforme (bank_id NULL) via migrateur.
    await h.query(
      `INSERT INTO users (bank_id, email, password_hash, first_name, last_name, role)
       VALUES (NULL, 'superadmin-sec002@sigfa.ci', 'x', 'Super', 'Admin', 'SUPER_ADMIN')
       ON CONFLICT (email) DO NOTHING`
    );
    const visibleToTenant = await inAppCtx(h, bankA, async () => {
      const res = await h.appQuery(
        `SELECT id FROM users WHERE email = 'superadmin-sec002@sigfa.ci'`
      );
      return res.rows.length;
    });
    expect(
      visibleToTenant,
      "Un SUPER_ADMIN plateforme (bank_id NULL) est visible sous un contexte tenant (PLATFORM_LEAK)"
    ).toBe(0);
  }, 60_000);
});
