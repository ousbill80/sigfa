/**
 * Seed SIGFA — DB-003 / DB-009
 *
 * Exécutable : `pnpm --filter @sigfa/database seed`
 *
 * ## Périmètre
 * 1. Jours fériés ivoiriens (table `public_holidays`, hors-tenant) — via connexion migrateur
 * 2. Tenants de démonstration PARAMÉTRABLES — via connexion migrateur (BYPASSRLS)
 *    - Sélection : `SEED_TENANTS=demo,bicici` (slugs du registre `./tenants/`)
 *    - Rétro-compatibilité : `SEED_DEMO=1` ⇒ tenant `demo`
 *    - Moteur générique : `seedTenant(config)` (voir `./tenant-seed.ts`) —
 *      AUCUNE donnée de banque en dur hors des fichiers de config `./tenants/*.ts`
 *
 * ## DB-009 : Sécurité renforcée
 * - Mots de passe de seed générés via `crypto.randomBytes` (aléatoires, uniques par exécution)
 * - Hash bcrypt réel cost 12 (jamais de hash simulé)
 * - Garde `NODE_ENV !== 'production'` — le seed de tenant lève une erreur en production
 * - Affichage des mots de passe UNE SEULE FOIS à la console
 *
 * ## Idempotence
 * Tous les INSERT utilisent `ON CONFLICT DO NOTHING` (clés naturelles).
 * Le seed peut être rejoué sans effet de bord.
 *
 * ## Fêtes mobiles et avertissement
 * Les fêtes islamiques ont `is_approximate = true`.
 * Si l'année courante dépasse `max(year)` des fériés mobiles, un warning est loggé.
 * Story d'exploitation : voir `public-holidays-sources.md`.
 *
 * @module
 */

import { seedTenant, type QueryFn } from "./tenant-seed.js";
import { TENANT_SEED_CONFIGS } from "./tenants/index.js";

export type { QueryFn, TenantSeedConfig } from "./tenant-seed.js";
export { seedTenant } from "./tenant-seed.js";
export { TENANT_SEED_CONFIGS } from "./tenants/index.js";

