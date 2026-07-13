/**
 * Campagne tenant-isolation EXHAUSTIVE — moteur d'exécution (SEC-002).
 *
 * Seed un graphe de fixtures MINIMAL pour deux banques (A, B) couvrant CHAQUE table
 * `bank_id` (introspection + résolution générique des FK), puis exécute les 7 vecteurs
 * d'attaque de `isolation-matrix.ts` sur la connexion `sigfa_app` NOBYPASSRLS.
 *
 * Le seed passe par la connexion MIGRATEUR (BYPASSRLS) — c'est la seule façon de
 * poser des lignes des deux tenants ; les attaques, elles, passent TOUJOURS par
 * `sigfa_app` (sinon FORCE RLS est contourné silencieusement — leçon DB-002).
 *
 * @module
 */

import type { DualConnectionHarness } from "@sigfa/testing/tenant-isolation";
import { introspectBankIdTables } from "./isolation-matrix.js";

/** Résultat du seed : ids d'une ligne A et d'une ligne B par table. */
export interface SeededRows {
  /** bank_id de A. */
  bankA: string;
  /** bank_id de B. */
  bankB: string;
  /** table → { a: id ligne A, b: id ligne B } (quand la table a une colonne `id`). */
  rowIds: Map<string, { a: string | null; b: string | null }>;
}

/** Métadonnée de colonne pour la génération de valeurs. */
interface ColumnMeta {
  column: string;
  dataType: string;
  udtName: string;
  isNullable: boolean;
  hasDefault: boolean;
  fkTable: string | null;
  fkColumn: string | null;
}

/** Introspecte colonnes + contraintes FK d'une table. */
async function introspectColumns(
  h: DualConnectionHarness,
  table: string
): Promise<ColumnMeta[]> {
  const cols = await h.query(`
    SELECT column_name, data_type, udt_name, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name='${table}'
    ORDER BY ordinal_position
  `);
  const fks = await h.query(`
    SELECT kcu.column_name, ccu.table_name AS ref_table, ccu.column_name AS ref_column
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
    WHERE tc.constraint_type='FOREIGN KEY' AND tc.table_schema='public' AND tc.table_name='${table}'
  `);
  const fkMap = new Map<string, { table: string; column: string }>();
  for (const r of fks.rows as Array<{ column_name: string; ref_table: string; ref_column: string }>) {
    fkMap.set(r.column_name, { table: r.ref_table, column: r.ref_column });
  }
  return (cols.rows as Array<{
    column_name: string;
    data_type: string;
    udt_name: string;
    is_nullable: string;
    column_default: string | null;
  }>).map((r) => {
    const fk = fkMap.get(r.column_name) ?? null;
    return {
      column: r.column_name,
      dataType: r.data_type,
      udtName: r.udt_name,
      isNullable: r.is_nullable === "YES",
      hasDefault: r.column_default !== null,
      fkTable: fk?.table ?? null,
      fkColumn: fk?.column ?? null,
    };
  });
}

/** Ordonne les tables pour respecter les FK (tri topologique best-effort). */
async function topoOrder(h: DualConnectionHarness, tables: string[]): Promise<string[]> {
  const deps = new Map<string, Set<string>>();
  for (const t of tables) {
    const cols = await introspectColumns(h, t);
    const set = new Set<string>();
    for (const c of cols) {
      if (c.fkTable && c.fkTable !== t && tables.includes(c.fkTable)) set.add(c.fkTable);
    }
    deps.set(t, set);
  }
  const ordered: string[] = [];
  const seen = new Set<string>();
  const visit = (t: string, stack: Set<string>): void => {
    if (seen.has(t)) return;
    if (stack.has(t)) {
      // cycle : casser en insérant tel quel (FK auto-référente tolérée nullable)
      return;
    }
    stack.add(t);
    for (const d of deps.get(t) ?? []) visit(d, stack);
    stack.delete(t);
    seen.add(t);
    ordered.push(t);
  };
  for (const t of tables) visit(t, new Set());
  return ordered;
}

/** Génère une valeur littérale SQL pour une colonne (hors bank_id/FK résolues). */
function literalFor(col: ColumnMeta, seed: string): string | null {
  const udt = col.udtName;
  // Types énumérés (role, counter_status, …) : on prend la 1re valeur via cast d'un
  // libellé neutre échouerait ; on laisse NULL si nullable, sinon on tente une valeur.
  switch (udt) {
    case "uuid":
      return "gen_random_uuid()";
    case "text":
    case "varchar":
    case "bpchar":
      return `'${seed}'`;
    case "int2":
    case "int4":
    case "int8":
      return "1";
    case "numeric":
    case "float4":
    case "float8":
      return "1";
    case "bool":
      return "false";
    case "timestamptz":
    case "timestamp":
      return "now()";
    case "date":
      return "current_date";
    case "jsonb":
      return `'{}'::jsonb`;
    case "json":
      return `'{}'::json`;
    case "inet":
      return `'127.0.0.1'::inet`;
    case "_text":
      return `ARRAY['FR']::text[]`;
    default:
      // Type enum utilisateur : tenter la première étiquette de l'enum.
      return null;
  }
}

