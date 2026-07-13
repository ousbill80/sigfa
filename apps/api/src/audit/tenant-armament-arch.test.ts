/**
 * Test d'ARCHITECTURE — armement tenant obligatoire (SEC-002, ferme SEC-F3-02).
 *
 * INTERDIT tout accès DB métier hors d'un chemin d'armement sanctionné :
 *   - `withArmedTenant` / `withArmedTenantFromPool` (contexte RLS `app.current_bank_id`) ;
 *   - `withPlatform` (connexion plateforme explicitement listée, SUPER_ADMIN).
 *
 * Le test énumère DYNAMIQUEMENT tous les fichiers de routes (`apps/api/src/routes`)
 * touchant la connexion `c.get("db")` et exige que CHACUN soit CLASSIFIÉ dans
 * l'inventaire ci-dessous. Un nouveau fichier de route qui accède à la DB sans être
 * classifié → CE TEST ÉCHOUE (pas de couverture manuelle qui se périme silencieusement).
 *
 * ÉTAT DU RECÂBLAGE (SEC-F3-02) — honnêteté d'inventaire :
 * Le primitif `withArmedTenant` est LIVRÉ et prouvé sur PG réelle (sigfa_app), et
 * compose avec SEC-001 (`withAudit` savepoint). La BASCULE de production consistant à
 * router CHAQUE requête HTTP tenant à travers une connexion armée (pool + middleware)
 * est un recâblage transverse volumineux (27 fichiers, 624 sites `db.query`, +
 * migration de tous les harnais de test vers le rôle `sigfa_app`). Il est SÉQUENCÉ via
 * `ARMED_CUTOVER_PENDING`. Ce test verrouille l'inventaire : il empêche toute NOUVELLE
 * route non-armée d'entrer sans décision explicite, et se resserre à mesure que les
 * fichiers migrent de `ARMED_CUTOVER_PENDING` vers `ARMED` (liste vide = dette fermée).
 *
 * @module
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROUTES_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "routes");

/**
 * Routes n'accédant PAS à une table tenant `bank_id` : connexion plateforme
 * (SUPER_ADMIN, `withPlatform`) ou aucune donnée tenant. Elles n'ont pas à armer
 * `app.current_bank_id`. Classées explicitement (défense-en-profondeur documentée).
 */
const PLATFORM_OR_PUBLIC: readonly string[] = [
  "health.ts", // GET /health — public, checks infra, aucune table tenant.
  "audit-logs.ts", // GET /audit-logs — AUDITOR/SUPER_ADMIN, connexion plateforme (cross-banques).
  "auth.ts", // /auth/* — résolution d'identité pré-tenant (login/refresh), avant contexte.
];

/**
 * Routes tenant DONT LA BASCULE VERS `withArmedTenant` RESTE À FAIRE (dette
 * SEC-F3-02 séquencée). Aujourd'hui isolées par `WHERE bank_id` applicatif +
 * middleware RBAC ; à router à travers la connexion armée lors de la bascule
 * middleware/pool. RETIRER un fichier de cette liste quand il est effectivement armé.
 *
 * Cet inventaire EST le plan de recâblage : sa décroissance mesure la fermeture de
 * SEC-F3-02. Toute route tenant hors de cette liste ET hors `PLATFORM_OR_PUBLIC`
 * DOIT être armée (sinon le test échoue).
 */
const ARMED_CUTOVER_PENDING: readonly string[] = [
  "agencies.ts",
  "agents-import.ts",
  "agents.ts",
  "banks.ts",
  "counters.ts",
  "data-privacy.ts",
  "devices.ts",
  "hours.ts",
  "kiosk-session.ts",
  "kiosks-status.ts",
  "onboarding.ts",
  "operations.ts",
  "public-tickets.ts",
  "queues.ts",
  "reports.ts",
  "services.ts",
  "sms-templates.ts",
  "theme.ts",
  "thresholds.ts",
  "tickets-sync.ts",
  "tickets.ts",
  "tv-session.ts",
  "webhooks-notifications.ts",
  "webhooks-whatsapp-inbound.ts",
];