/** Options du seed. */
export interface SeedOptions {
  /**
   * Rétro-compatibilité `SEED_DEMO=1` : seed le tenant `demo`.
   * NE PAS utiliser en production.
   */
  seedDemo?: boolean;
  /**
   * Slugs des tenants à seeder (`SEED_TENANTS=demo,bicici`).
   * Doivent exister dans le registre `TENANT_SEED_CONFIGS`.
   */
  tenants?: readonly string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Données : jours fériés ivoiriens 2026-2027
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fête fixe : date connue à l'avance, `is_approximate = false`.
 */
interface FixedHoliday {
  date: string;   // ISO 8601 "YYYY-MM-DD"
  name: string;
  description?: string;
  isApproximate: false;
}

/**
 * Fête mobile : date approximative (croissant de lune), `is_approximate = true`.
 */
interface MobileHoliday {
  date: string;   // ISO 8601 "YYYY-MM-DD" (approximation)
  name: string;
  description?: string;
  isApproximate: true;
}

type Holiday = FixedHoliday | MobileHoliday;

/**
 * Jours fériés ivoiriens 2026 — fêtes fixes.
 * Source : Décret n°65-50, art. L.242.1 Code du Travail CI.
 */
const FIXED_HOLIDAYS_2026: FixedHoliday[] = [
  { date: "2026-01-01", name: "Jour de l'An", isApproximate: false },
  { date: "2026-04-06", name: "Lundi de Pâques", description: "Calendrier grégorien 2026", isApproximate: false },
  { date: "2026-05-01", name: "Fête du Travail", isApproximate: false },
  { date: "2026-05-14", name: "Ascension", description: "39 jours après Pâques 2026", isApproximate: false },
  { date: "2026-05-25", name: "Lundi de Pentecôte", description: "49 jours après Pâques 2026", isApproximate: false },
  { date: "2026-08-07", name: "Fête Nationale", description: "Indépendance de la Côte d'Ivoire", isApproximate: false },
  { date: "2026-11-01", name: "Toussaint", isApproximate: false },
  { date: "2026-11-15", name: "Fête Nationale de la Paix", isApproximate: false },
  { date: "2026-12-25", name: "Noël", isApproximate: false },
];

/**
 * Jours fériés ivoiriens 2026 — fêtes mobiles islamiques.
 * Source : IslamicFinder.org, calcul hijri → grégorien.
 * `is_approximate = true` : dates susceptibles de varier d'1 à 2 jours selon observation lunaire.
 */
const MOBILE_HOLIDAYS_2026: MobileHoliday[] = [
  {
    date: "2026-01-20",
    name: "Maouloud (Mawlid)",
    description: "Naissance du Prophète Muhammad — 12 Rabi' al-Awwal 1447 (approximatif)",
    isApproximate: true,
  },
  {
    date: "2026-03-20",
    name: "Korité (Aïd el-Fitr)",
    description: "Fin du Ramadan 1447 — date approximative selon croissant de lune",
    isApproximate: true,
  },
  {
    date: "2026-05-27",
    name: "Tabaski (Aïd el-Kébir)",
    description: "Fête du Sacrifice — 10 Dhu al-Hijjah 1447 (approximatif)",
    isApproximate: true,
  },
];

/**
 * Jours fériés ivoiriens 2027 — fêtes fixes.
 */
const FIXED_HOLIDAYS_2027: FixedHoliday[] = [
  { date: "2027-01-01", name: "Jour de l'An", isApproximate: false },
  { date: "2027-03-29", name: "Lundi de Pâques", description: "Calendrier grégorien 2027", isApproximate: false },
  { date: "2027-05-01", name: "Fête du Travail", isApproximate: false },
  { date: "2027-05-06", name: "Ascension", description: "39 jours après Pâques 2027", isApproximate: false },
  { date: "2027-05-17", name: "Lundi de Pentecôte", description: "49 jours après Pâques 2027", isApproximate: false },
  { date: "2027-08-07", name: "Fête Nationale", description: "Indépendance de la Côte d'Ivoire", isApproximate: false },
  { date: "2027-11-01", name: "Toussaint", isApproximate: false },
  { date: "2027-11-15", name: "Fête Nationale de la Paix", isApproximate: false },
  { date: "2027-12-25", name: "Noël", isApproximate: false },
];

/**
 * Jours fériés ivoiriens 2027 — fêtes mobiles islamiques.
 * `is_approximate = true` — mise à jour requise avant 2027.
 */
const MOBILE_HOLIDAYS_2027: MobileHoliday[] = [
  {
    date: "2027-01-09",
    name: "Maouloud (Mawlid)",
    description: "Naissance du Prophète Muhammad — 12 Rabi' al-Awwal 1448 (approximatif)",
    isApproximate: true,
  },
  {
    date: "2027-03-10",
    name: "Korité (Aïd el-Fitr)",
    description: "Fin du Ramadan 1448 — date approximative selon croissant de lune",
    isApproximate: true,
  },
  {
    date: "2027-05-17",
    name: "Tabaski (Aïd el-Kébir)",
    description: "Fête du Sacrifice — 10 Dhu al-Hijjah 1448 (approximatif)",
    isApproximate: true,
  },
];

/** Tous les jours fériés combinés 2026-2027. */
const ALL_HOLIDAYS: Holiday[] = [
  ...FIXED_HOLIDAYS_2026,
  ...MOBILE_HOLIDAYS_2026,
  ...FIXED_HOLIDAYS_2027,
  ...MOBILE_HOLIDAYS_2027,
];

/** Année maximale couverte par les fériés mobiles. */
const MAX_MOBILE_YEAR = Math.max(
  ...MOBILE_HOLIDAYS_2026.map((h) => new Date(h.date).getFullYear()),
  ...MOBILE_HOLIDAYS_2027.map((h) => new Date(h.date).getFullYear())
);

// ─────────────────────────────────────────────────────────────────────────────
// Vérification de l'année et avertissement
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Vérifie si l'année courante dépasse la couverture des fériés mobiles.
 * Si oui, appelle `warnFn` avec un message d'avertissement.
 *
 * @param maxYear - Année maximale couverte par les fériés mobiles
 * @param warnFn  - Fonction de log (défaut : console.warn)
 */
export async function checkHolidayWarning(
  maxYear: number = MAX_MOBILE_YEAR,
  warnFn: (msg: string) => void = console.warn
): Promise<void> {
  const currentYear = new Date().getFullYear();
  if (currentYear > maxYear) {
    warnFn(
      `[SIGFA SEED WARNING] L'année courante (${currentYear}) dépasse la couverture des fériés mobiles ` +
      `(max(year) = ${maxYear}). Les fêtes islamiques ne sont plus à jour. ` +
      `Story d'exploitation : mettre à jour MOBILE_HOLIDAYS_${currentYear} dans src/seed/index.ts. ` +
      `Voir : src/seed/public-holidays-sources.md`
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Seed : jours fériés
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Insère un jour férié dans `public_holidays` (idempotent via ON CONFLICT).
 *
 * @param query   - Connexion migrateur (BYPASSRLS)
 * @param holiday - Jour férié à insérer
 */
async function insertHoliday(query: QueryFn, holiday: Holiday): Promise<void> {
  const desc = holiday.description
    ? `'${holiday.description.replace(/'/g, "''")}'`
    : "NULL";
  await query(`
    INSERT INTO public_holidays (date, name, description, is_approximate)
    VALUES (
      '${holiday.date}',
      '${holiday.name.replace(/'/g, "''")}',
      ${desc},
      ${holiday.isApproximate}
    )
    ON CONFLICT (date, name) DO NOTHING
  `);
}

/**
 * Insère les jours fériés ivoiriens dans `public_holidays`.
 * Idempotent : ON CONFLICT (date, name) DO NOTHING.
 *
 * @param query - Connexion migrateur (BYPASSRLS)
 */
async function seedPublicHolidays(query: QueryFn): Promise<void> {
  for (const holiday of ALL_HOLIDAYS) {
    await insertHoliday(query, holiday);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Sélection des tenants à seeder
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Résout la liste ordonnée et dédupliquée des slugs de tenants à seeder.
 * Rétro-compatibilité : `seedDemo: true` ajoute le tenant `demo`.
 *
 * @param options - Options du seed (`tenants` + `seedDemo`)
 * @returns Slugs valides du registre `TENANT_SEED_CONFIGS`
 * @throws Si un slug demandé est inconnu du registre
 */
export function resolveTenantSlugs(options: SeedOptions): string[] {
  const slugs: string[] = [];
  const push = (slug: string): void => {
    if (!slugs.includes(slug)) slugs.push(slug);
  };
  for (const slug of options.tenants ?? []) {
    push(slug);
  }
  if (options.seedDemo) {
    push("demo");
  }
  const known = Object.keys(TENANT_SEED_CONFIGS);
  for (const slug of slugs) {
    if (!(slug in TENANT_SEED_CONFIGS)) {
      throw new Error(
        `[SIGFA SEED] Tenant de seed inconnu : '${slug}'. ` +
        `Tenants disponibles : ${known.join(", ")} (voir src/seed/tenants/).`
      );
    }
  }
  return slugs;
}

// ─────────────────────────────────────────────────────────────────────────────
// Point d'entrée principal
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Exécute le seed complet (idempotent) : fériés + tenants sélectionnés.
 *
 * @param query   - Connexion migrateur (BYPASSRLS) — pour les tables hors-tenant et tenants
 * @param options - Options du seed (`{ seedDemo?, tenants? }`)
 */
export async function runSeed(
  query: QueryFn,
  options: SeedOptions = {}
): Promise<void> {
  await checkHolidayWarning(MAX_MOBILE_YEAR);
  await seedPublicHolidays(query);
  for (const slug of resolveTenantSlugs(options)) {
    const config = TENANT_SEED_CONFIGS[slug];
    /* v8 ignore next — resolveTenantSlugs garantit l'existence du slug */
    if (!config) continue;
    await seedTenant(query, config);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Entrypoint CLI : `pnpm --filter @sigfa/database seed`
//   SEED_TENANTS=demo,bicici  — sélection des tenants (registre ./tenants/)
//   SEED_DEMO=1               — rétro-compatibilité (équivaut à SEED_TENANTS=demo)
// ─────────────────────────────────────────────────────────────────────────────

if (import.meta.url === new URL(process.argv[1]!, "file://").href) {
  const { Client } = await import("pg");
  const connectionString =
    process.env["DATABASE_URL"] ??
    "postgresql://sigfa:sigfa_test@localhost:5432/sigfa_test";

  const client = new Client({ connectionString });
  await client.connect();

  const queryFn: QueryFn = async (sql: string) => {
    const res = await client.query(sql);
    return { rows: res.rows as Array<Record<string, unknown>> };
  };

  const seedDemo = process.env["SEED_DEMO"] === "1";
  const tenants = (process.env["SEED_TENANTS"] ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);

  try {
    console.log(
      `[SIGFA SEED] Démarrage (SEED_DEMO=${seedDemo ? "1" : "0"}, ` +
      `SEED_TENANTS=${tenants.join(",") || "∅"})...`
    );
    await runSeed(queryFn, { seedDemo, tenants });
    console.log("[SIGFA SEED] Terminé avec succès.");
  } finally {
    await client.end();
  }
}
