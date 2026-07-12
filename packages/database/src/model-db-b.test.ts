/**
 * MODEL-DB-B — Schéma conseiller : flag sur `users` + `tickets.target_manager_id`.
 *
 * TDD rouge→vert : ces tests échouent AVANT l'implémentation.
 * Tous nommés `MODEL-DB-B: ...` (CLAUDE.md §4 T8 — mapping EARS ↔ tests).
 *
 * Décisions (docs/prd/model/_arbitrage.md) :
 *   D5 — Conseiller = liste publique NOMINATIVE (pas de CRM) :
 *        `users.is_relationship_manager` bool NOT NULL default false,
 *        `display_name` text NULLABLE, `photo_url` text NULLABLE.
 *        `users` déjà sous RLS (exception SUPER_ADMIN) → aucune nouvelle policy.
 *   D6 — File conseiller = `tickets.target_manager_id` uuid NULLABLE FK users (RESTRICT)
 *        + index. Pas de nouvelle table file (queue logique en API-B).
 *
 * Périmètre :
 *   1. Structure Drizzle in-process (users : 3 colonnes ; tickets : target_manager_id)
 *   2. Assertions base réelle (Testcontainers PG16) : colonnes, défaut, nullabilité, FK RESTRICT, index
 *   3. RLS users inchangée (nouvelles colonnes héritent de la policy tenant_isolation existante)
 *   4. Migration up/down + idempotence (apply/rollback/réapply)
 *
 * @module
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  startPostgresContainerWithRoles,
  type DualConnectionHarness,
} from "@sigfa/testing/tenant-isolation";
import { users } from "./schema/users.js";
import { tickets } from "./schema/tickets.js";
import { applyMigrations, splitStatements } from "./test-support/migrate.js";

const MIGRATIONS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "migrations"
);

/** Nom du fichier de migration MODEL-DB-B (à la suite de 0009). */
const UP_FILE = "0010_relationship_manager.sql";
const DOWN_FILE = "0010_relationship_manager.down.sql";