/**
 * Routes DÉJÀ armées (routent leur accès DB via `withArmedTenant`). Vide au moment
 * de la livraison du primitif ; se remplit à mesure de la bascule. Quand
 * `ARMED_CUTOVER_PENDING` est vide, la dette SEC-F3-02 est fermée.
 */
const ARMED: readonly string[] = [];

/** Liste les fichiers de routes source (hors tests et harnais). */
function listRouteSourceFiles(): string[] {
  return readdirSync(ROUTES_DIR).filter(
    (name) =>
      name.endsWith(".ts") &&
      !name.endsWith(".test.ts") &&
      !name.includes(".harness.") &&
      name !== "admin-test-harness.ts"
  );
}

/** Vrai si le fichier accède à la connexion DB de requête (`c.get("db")`). */
function touchesDb(file: string): boolean {
  const src = readFileSync(join(ROUTES_DIR, file), "utf8");
  return src.includes('c.get("db")');
}

describe("SEC-002: architecture — armement tenant obligatoire (SEC-F3-02)", () => {
  it("SEC-002: le primitif d'armement withArmedTenant est exporté (source unique d'armement)", async () => {
    const armed = await import("src/lib/armed-tenant.js");
    expect(typeof armed.withArmedTenant).toBe("function");
    expect(typeof armed.withArmedTenantFromPool).toBe("function");
    expect(typeof armed.isCanonicalUuid).toBe("function");
  });

  it("SEC-002: TOUT fichier de route accédant à la DB est CLASSIFIÉ (armé / pending / plateforme) — nouveau fichier non classé → échec", () => {
    const classified = new Set<string>([
      ...ARMED,
      ...ARMED_CUTOVER_PENDING,
      ...PLATFORM_OR_PUBLIC,
    ]);
    const dbTouchingFiles = listRouteSourceFiles().filter(touchesDb);

    const unclassified = dbTouchingFiles.filter((f) => !classified.has(f));
    expect(
      unclassified,
      `Fichiers de route accédant à la DB sans classification d'armement : ` +
        `${unclassified.join(", ")}. Ajoutez-les à ARMED (si armés via withArmedTenant), ` +
        `à ARMED_CUTOVER_PENDING (bascule à venir), ou à PLATFORM_OR_PUBLIC (hors tenant).`
    ).toEqual([]);
  });

  it("SEC-002: l'inventaire ne référence AUCUN fichier fantôme (les 3 listes pointent des fichiers existants)", () => {
    const existing = new Set(listRouteSourceFiles());
    const referenced = [...ARMED, ...ARMED_CUTOVER_PENDING, ...PLATFORM_OR_PUBLIC];
    const phantom = referenced.filter((f) => !existing.has(f));
    expect(
      phantom,
      `Fichiers référencés dans l'inventaire mais introuvables : ${phantom.join(", ")}`
    ).toEqual([]);
  });

  it("SEC-002: un fichier ARMÉ n'est jamais aussi PENDING (classification unique, pas d'ambiguïté)", () => {
    const pending = new Set(ARMED_CUTOVER_PENDING);
    const both = ARMED.filter((f) => pending.has(f));
    expect(both, `Fichiers à la fois ARMED et PENDING : ${both.join(", ")}`).toEqual(
      []
    );
  });

  it("SEC-002: un fichier ARMÉ route bien son accès DB via withArmedTenant (grep) — verrou anti-régression de la bascule", () => {
    for (const file of ARMED) {
      const src = readFileSync(join(ROUTES_DIR, file), "utf8");
      expect(
        /withArmedTenant/.test(src),
        `${file} est classé ARMED mais n'appelle pas withArmedTenant`
      ).toBe(true);
    }
  });
});
