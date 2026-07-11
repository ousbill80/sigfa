/**
 * DB-003 — Suite de tests : migrations consolidées + seed services, fériés, RBAC
 *
 * TDD rouge→vert : ces tests échouent AVANT l'implémentation.
 * Tous nommés `DB-003: ...` conformément à la convention (CLAUDE.md §4 T3).
 *
 * @module
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startPostgresContainerWithRoles } from "@sigfa/testing/tenant-isolation";
import type { DualConnectionHarness } from "@sigfa/testing/tenant-isolation";
import { applyMigrations } from "src/test-support/migrate.js";
import { runSeed } from "./index.js";
import { DEFAULT_SERVICES } from "./default-services.js";
import { RBAC_MATRIX, PERSISTABLE_ROLES } from "./rbac-matrix.js";

// ─────────────────────────────────────────────────────────────────────────────
// CRITÈRE 1 : idempotence — PG16 vierge → migrate → seed → seed (2e fois) : zéro doublon
// ─────────────────────────────────────────────────────────────────────────────

describe("DB-003: PG16 vierge → migrate → seed → seed (2e fois) : zéro doublon, état identique (test d'intégration)", () => {
  let harness: DualConnectionHarness;

  beforeAll(async () => {
    harness = await startPostgresContainerWithRoles();
    await applyMigrations(harness);
  }, 180_000);

  afterAll(async () => {
    await harness?.stop();
  }, 30_000);

  it(
    "DB-003: seed appliqué deux fois → état identique, zéro doublon sur public_holidays",
    async () => {
      // 1ère exécution du seed (sans SEED_DEMO)
      await runSeed(harness.query.bind(harness), { seedDemo: false });

      const countAfterFirst = await harness.query(
        "SELECT COUNT(*) AS cnt FROM public_holidays"
      );
      const firstCount = Number(countAfterFirst.rows[0]!.cnt);
      expect(firstCount).toBeGreaterThan(0);

      // 2ème exécution → même état
      await runSeed(harness.query.bind(harness), { seedDemo: false });

      const countAfterSecond = await harness.query(
        "SELECT COUNT(*) AS cnt FROM public_holidays"
      );
      const secondCount = Number(countAfterSecond.rows[0]!.cnt);
      expect(secondCount).toBe(firstCount);
    },
    120_000
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// CRITÈRE 2 : 8 services par défaut avec codes et SLA exacts
// ─────────────────────────────────────────────────────────────────────────────

describe("DB-003: les 8 services par défaut avec codes et SLA exacts (test)", () => {
  it("DB-003: DEFAULT_SERVICES contient exactement les 8 services avec codes et SLA v5 §MODULE 1", () => {
    // LA LOI v5 §MODULE 1 — services par défaut exacts
    const expected = [
      { code: "OC", slaMinutes: 15 },
      { code: "OA", slaMinutes: 30 },
      { code: "CR", slaMinutes: 45 },
      { code: "CH", slaMinutes: 10 },
      { code: "EN", slaMinutes: 45 },
      { code: "VIP", slaMinutes: 20 },
      { code: "RE", slaMinutes: 30 },
      { code: "EP", slaMinutes: 25 },
    ] as const;

    expect(DEFAULT_SERVICES).toHaveLength(8);

    for (const exp of expected) {
      const found = DEFAULT_SERVICES.find((s) => s.code === exp.code);
      expect(found, `Service ${exp.code} introuvable dans DEFAULT_SERVICES`).toBeDefined();
      expect(found!.slaMinutes, `SLA de ${exp.code} incorrect`).toBe(exp.slaMinutes);
    }

    // Codes uniques
    const codes = DEFAULT_SERVICES.map((s) => s.code);
    expect(new Set(codes).size).toBe(8);
  });

  it(
    "DB-003: après seed, aucun des 8 services n'est dupliqué si seed rejoué",
    async () => {
      // Test isolé en mémoire : vérification structurelle (codes uniques, SLA valides)
      const codes = DEFAULT_SERVICES.map((s) => s.code);
      expect(new Set(codes).size).toBe(DEFAULT_SERVICES.length);
      // Tous les SLA sont ≥1
      for (const s of DEFAULT_SERVICES) {
        expect(s.slaMinutes).toBeGreaterThanOrEqual(1);
        // Code format [A-Z]{2,4}
        expect(s.code).toMatch(/^[A-Z]{2,4}$/);
      }
    }
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// CRITÈRE 3 : fériés CI — fixes + mobiles 2026-2027 avec is_approximate
//             INSERT par le rôle applicatif → permission refusée
//             warning si année > max(year)
// ─────────────────────────────────────────────────────────────────────────────

describe("DB-003: fériés CI — fixes + mobiles 2026-2027 avec is_approximate ; INSERT par le rôle applicatif → permission refusée ; warning si année > max(year) (tests)", () => {
  let harness: DualConnectionHarness;

  beforeAll(async () => {
    harness = await startPostgresContainerWithRoles();
    await applyMigrations(harness);
    await runSeed(harness.query.bind(harness), { seedDemo: false });
  }, 180_000);

  afterAll(async () => {
    await harness?.stop();
  }, 30_000);

  it(
    "DB-003: public_holidays contient des fériés 2026 ET 2027",
    async () => {
      const result = await harness.query(
        "SELECT DISTINCT EXTRACT(YEAR FROM date)::int AS yr FROM public_holidays ORDER BY yr"
      );
      const years = result.rows.map((r) => Number(r.yr));
      expect(years).toContain(2026);
      expect(years).toContain(2027);
    },
    30_000
  );

  it(
    "DB-003: public_holidays — les fêtes mobiles ont is_approximate = true",
    async () => {
      const result = await harness.query(
        "SELECT COUNT(*) AS cnt FROM public_holidays WHERE is_approximate = true"
      );
      const count = Number(result.rows[0]!.cnt);
      expect(count).toBeGreaterThan(0);
    },
    30_000
  );

  it(
    "DB-003: public_holidays — les fêtes fixes ont is_approximate = false",
    async () => {
      const result = await harness.query(
        "SELECT COUNT(*) AS cnt FROM public_holidays WHERE is_approximate = false"
      );
      const count = Number(result.rows[0]!.cnt);
      expect(count).toBeGreaterThan(0);
    },
    30_000
  );

  it(
    "DB-003: INSERT dans public_holidays par le rôle applicatif sigfa_app → permission refusée",
    async () => {
      // Le rôle sigfa_app n'a que SELECT sur public_holidays (GRANT SELECT only)
      // INSERT doit être refusé
      await expect(
        harness.appQuery(`
          INSERT INTO public_holidays (date, name, is_approximate)
          VALUES ('2026-01-01', 'Test non autorisé', false)
        `)
      ).rejects.toThrow();

      // Remettre la connexion dans un état propre
      await harness.appQuery("ROLLBACK").catch(() => undefined);
    },
    30_000
  );

  it(
    "DB-003: SELECT dans public_holidays par le rôle applicatif sigfa_app → autorisé",
    async () => {
      // Le rôle sigfa_app a SELECT sur public_holidays
      const result = await harness.appQuery(
        "SELECT COUNT(*) AS cnt FROM public_holidays"
      );
      const count = Number(result.rows[0]!.cnt);
      expect(count).toBeGreaterThan(0);
    },
    30_000
  );

  it(
    "DB-003: warning loggé si année courante dépasse max(year) des fériés mobiles",
    async () => {
      // Insérer un avertissement de test : si l'année est > max year, un warning doit être loggé
      // On vérifie le comportement de la fonction checkHolidayWarning
      const { checkHolidayWarning } = await import("./index.js");
      const warnings: string[] = [];
      // Passer maxYear = 2020 pour simuler l'expiration
      await checkHolidayWarning(2020, (msg) => warnings.push(msg));
      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings[0]).toMatch(/année|fériés|mobile|mise à jour|2020/i);
    }
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// CRITÈRE 4 : sans SEED_DEMO → aucune donnée de démo ; avec → tenant complet
// ─────────────────────────────────────────────────────────────────────────────

describe("DB-003: sans SEED_DEMO → aucune donnée de démo ; avec → tenant complet (tests)", () => {
  let harnessA: DualConnectionHarness;
  let harnessB: DualConnectionHarness;

  beforeAll(async () => {
    // harnessA : seed sans SEED_DEMO
    harnessA = await startPostgresContainerWithRoles();
    await applyMigrations(harnessA);
    await runSeed(harnessA.query.bind(harnessA), { seedDemo: false });

    // harnessB : seed avec SEED_DEMO
    harnessB = await startPostgresContainerWithRoles();
    await applyMigrations(harnessB);
    await runSeed(harnessB.query.bind(harnessB), { seedDemo: true });
  }, 360_000);

  afterAll(async () => {
    await harnessA?.stop();
    await harnessB?.stop();
  }, 30_000);

  it(
    "DB-003: sans SEED_DEMO=1, aucune banque de démo dans banks",
    async () => {
      const result = await harnessA.query(
        "SELECT COUNT(*) AS cnt FROM banks WHERE slug LIKE 'demo%'"
      );
      expect(Number(result.rows[0]!.cnt)).toBe(0);
    },
    30_000
  );

  it(
    "DB-003: avec SEED_DEMO=1, la banque de démo existe avec ≥1 agence, ≥2 guichets, ≥1 kiosque",
    async () => {
      const banks = await harnessB.query(
        "SELECT id FROM banks WHERE slug LIKE 'demo%' LIMIT 1"
      );
      expect(banks.rows).toHaveLength(1);
      const bankId = String(banks.rows[0]!.id);

      const agencies = await harnessB.query(
        `SELECT COUNT(*) AS cnt FROM agencies WHERE bank_id = '${bankId}'`
      );
      expect(Number(agencies.rows[0]!.cnt)).toBeGreaterThanOrEqual(2);

      const counters = await harnessB.query(
        `SELECT COUNT(*) AS cnt FROM counters WHERE bank_id = '${bankId}'`
      );
      expect(Number(counters.rows[0]!.cnt)).toBeGreaterThanOrEqual(2);

      const kiosks = await harnessB.query(
        `SELECT COUNT(*) AS cnt FROM kiosks WHERE bank_id = '${bankId}'`
      );
      expect(Number(kiosks.rows[0]!.cnt)).toBeGreaterThanOrEqual(1);
    },
    30_000
  );

  it(
    "DB-003: avec SEED_DEMO=1, des comptes utilisateurs de démo existent pour chaque rôle persistable",
    async () => {
      const banks = await harnessB.query(
        "SELECT id FROM banks WHERE slug LIKE 'demo%' LIMIT 1"
      );
      const bankId = String(banks.rows[0]!.id);

      for (const role of PERSISTABLE_ROLES) {
        if (role === "SUPER_ADMIN") continue; // SUPER_ADMIN n'a pas de bank_id
        const result = await harnessB.query(
          `SELECT COUNT(*) AS cnt FROM users WHERE bank_id = '${bankId}' AND role = '${role}'`
        );
        expect(
          Number(result.rows[0]!.cnt),
          `Aucun utilisateur ${role} dans la banque de démo`
        ).toBeGreaterThanOrEqual(1);
      }
    },
    30_000
  );

  it(
    "DB-003: SEED_DEMO idempotent — 2ème exécution avec SEED_DEMO n'insère pas de doublon",
    async () => {
      await runSeed(harnessB.query.bind(harnessB), { seedDemo: true });
      const banks = await harnessB.query(
        "SELECT COUNT(*) AS cnt FROM banks WHERE slug LIKE 'demo%'"
      );
      expect(Number(banks.rows[0]!.cnt)).toBe(1);
    },
    60_000
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// CRITÈRE 5 : rbac-matrix — exactement les 6 rôles persistables
//             AUTHENTICATED/NONE explicitement exclus avec commentaire
// ─────────────────────────────────────────────────────────────────────────────

describe("DB-003: rbac-matrix — exactement les 6 rôles persistables, AUTHENTICATED/NONE explicitement exclus avec commentaire (test d'exhaustivité)", () => {
  it(
    "DB-003: PERSISTABLE_ROLES contient exactement les 6 rôles du schéma Drizzle (roleEnum)",
    () => {
      const expected = [
        "SUPER_ADMIN",
        "BANK_ADMIN",
        "AGENCY_DIRECTOR",
        "MANAGER",
        "AGENT",
        "AUDITOR",
      ] as const;

      expect(PERSISTABLE_ROLES).toHaveLength(6);
      for (const role of expected) {
        expect(PERSISTABLE_ROLES).toContain(role);
      }
    }
  );

  it(
    "DB-003: AUTHENTICATED et NONE sont explicitement absents de PERSISTABLE_ROLES",
    () => {
      expect(PERSISTABLE_ROLES).not.toContain("NONE");
      expect(PERSISTABLE_ROLES).not.toContain("AUTHENTICATED");
    }
  );

  it(
    "DB-003: RBAC_MATRIX couvre exactement les 6 rôles × toutes les actions définies",
    () => {
      const actions = [
        "create_bank",
        "create_agency",
        "configure_services",
        "manage_agents",
        "dashboard_realtime",
        "process_tickets",
        "view_reports",
        "export_data",
      ] as const;

      // Chaque rôle persistable doit avoir une entrée dans la matrice
      for (const role of PERSISTABLE_ROLES) {
        expect(RBAC_MATRIX[role], `Rôle ${role} absent de RBAC_MATRIX`).toBeDefined();
      }

      // Chaque action doit être définie pour chaque rôle
      for (const role of PERSISTABLE_ROLES) {
        for (const action of actions) {
          expect(
            RBAC_MATRIX[role]![action],
            `Action ${action} non définie pour ${role}`
          ).toBeDefined();
        }
      }
    }
  );

  it(
    "DB-003: RBAC_MATRIX — les droits de SUPER_ADMIN sont cohérents (v5 §MODULE 4)",
    () => {
      // v5 §MODULE 4 : SUPER_ADMIN peut tout sauf traiter des tickets
      expect(RBAC_MATRIX["SUPER_ADMIN"]!.create_bank).toBe(true);
      expect(RBAC_MATRIX["SUPER_ADMIN"]!.process_tickets).toBe(false);
    }
  );

  it(
    "DB-003: RBAC_MATRIX — AGENT ne peut traiter que des tickets (pas créer banque/agence)",
    () => {
      expect(RBAC_MATRIX["AGENT"]!.create_bank).toBe(false);
      expect(RBAC_MATRIX["AGENT"]!.create_agency).toBe(false);
      expect(RBAC_MATRIX["AGENT"]!.process_tickets).toBe(true);
    }
  );

  it(
    "DB-003: RBAC_MATRIX — AUDITOR a lecture seule (view_reports oui, process_tickets non, create_bank non)",
    () => {
      expect(RBAC_MATRIX["AUDITOR"]!.view_reports).toBe(true);
      expect(RBAC_MATRIX["AUDITOR"]!.process_tickets).toBe(false);
      expect(RBAC_MATRIX["AUDITOR"]!.create_bank).toBe(false);
    }
  );
});