/** Résout la première étiquette d'un type enum, ou null. */
async function firstEnumLabel(h: DualConnectionHarness, udtName: string): Promise<string | null> {
  const res = await h.query(`
    SELECT e.enumlabel
    FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = '${udtName}'
    ORDER BY e.enumsortorder
    LIMIT 1
  `);
  const row = (res.rows as Array<{ enumlabel: string }>)[0];
  return row ? row.enumlabel : null;
}

/**
 * Insère une ligne minimale dans `table` pour la banque `bankId`, en résolvant les
 * FK via `rowIds` déjà seedées. Passe par la connexion migrateur (BYPASSRLS).
 * Retourne l'id inséré (si colonne `id`), ou null.
 */
async function seedRow(
  h: DualConnectionHarness,
  table: string,
  bankId: string,
  slot: "a" | "b",
  rowIds: SeededRows["rowIds"]
): Promise<string | null> {
  const cols = await introspectColumns(h, table);
  const names: string[] = [];
  const values: string[] = [];
  for (const c of cols) {
    if (c.column === "bank_id") {
      names.push("bank_id");
      values.push(`'${bankId}'`);
      continue;
    }
    if (c.fkTable && c.fkColumn === "id") {
      const ref = rowIds.get(c.fkTable);
      const refId = ref ? ref[slot] : null;
      if (refId) {
        names.push(c.column);
        values.push(`'${refId}'`);
      } else if (!c.isNullable && !c.hasDefault) {
        // FK requise non seedée : impossible de seeder proprement → on abandonne.
        return null;
      }
      continue;
    }
    if (c.hasDefault) continue; // laisser le défaut
    if (c.isNullable) continue; // laisser NULL
    // Colonne requise sans défaut, non-FK : générer une valeur.
    let lit = literalFor(c, `${table.slice(0, 8)}-${slot}`);
    if (lit === null) {
      const label = await firstEnumLabel(h, c.udtName);
      lit = label ? `'${label}'::"${c.udtName}"` : "NULL";
    }
    names.push(c.column);
    values.push(lit);
  }
  const hasId = cols.some((c) => c.column === "id");
  const returning = hasId ? "RETURNING id" : "";
  try {
    const res = await h.query(
      `INSERT INTO ${table} (${names.join(", ")}) VALUES (${values.join(", ")}) ${returning}`
    );
    if (hasId) return (res.rows[0] as { id: string } | undefined)?.id ?? null;
    return null;
  } catch {
    return null; // table trop contrainte pour un seed générique : signalée par la campagne
  }
}

/**
 * Seed A + B pour toutes les tables `bank_id`, dans l'ordre des FK.
 *
 * @param h      - Harness dual-connexion
 * @param bankA  - bank_id A (UUID)
 * @param bankB  - bank_id B (UUID)
 * @returns Ids seedés par table
 */
export async function seedTwoTenants(
  h: DualConnectionHarness,
  bankA: string,
  bankB: string
): Promise<SeededRows> {
  const tables = await introspectBankIdTables(h);
  const ordered = await topoOrder(h, tables);
  const rowIds: SeededRows["rowIds"] = new Map();
  for (const t of ordered) rowIds.set(t, { a: null, b: null });
  // banks est la racine : seeder d'abord les deux banques si présente.
  for (const slot of ["a", "b"] as const) {
    const bankId = slot === "a" ? bankA : bankB;
    for (const t of ordered) {
      const id = await seedRow(h, t, bankId, slot, rowIds);
      const entry = rowIds.get(t);
      if (entry) entry[slot] = id;
    }
  }
  return { bankA, bankB, rowIds };
}

/** Ouvre un contexte tenant armé sur la connexion applicative et exécute `fn`. */
export async function inAppCtx<T>(
  h: DualConnectionHarness,
  bankId: string | null,
  fn: () => Promise<T>
): Promise<T> {
  await h.appQuery("BEGIN");
  try {
    if (bankId !== null) {
      await h.appQuery(`SET LOCAL app.current_bank_id = '${bankId}'`);
    }
    const r = await fn();
    await h.appQuery("COMMIT");
    return r;
  } catch (err) {
    await h.appQuery("ROLLBACK").catch(() => undefined);
    throw err;
  }
}
