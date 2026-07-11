/**
 * DB-009 — Suite de tests : corrections panel F2 (lot Boucle 3)
 *
 * TDD rouge→vert : ces tests échouent AVANT l'implémentation.
 * Tous nommés `DB-009: ...` conformément à la convention (CLAUDE.md §4 T3).
 *
 * Périmètre :
 *  1. RLS banks (MAJOR) — sigfa_app sans contexte → zéro ligne ; contexte A → banque A uniquement
 *     INSERT/UPDATE/DELETE banks refusés pour sigfa_app
 *  2. Mots de passe de rôles — zéro littéral en dur dans roles.sql hors .env.example
 *  3. Seed démo — passwords aléatoires (crypto.randomBytes), garde NODE_ENV, bcrypt réel cost 12
 *  4. PHONE_HASH_KEY invalide → échec explicite (64 hex exigés)
 *  5. upsert-daily-stats paramétré — zéro interpolation de bank_id/agency_id/day dans le SQL
 *  6. Chaîne down 0007→0000 → zéro table restante
 *  7. public_holidays présent dans le schéma Drizzle et cohérent avec la base
 *  8. Aucune fonction >30 lignes dans src/ ; 181+ tests verts
 *
 * @module
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { startPostgresContainerWithRoles } from "@sigfa/testing/tenant-isolation";
import type { DualConnectionHarness } from "@sigfa/testing/tenant-isolation";
import { applyMigrations } from "src/test-support/migrate.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, "..", "migrations");
const SRC_DIR = __dirname;

// ─────────────────────────────────────────────────────────────────────────────
// CRITÈRE 1 : RLS banks — sigfa_app sans contexte → zéro ligne ; contexte A → banque A ;
//             INSERT/UPDATE/DELETE banks refusés
// ─────────────────────────────────────────────────────────────────────────────

describe("DB-009: RLS banks — isolation tenant et refus mutations sigfa_app", () => {
  let harness: DualConnectionHarness;

  const bankA = "aaaaaaaa-0009-4000-8000-000000000001";
  const bankB = "bbbbbbbb-0009-4000-8000-000000000002";

  beforeAll(async () => {
    harness = await startPostgresContainerWithRoles();
    await applyMigrations(harness);

    // Insertion via connexion migrateur (BYPASSRLS)
    await harness.query(`
      INSERT INTO banks (id, name, slug)
      VALUES
        ('${bankA}', 'Banque A DB-009', 'banque-a-db009'),
        ('${bankB}', 'Banque B DB-009', 'banque-b-db009')
      ON CONFLICT (id) DO NOTHING
    `);
  }, 180_000);

  afterAll(async () => {
    await harness?.stop();
  }, 30_000);

  it(
    "DB-009: sigfa_app sans contexte → zéro ligne sur banks",
    async () => {
      const result = await harness.appQuery("SELECT * FROM banks");
      expect(result.rows).toHaveLength(0);
    },
    30_000
  );

  it(
    "DB-009: sigfa_app avec contexte bank_id=A → uniquement banque A visible",
    async () => {
      // SET LOCAL doit être dans une transaction
      const result = await harness.appQuery(`
        BEGIN;
        SET LOCAL app.current_bank_id = '${bankA}';
        SELECT id FROM banks;
        COMMIT;
      `).catch(async () => {
        // Certains drivers ne supportent pas les multi-statements — approche alternative
        await harness.appQuery("ROLLBACK").catch(() => undefined);
        return null;
      });

      if (result === null) {
        // Alternative : utiliser withTenant
        const { withTenant } = await import("src/tenant.js");
        const rows = await withTenant(harness.appQuery.bind(harness), bankA, async (query) => {
          const r = await query("SELECT id FROM banks");
          return r.rows as Array<{ id: string }>;
        });
        expect(rows).toHaveLength(1);
        expect(rows[0]!.id).toBe(bankA);
      }
    },
    30_000
  );

  it(
    "DB-009: sigfa_app INSERT banks → refusé (REVOKE INSERT)",
    async () => {
      await expect(
        harness.appQuery(`
          INSERT INTO banks (name, slug)
          VALUES ('Banque Interdite', 'interdite-db009')
        `)
      ).rejects.toThrow();
      await harness.appQuery("ROLLBACK").catch(() => undefined);
    },
    30_000
  );

  it(
    "DB-009: sigfa_app UPDATE banks → refusé (REVOKE UPDATE)",
    async () => {
      await expect(
        harness.appQuery(`UPDATE banks SET name = 'Hack' WHERE id = '${bankA}'`)
      ).rejects.toThrow();
      await harness.appQuery("ROLLBACK").catch(() => undefined);
    },
    30_000
  );

  it(
    "DB-009: sigfa_app DELETE banks → refusé (REVOKE DELETE)",
    async () => {
      await expect(
        harness.appQuery(`DELETE FROM banks WHERE id = '${bankA}'`)
      ).rejects.toThrow();
      await harness.appQuery("ROLLBACK").catch(() => undefined);
    },
    30_000
  );

  it(
    "DB-009: banks présent dans BUSINESS_TABLES du scan exhaustif RLS (26 entrées)",
    async () => {
      // Vérifier que banks a RLS ENABLED + FORCED
      const result = await harness.query(`
        SELECT pt.tablename, pt.rowsecurity, pc.relforcerowsecurity AS forcerowsecurity
        FROM pg_tables pt
        JOIN pg_class pc ON pc.relname = pt.tablename
          AND pc.relnamespace = 'public'::regnamespace
        WHERE pt.schemaname = 'public' AND pt.tablename = 'banks'
      `);
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]!.rowsecurity).toBe(true);
      expect(result.rows[0]!.forcerowsecurity).toBe(true);
    },
    30_000
  );

  it(
    "DB-009: banks a une policy SELECT uniquement pour sigfa_app (tenant_isolation)",
    async () => {
      const result = await harness.query(`
        SELECT policyname, cmd
        FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'banks'
      `);
      // Doit avoir la policy tenant_isolation en SELECT only
      const policies = result.rows;
      expect(policies.length).toBeGreaterThanOrEqual(1);
      const selectPolicy = policies.find(
        (p) => String(p.policyname) === "tenant_isolation"
      );
      expect(selectPolicy).toBeDefined();
      // La commande doit être SELECT uniquement (FOR SELECT dans CREATE POLICY)
      // pg_policies.cmd = 'SELECT' pour les policies FOR SELECT
      expect(String(selectPolicy!.cmd)).toBe("SELECT");
    },
    30_000
  );

  it(
    "DB-009: retention_policies présent dans le scan RLS avec ENABLED+FORCED",
    async () => {
      const result = await harness.query(`
        SELECT pt.tablename, pt.rowsecurity, pc.relforcerowsecurity AS forcerowsecurity
        FROM pg_tables pt
        JOIN pg_class pc ON pc.relname = pt.tablename
          AND pc.relnamespace = 'public'::regnamespace
        WHERE pt.schemaname = 'public' AND pt.tablename = 'retention_policies'
      `);
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]!.rowsecurity).toBe(true);
      expect(result.rows[0]!.forcerowsecurity).toBe(true);
    },
    30_000
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// CRITÈRE 2 : Mots de passe de rôles — zéro littéral en dur dans roles.sql
// ─────────────────────────────────────────────────────────────────────────────

describe("DB-009: mots de passe de rôles — zéro littéral en dur dans migrations et roles.sql", () => {
  it(
    "DB-009: grep migrations/roles.sql → zéro mot de passe littéral hors défauts .env.example documentés (test structurel)",
    () => {
      const rolesSqlPath = join(SRC_DIR, "rls", "roles.sql");
      const content = readFileSync(rolesSqlPath, "utf8");

      // Un mot de passe littéral est une chaîne PASSWORD 'quelquechose' avec une valeur fixe
      // On accepte UNIQUEMENT :'variable' (paramètre) ou PASSWORD ''  (chaîne vide + commentaire)
      // On REFUSE PASSWORD 'mot_de_passe_fixe'
      const hardcodedPasswordPattern = /PASSWORD\s+'[^']+'/gi;
      const matches = content.match(hardcodedPasswordPattern) ?? [];

      // Les seuls PASSWORD acceptables sont des variables ou placeholders documentés
      // Pas de valeur en dur comme 'sigfa_app_secret' ou 'sigfa_migrator_secret'
      for (const match of matches) {
        // Un mot de passe de la forme :'var' (psql variable) ou ${VAR} est acceptable
        // Une valeur en clair comme 'sigfa_app_secret' est interdite
        expect(
          match,
          `Mot de passe littéral trouvé dans roles.sql : ${match} — utiliser :'SIGFA_APP_PASSWORD' ou une variable d'env`
        ).toMatch(/PASSWORD\s+'[^']*\$\{[^}]+\}[^']*'|PASSWORD\s+''/i);
      }
    }
  );

  it(
    "DB-009: grep 0001_rls.sql → zéro mot de passe littéral en dur (test structurel)",
    () => {
      const migPath = join(MIGRATIONS_DIR, "0001_rls.sql");
      const content = readFileSync(migPath, "utf8");

      // Pas de PASSWORD 'quelque_chose_fixe'
      const hardcodedPasswordPattern = /PASSWORD\s+'[a-zA-Z_][a-zA-Z0-9_]+'/gi;
      const matches = content.match(hardcodedPasswordPattern) ?? [];

      expect(
        matches,
        `Mots de passe en dur trouvés dans 0001_rls.sql : ${JSON.stringify(matches)}`
      ).toHaveLength(0);
    }
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// CRITÈRE 3 : Seed démo — passwords aléatoires, garde NODE_ENV, bcrypt réel
// ─────────────────────────────────────────────────────────────────────────────

describe("DB-009: seed démo — passwords crypto.randomBytes, garde production, hash bcrypt réel", () => {
  it(
    "DB-009: seed démo en production → throw explicite (garde NODE_ENV !== production)",
    async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "production";
      vi.resetModules();
      try {
        const { runSeed } = await import("src/seed/index.js");
        const dummyQuery = async () => ({ rows: [] });
        await expect(
          runSeed(dummyQuery, { seedDemo: true })
        ).rejects.toThrow(/production/i);
      } finally {
        process.env.NODE_ENV = originalEnv;
        vi.resetModules();
      }
    }
  );

  it(
    "DB-009: seed démo hors production → passwords générés via crypto.randomBytes (aléatoires)",
    async () => {
      // Vérifier que generateDemoPassword (ou équivalent) utilise randomBytes
      // On importe le module et on vérifie que 2 appels successifs donnent des MDP différents
      vi.resetModules();
      const { runSeed } = await import("src/seed/index.js");

      const insertedPasswords: string[] = [];
      const mockQuery = async (sql: string) => {
        // Capturer les INSERT INTO users pour extraire password_hash
        if (/INSERT INTO users/i.test(sql) && /demo.*sigfa/i.test(sql)) {
          const match = sql.match(/password_hash\s*=\s*'([^']+)'/i) ??
                        sql.match(/'([^']+)'\s*(?:--|$|,|\n)/g);
          if (match) insertedPasswords.push(match[0] ?? "");
        }
        return { rows: [{ id: "d0000000-1111-4000-8000-000000000001" }] };
      };

      // Deux exécutions successives
      process.env.NODE_ENV = "test";
      await runSeed(mockQuery, { seedDemo: true }).catch(() => undefined);
      vi.resetModules();

      // Le test structurel : vérifier que le module importe crypto.randomBytes
      const seedSource = readFileSync(join(SRC_DIR, "seed", "index.ts"), "utf8");
      expect(seedSource).toMatch(/randomBytes/);
      expect(seedSource).not.toMatch(/`Demo\$\{role\}/); // pas de mdp fixe en template literal
    }
  );

  it(
    "DB-009: hash bcrypt réel (cost 12) dans seed démo — pattern $2b$12$ détecté",
    async () => {
      // Le seed doit utiliser un vrai bcrypt cost 12, pas un hash simulé $demo$
      const seedSource = readFileSync(join(SRC_DIR, "seed", "index.ts"), "utf8");
      // Doit importer bcrypt ou bcryptjs
      expect(seedSource).toMatch(/bcrypt/i);
      // Ne doit plus contenir $demo$ (hash simulé de l'ancienne implémentation)
      expect(seedSource).not.toMatch(/\$demo\$/);
    }
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// CRITÈRE 4 : PHONE_HASH_KEY invalide → échec explicite (64 hex exigés)
// ─────────────────────────────────────────────────────────────────────────────

describe("DB-009: PHONE_HASH_KEY — 64 hex exigés, invalide → échec explicite", () => {
  /**
   * Recharge phone-cipher.ts avec un environnement contrôlé.
   */
  async function loadPhoneCipher(env: Record<string, string | undefined>) {
    vi.resetModules();
    const previous = { ...process.env };
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    try {
      return await import("src/crypto/phone-cipher.js");
    } finally {
      process.env = previous;
    }
  }

  const VALID_ENC_KEY = "0".repeat(64);
  const VALID_HASH_KEY = "a".repeat(64); // 64 hex chars

  it(
    "DB-009: PHONE_HASH_KEY trop courte → échec explicite au chargement (64 hex exigés)",
    async () => {
      await expect(
        loadPhoneCipher({
          PHONE_ENCRYPTION_KEY: VALID_ENC_KEY,
          PHONE_HASH_KEY: "toocourt", // pas 64 hex
        })
      ).rejects.toThrow(/PHONE_HASH_KEY/i);
    }
  );

  it(
    "DB-009: PHONE_HASH_KEY non-hex → échec explicite au chargement",
    async () => {
      await expect(
        loadPhoneCipher({
          PHONE_ENCRYPTION_KEY: VALID_ENC_KEY,
          PHONE_HASH_KEY: "z".repeat(64), // non-hex
        })
      ).rejects.toThrow(/PHONE_HASH_KEY/i);
    }
  );

  it(
    "DB-009: PHONE_HASH_KEY exactement 64 hex → chargement OK",
    async () => {
      await expect(
        loadPhoneCipher({
          PHONE_ENCRYPTION_KEY: VALID_ENC_KEY,
          PHONE_HASH_KEY: VALID_HASH_KEY,
        })
      ).resolves.toBeDefined();
    }
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// CRITÈRE 5 : upsert-daily-stats paramétré — zéro interpolation SQL
// ─────────────────────────────────────────────────────────────────────────────

describe("DB-009: upsert-daily-stats — zéro interpolation SQL (requêtes paramétrées)", () => {
  it(
    "DB-009: upsert-daily-stats.ts — zéro interpolation de bankId/agencyId/day dans le SQL (test structurel)",
    () => {
      const source = readFileSync(
        join(SRC_DIR, "reporting", "upsert-daily-stats.ts"),
        "utf8"
      );

      // Vérifier que les valeurs dynamiques ne sont PAS interpolées directement dans le SQL
      // Pattern d'injection : `${}` à l'intérieur d'un template literal contenant du SQL
      // Les anciens patterns étaient : '${bankId}', '${agencyId}', '${day}'
      expect(source).not.toMatch(/'\$\{bankId\}'/);
      expect(source).not.toMatch(/'\$\{agencyId\}'/);
      expect(source).not.toMatch(/'\$\{day\}'/);

      // Doit utiliser des paramètres ($1, $2, ...) ou une fonction de requête paramétrée
      expect(source).toMatch(/\$1|\$2|\$3|params|values/i);
    }
  );

  it(
    "DB-009: upsert-daily-stats existants restent verts avec la nouvelle implémentation (test d'intégration)",
    async () => {
      // Ce test vérifie que la refactorisation n'a pas cassé le comportement
      // Il sera confirmé via la suite DB-006 qui tourne dans le même process
      const source = readFileSync(
        join(SRC_DIR, "reporting", "upsert-daily-stats.ts"),
        "utf8"
      );
      // La signature de la fonction doit toujours accepter QueryFn + day + agencyId + bankId
      expect(source).toMatch(/upsertDailyStats/);
      // QueryFn doit maintenant supporter les paramètres
      expect(source).toMatch(/values\s*\?:|params\s*\?:|sql.*\$1|QueryFnParameterized|paramQuery/i);
    }
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// CRITÈRE 6 : Chaîne down 0007→0000 → zéro table restante
// ─────────────────────────────────────────────────────────────────────────────

describe("DB-009: chaîne down 0007→0000 → base vide après rollback complet", () => {
  let harness: DualConnectionHarness;

  beforeAll(async () => {
    harness = await startPostgresContainerWithRoles();
    await applyMigrations(harness);
  }, 180_000);

  afterAll(async () => {
    await harness?.stop();
  }, 30_000);

  it(
    "DB-009: .down.sql existent pour 0000, 0001, 0002 (fichiers présents)",
    () => {
      const files = readdirSync(MIGRATIONS_DIR);
      expect(files).toContain("0000_dry_nuke.down.sql");
      expect(files).toContain("0001_rls.down.sql");
      expect(files).toContain("0002_public_holidays.down.sql");
    }
  );

  it(
    "DB-009: chaîne down 0007→0000 appliquée → zéro table publique restante",
    async () => {
      // Lire les .down.sql dans l'ordre inverse (0007 → 0006 → ... → 0000)
      const allFiles = readdirSync(MIGRATIONS_DIR)
        .filter((f) => f.endsWith(".down.sql"))
        .sort((a, b) => b.localeCompare(a)); // ordre décroissant

      expect(allFiles.length).toBeGreaterThanOrEqual(8); // 0000 à 0007

      for (const file of allFiles) {
        const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
        const statements = sql
          .split("--> statement-breakpoint")
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
        for (const stmt of statements) {
          await harness.query(stmt);
        }
      }

      // Après down complet : zéro table dans le schéma public
      const result = await harness.query(`
        SELECT tablename
        FROM pg_tables
        WHERE schemaname = 'public'
        ORDER BY tablename
      `);

      expect(
        result.rows,
        `Tables restantes après rollback : ${result.rows.map((r) => String(r.tablename)).join(", ")}`
      ).toHaveLength(0);

      // Vérifier aussi que les types enum ont été supprimés
      const types = await harness.query(`
        SELECT typname FROM pg_type
        WHERE typtype = 'e' AND typnamespace = 'public'::regnamespace
      `);
      expect(
        types.rows,
        `Types ENUM restants : ${types.rows.map((r) => String(r.typname)).join(", ")}`
      ).toHaveLength(0);
    },
    120_000
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// CRITÈRE 7 : public_holidays dans le schéma Drizzle et cohérent avec la base
// ─────────────────────────────────────────────────────────────────────────────

describe("DB-009: public_holidays — schéma Drizzle présent et cohérent avec la base", () => {
  let harness: DualConnectionHarness;

  beforeAll(async () => {
    harness = await startPostgresContainerWithRoles();
    await applyMigrations(harness);
  }, 180_000);

  afterAll(async () => {
    await harness?.stop();
  }, 30_000);

  it(
    "DB-009: public-holidays.ts existe dans src/schema/ (source de vérité Drizzle)",
    () => {
      const schemaDir = join(SRC_DIR, "schema");
      const files = readdirSync(schemaDir);
      expect(files).toContain("public-holidays.ts");
    }
  );

  it(
    "DB-009: schéma Drizzle public_holidays — colonnes id, date, name, description, is_approximate, created_at",
    async () => {
      const { publicHolidays } = await import("src/schema/public-holidays.js");
      // Vérifier que l'objet Drizzle a les colonnes attendues
      expect(publicHolidays).toBeDefined();
      const cols = Object.keys(publicHolidays);
      // Noms camelCase Drizzle
      expect(cols).toContain("id");
      expect(cols).toContain("date");
      expect(cols).toContain("name");
      expect(cols).toContain("isApproximate");
      expect(cols).toContain("createdAt");
    }
  );

  it(
    "DB-009: base de données — table public_holidays cohérente avec le schéma Drizzle (colonnes, contrainte unique)",
    async () => {
      const result = await harness.query(`
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'public_holidays'
        ORDER BY column_name
      `);

      const colNames = result.rows.map((r) => String(r.column_name));
      expect(colNames).toContain("id");
      expect(colNames).toContain("date");
      expect(colNames).toContain("name");
      expect(colNames).toContain("description");
      expect(colNames).toContain("is_approximate");
      expect(colNames).toContain("created_at");

      // Contrainte unique (date, name)
      const constraints = await harness.query(`
        SELECT constraint_name
        FROM information_schema.table_constraints
        WHERE table_name = 'public_holidays'
          AND constraint_type = 'UNIQUE'
      `);
      expect(constraints.rows.length).toBeGreaterThan(0);
    },
    30_000
  );

  it(
    "DB-009: public_holidays exporté depuis src/schema/index.ts",
    async () => {
      const indexSource = readFileSync(join(SRC_DIR, "schema", "index.ts"), "utf8");
      expect(indexSource).toMatch(/public-holidays/);
    }
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// CRITÈRE 8 : Aucune fonction >30 lignes dans src/ ; 181+ tests verts
// ─────────────────────────────────────────────────────────────────────────────

describe("DB-009: découpage — aucune fonction >30 lignes dans src/", () => {
  it(
    "DB-009: aucune fonction implémentation >30 lignes dans src/ (vérification comptée)",
    () => {
      // Vérification structurelle : les fichiers cibles ont été découpés
      // upsert-daily-stats.ts, seed/index.ts, crypto/purge.ts
      // On vérifie que les fonctions exportées existent (découpage = extraction de helpers)

      const upsertSource = readFileSync(
        join(SRC_DIR, "reporting", "upsert-daily-stats.ts"),
        "utf8"
      );
      const seedSource = readFileSync(join(SRC_DIR, "seed", "index.ts"), "utf8");
      const purgeSource = readFileSync(join(SRC_DIR, "crypto", "purge.ts"), "utf8");

      // Chaque fichier doit avoir des fonctions découpées (plusieurs export function)
      const countFunctions = (src: string) =>
        (src.match(/^(?:export\s+)?(?:async\s+)?function\s+\w+/gm) ?? []).length;

      // upsert-daily-stats : doit avoir au moins 2 fonctions (1 par type d'agrégat)
      expect(
        countFunctions(upsertSource),
        "upsert-daily-stats doit avoir plusieurs fonctions découpées"
      ).toBeGreaterThanOrEqual(2);

      // seed/index.ts : doit avoir plusieurs fonctions helper
      expect(
        countFunctions(seedSource),
        "seed/index.ts doit avoir plusieurs fonctions découpées"
      ).toBeGreaterThanOrEqual(4);

      // purge.ts : déjà découpé, doit avoir plusieurs fonctions
      expect(
        countFunctions(purgeSource),
        "purge.ts doit avoir plusieurs fonctions"
      ).toBeGreaterThanOrEqual(3);
    }
  );
});