/** Exécute un fichier de migration (.sql ou .down.sql) statement par statement. */
async function runMigrationFile(
  harness: DualConnectionHarness,
  fileName: string
): Promise<void> {
  const sql = readFileSync(join(MIGRATIONS_DIR, fileName), "utf8");
  for (const statement of splitStatements(sql)) {
    await harness.query(statement);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Structure Drizzle in-process (sans base)
// ─────────────────────────────────────────────────────────────────────────────

describe("MODEL-DB-B: users — structure Drizzle (in-process)", () => {
  it("MODEL-DB-B: users.is_relationship_manager présente, NOT NULL, défaut false", () => {
    const config = getTableConfig(users);
    const col = config.columns.find((c) => c.name === "is_relationship_manager");
    expect(col, "is_relationship_manager doit être définie").toBeDefined();
    expect(col?.notNull, "is_relationship_manager NOT NULL").toBe(true);
    expect(col?.hasDefault, "is_relationship_manager a un défaut").toBe(true);
    expect(col?.default, "défaut false").toBe(false);
  });

  it("MODEL-DB-B: users.display_name présente et NULLABLE", () => {
    const config = getTableConfig(users);
    const col = config.columns.find((c) => c.name === "display_name");
    expect(col, "display_name doit être définie").toBeDefined();
    expect(col?.notNull, "display_name NULLABLE").toBeFalsy();
  });

  it("MODEL-DB-B: users.photo_url présente et NULLABLE", () => {
    const config = getTableConfig(users);
    const col = config.columns.find((c) => c.name === "photo_url");
    expect(col, "photo_url doit être définie").toBeDefined();
    expect(col?.notNull, "photo_url NULLABLE").toBeFalsy();
  });
});

describe("MODEL-DB-B: tickets — structure Drizzle (in-process)", () => {
  it("MODEL-DB-B: tickets.target_manager_id présente et NULLABLE", () => {
    const config = getTableConfig(tickets);
    const col = config.columns.find((c) => c.name === "target_manager_id");
    expect(col, "target_manager_id doit être définie").toBeDefined();
    expect(col?.notNull, "target_manager_id NULLABLE").toBeFalsy();
  });

  it("MODEL-DB-B: tickets.service_id reste NOT NULL (additif — ne casse pas la Phase A)", () => {
    const config = getTableConfig(tickets);
    const col = config.columns.find((c) => c.name === "service_id");
    expect(col?.notNull, "service_id doit rester NOT NULL").toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Fichiers de migration présents
// ─────────────────────────────────────────────────────────────────────────────

describe("MODEL-DB-B: migration 0010 — fichiers présents", () => {
  it("MODEL-DB-B: 0010_relationship_manager.sql et .down.sql présents", () => {
    const files = readdirSync(MIGRATIONS_DIR);
    expect(files).toContain(UP_FILE);
    expect(files).toContain(DOWN_FILE);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Assertions base réelle (Testcontainers PostgreSQL 16)
// ─────────────────────────────────────────────────────────────────────────────

describe("MODEL-DB-B: base réelle — colonnes, défaut, FK RESTRICT, index, RLS", () => {
  let harness: DualConnectionHarness;

  const bank = "d0b00000-0000-4000-8000-0000000000b1";
  const otherBank = "d0b00000-0000-4000-8000-0000000000b2";
  const agency = "da000000-0000-4000-8000-0000000000b1";
  const service = "d5000000-0000-4000-8000-0000000000b1";
  const queue = "d6000000-0000-4000-8000-0000000000b1";
  const manager = "d0100000-0000-4000-8000-0000000000b1";

  beforeAll(async () => {
    harness = await startPostgresContainerWithRoles();
    await applyMigrations(harness);
    await harness.query(
      `INSERT INTO banks (id, name, slug) VALUES ('${bank}', 'Banque DB-B', 'banque-db-b'), ('${otherBank}', 'Banque DB-B 2', 'banque-db-b2')`
    );
    await harness.query(
      `INSERT INTO agencies (id, bank_id, name) VALUES ('${agency}', '${bank}', 'Agence DB-B')`
    );
    await harness.query(
      `INSERT INTO services (id, bank_id, agency_id, code, name, sla_minutes) VALUES ('${service}', '${bank}', '${agency}', 'CO', 'Conseil', 20)`
    );
    await harness.query(
      `INSERT INTO queues (id, bank_id, agency_id, service_id) VALUES ('${queue}', '${bank}', '${agency}', '${service}')`
    );
    await harness.query(
      `INSERT INTO users (id, bank_id, email, password_hash, first_name, last_name, role, is_relationship_manager, display_name)
       VALUES ('${manager}', '${bank}', 'conseiller@db-b.ci', 'x', 'Awa', 'Koné', 'AGENT', true, 'Awa K.')`
    );
  }, 180_000);

  afterAll(async () => {
    await harness?.stop();
  }, 30_000);

  it("MODEL-DB-B: users.is_relationship_manager — NOT NULL, défaut false, type boolean", async () => {
    const r = await harness.query(
      `SELECT data_type, is_nullable, column_default FROM information_schema.columns
        WHERE table_schema='public' AND table_name='users' AND column_name='is_relationship_manager'`
    );
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]?.data_type).toBe("boolean");
    expect(r.rows[0]?.is_nullable).toBe("NO");
    expect(String(r.rows[0]?.column_default)).toMatch(/false/);
  });

  it("MODEL-DB-B: users.display_name / photo_url — text NULLABLE", async () => {
    const r = await harness.query(
      `SELECT column_name, data_type, is_nullable FROM information_schema.columns
        WHERE table_schema='public' AND table_name='users'
          AND column_name IN ('display_name','photo_url') ORDER BY column_name`
    );
    expect(r.rows).toHaveLength(2);
    for (const row of r.rows) {
      expect(row.data_type).toBe("text");
      expect(row.is_nullable).toBe("YES");
    }
  });

  it("MODEL-DB-B: is_relationship_manager défaut false à l'insertion sans valeur", async () => {
    const id = "d0100000-0000-4000-8000-0000000000b9";
    await harness.query(
      `INSERT INTO users (id, bank_id, email, password_hash, first_name, last_name, role)
       VALUES ('${id}', '${bank}', 'agent-default@db-b.ci', 'x', 'B', 'C', 'AGENT')`
    );
    const r = await harness.query(
      `SELECT is_relationship_manager, display_name, photo_url FROM users WHERE id='${id}'`
    );
    expect(r.rows[0]?.is_relationship_manager).toBe(false);
    expect(r.rows[0]?.display_name).toBeNull();
    expect(r.rows[0]?.photo_url).toBeNull();
  });

  it("MODEL-DB-B: tickets.target_manager_id — uuid NULLABLE dans information_schema", async () => {
    const r = await harness.query(
      `SELECT data_type, is_nullable FROM information_schema.columns
        WHERE table_schema='public' AND table_name='tickets' AND column_name='target_manager_id'`
    );
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]?.data_type).toBe("uuid");
    expect(r.rows[0]?.is_nullable).toBe("YES");
  });

  it("MODEL-DB-B: tickets.target_manager_id — FK vers users avec ON DELETE RESTRICT", async () => {
    const r = await harness.query(
      `SELECT rc.delete_rule, ccu.table_name AS ref_table
         FROM information_schema.table_constraints tc
         JOIN information_schema.referential_constraints rc ON rc.constraint_name = tc.constraint_name
         JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
         JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name
        WHERE tc.table_name='tickets' AND tc.constraint_type='FOREIGN KEY'
          AND kcu.column_name='target_manager_id'`
    );
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]?.ref_table).toBe("users");
    expect(r.rows[0]?.delete_rule).toBe("RESTRICT");
  });

  it("MODEL-DB-B: index tickets_target_manager_id_idx présent", async () => {
    const r = await harness.query(
      `SELECT indexname FROM pg_indexes
        WHERE schemaname='public' AND tablename='tickets' AND indexname='tickets_target_manager_id_idx'`
    );
    expect(r.rows).toHaveLength(1);
  });

  it("MODEL-DB-B: ticket avec target_manager_id valide accepté ; suppression du conseiller référencé refusée (RESTRICT)", async () => {
    const ticketId = "d7000000-0000-4000-8000-0000000000b1";
    await harness.query(
      `INSERT INTO tickets (id, bank_id, agency_id, queue_id, service_id, target_manager_id, number, channel, status, tracking_id, issued_at)
       VALUES ('${ticketId}', '${bank}', '${agency}', '${queue}', '${service}', '${manager}', 1, 'KIOSK', 'WAITING', 'dbbtrk0000000000001', now())`
    );
    const r = await harness.query(
      `SELECT target_manager_id FROM tickets WHERE id='${ticketId}'`
    );
    expect(r.rows[0]?.target_manager_id).toBe(manager);
    await expect(
      harness.query(`DELETE FROM users WHERE id='${manager}'`)
    ).rejects.toThrow();
  });

  it("MODEL-DB-B: ticket sans target_manager_id (NULL) reste valide — Phase A/F2 inchangée", async () => {
    const ticketId = "d7000000-0000-4000-8000-0000000000b2";
    await harness.query(
      `INSERT INTO tickets (id, bank_id, agency_id, queue_id, service_id, number, channel, status, tracking_id, issued_at)
       VALUES ('${ticketId}', '${bank}', '${agency}', '${queue}', '${service}', 2, 'KIOSK', 'WAITING', 'dbbtrk0000000000002', now())`
    );
    const r = await harness.query(
      `SELECT target_manager_id FROM tickets WHERE id='${ticketId}'`
    );
    expect(r.rows[0]?.target_manager_id).toBeNull();
  });

  it("MODEL-DB-B: RLS users inchangée — nouvelles colonnes visibles uniquement dans le tenant (policy tenant_isolation)", async () => {
    const { withTenant } = await import("./tenant.js");
    // Contexte de la banque du conseiller → visible
    const inTenant = await withTenant(
      harness.appQuery.bind(harness),
      bank,
      async (query) => {
        const r = await query(
          `SELECT is_relationship_manager, display_name FROM users WHERE id='${manager}'`
        );
        return r.rows as Array<{ is_relationship_manager: boolean; display_name: string }>;
      }
    );
    expect(inTenant).toHaveLength(1);
    expect(inTenant[0]?.is_relationship_manager).toBe(true);
    expect(inTenant[0]?.display_name).toBe("Awa K.");
    // Contexte d'une autre banque → invisible (isolation tenant préservée)
    const crossTenant = await withTenant(
      harness.appQuery.bind(harness),
      otherBank,
      async (query) => {
        const r = await query(`SELECT id FROM users WHERE id='${manager}'`);
        return r.rows as Array<{ id: string }>;
      }
    );
    expect(crossTenant, "conseiller d'une autre banque invisible").toHaveLength(0);
  });

  it("MODEL-DB-B: aucune nouvelle policy sur users — toujours la seule policy tenant_isolation", async () => {
    const r = await harness.query(
      `SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='users'`
    );
    expect(r.rows).toHaveLength(1);
    expect(String(r.rows[0]?.policyname)).toBe("tenant_isolation");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3b. Seed — ≥2 conseillers marqués (D5)
// ─────────────────────────────────────────────────────────────────────────────

describe("MODEL-DB-B: seed — ≥2 conseillers marqués (is_relationship_manager)", () => {
  let harness: DualConnectionHarness;

  beforeAll(async () => {
    harness = await startPostgresContainerWithRoles();
    await applyMigrations(harness);
    const { runSeed } = await import("./seed/index.js");
    process.env.NODE_ENV = "test";
    await runSeed(harness.query.bind(harness), { seedDemo: true });
  }, 180_000);

  afterAll(async () => {
    await harness?.stop();
  }, 30_000);

  it("MODEL-DB-B: seed marque au moins 2 agents comme conseillers avec display_name réaliste", async () => {
    const r = await harness.query(
      `SELECT display_name, photo_url FROM users
        WHERE is_relationship_manager = true
          AND is_active = true AND deleted_at IS NULL
          AND display_name IS NOT NULL
        ORDER BY display_name`
    );
    expect(r.rows.length).toBeGreaterThanOrEqual(2);
    for (const row of r.rows) {
      expect(String(row.display_name).length).toBeGreaterThan(0);
    }
  });

  it("MODEL-DB-B: seed idempotent — 2e passage ne duplique pas les conseillers", async () => {
    const { runSeed } = await import("./seed/index.js");
    await runSeed(harness.query.bind(harness), { seedDemo: true });
    const r = await harness.query(
      `SELECT COUNT(*) AS cnt FROM users WHERE is_relationship_manager = true`
    );
    expect(Number(r.rows[0]?.cnt)).toBeGreaterThanOrEqual(2);
    expect(Number(r.rows[0]?.cnt)).toBeLessThanOrEqual(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Migration up/down + idempotence
// ─────────────────────────────────────────────────────────────────────────────

describe("MODEL-DB-B: migration 0010 — up/down/idempotence (additif)", () => {
  let harness: DualConnectionHarness;

  beforeAll(async () => {
    harness = await startPostgresContainerWithRoles();
    await applyMigrations(harness);
  }, 180_000);

  afterAll(async () => {
    await harness?.stop();
  }, 30_000);

  it("MODEL-DB-B: up idempotent — réapplication de 0010 sans erreur, colonnes présentes", async () => {
    await runMigrationFile(harness, UP_FILE);
    await runMigrationFile(harness, UP_FILE);
    const cols = await harness.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema='public' AND table_name='users'
          AND column_name IN ('is_relationship_manager','display_name','photo_url')`
    );
    expect(cols.rows).toHaveLength(3);
  });

  it("MODEL-DB-B: down 0010 → colonnes users + tickets.target_manager_id supprimées", async () => {
    await runMigrationFile(harness, DOWN_FILE);
    const userCols = await harness.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema='public' AND table_name='users'
          AND column_name IN ('is_relationship_manager','display_name','photo_url')`
    );
    expect(userCols.rows, "3 colonnes users supprimées").toHaveLength(0);
    const tgt = await harness.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema='public' AND table_name='tickets' AND column_name='target_manager_id'`
    );
    expect(tgt.rows, "tickets.target_manager_id supprimée").toHaveLength(0);
    const idx = await harness.query(
      `SELECT indexname FROM pg_indexes WHERE indexname='tickets_target_manager_id_idx'`
    );
    expect(idx.rows, "index supprimé").toHaveLength(0);
  });

  it("MODEL-DB-B: réapplication up après down → colonnes + FK + index de retour (réversible)", async () => {
    await runMigrationFile(harness, UP_FILE);
    const userCols = await harness.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema='public' AND table_name='users'
          AND column_name IN ('is_relationship_manager','display_name','photo_url')`
    );
    expect(userCols.rows).toHaveLength(3);
    const tgt = await harness.query(
      `SELECT is_nullable FROM information_schema.columns
        WHERE table_schema='public' AND table_name='tickets' AND column_name='target_manager_id'`
    );
    expect(tgt.rows[0]?.is_nullable).toBe("YES");
    const idx = await harness.query(
      `SELECT indexname FROM pg_indexes WHERE indexname='tickets_target_manager_id_idx'`
    );
    expect(idx.rows).toHaveLength(1);
  });
});
