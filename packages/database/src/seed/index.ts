/**
 * Seed SIGFA — DB-003
 *
 * Exécutable : `pnpm --filter @sigfa/database seed`
 *
 * ## Périmètre
 * 1. Jours fériés ivoiriens (table `public_holidays`, hors-tenant) — via connexion migrateur
 * 2. Tenant de démonstration complet (flag `SEED_DEMO=1`) — via connexion migrateur (BYPASSRLS)
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

import { createHash } from "node:crypto";
import { DEFAULT_SERVICES } from "./default-services.js";
import { PERSISTABLE_ROLES } from "./rbac-matrix.js";

/** Fonction de requête SQL compatible avec `DualConnectionHarness.query`. */
export type QueryFn = (sql: string) => Promise<{ rows: Array<Record<string, unknown>> }>;

/** Options du seed. */
export interface SeedOptions {
  /** Active le seed de démo (tenant complet). NE PAS utiliser en production. */
  seedDemo: boolean;
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
 * @param maxYear     - Année maximale couverte par les fériés mobiles (défaut : MAX_MOBILE_YEAR)
 * @param warnFn      - Fonction de log (défaut : console.warn)
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
 * Insère les jours fériés ivoiriens dans `public_holidays`.
 * Idempotent : ON CONFLICT (date, name) DO NOTHING.
 *
 * @param query - Connexion migrateur (BYPASSRLS)
 */
async function seedPublicHolidays(query: QueryFn): Promise<void> {
  for (const holiday of ALL_HOLIDAYS) {
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
}

// ─────────────────────────────────────────────────────────────────────────────
// Seed démo : tenant complet (SEED_DEMO=1 uniquement)
// ─────────────────────────────────────────────────────────────────────────────

/** UUIDs déterministes de démo (stable entre exécutions). */
const DEMO_BANK_ID = "d0000000-1111-4000-8000-000000000001";
const DEMO_AGENCY_1_ID = "d0000001-1111-4000-8000-000000000001";
const DEMO_AGENCY_2_ID = "d0000001-1111-4000-8000-000000000002";
const DEMO_COUNTER_1_ID = "d0000002-1111-4000-8000-000000000001";
const DEMO_COUNTER_2_ID = "d0000002-1111-4000-8000-000000000002";
const DEMO_KIOSK_1_ID = "d0000003-1111-4000-8000-000000000001";

/**
 * Génère un email de démo déterministe par rôle.
 * @param role - Rôle SIGFA
 * @returns Email de démo
 */
function demoEmail(role: string): string {
  return `demo.${role.toLowerCase().replace(/_/g, ".")}@sigfa-demo.ci`;
}

/**
 * Génère un hash bcrypt simulé pour les tests (non sécurisé — démo uniquement).
 * En production, bcrypt cost 12 est utilisé par l'API (API-001).
 * @param password - Mot de passe en clair
 * @returns Hash déterministe (préfixe $demo$ non valide bcrypt — marqueur clair)
 */
function demoPasswordHash(password: string): string {
  const hash = createHash("sha256").update(password).digest("hex").substring(0, 16);
  return `$demo$12$${hash}`;
}

/**
 * Insère le tenant de démonstration complet.
 * Idempotent : ON CONFLICT DO NOTHING partout.
 *
 * Contenu :
 * - 1 banque (slug "demo-sigfa")
 * - 2 agences
 * - 8 services par agence (catalogue par défaut)
 * - 2 guichets
 * - 1 kiosque
 * - 1 utilisateur par rôle persistable (sauf SUPER_ADMIN → bank_id NULL, hors tenant)
 *
 * @param query      - Connexion migrateur (BYPASSRLS)
 * @param passwords  - Map role → mot de passe généré (pour affichage unique)
 */
async function seedDemoTenant(
  query: QueryFn,
  passwords: Map<string, string>
): Promise<void> {
  // ── Banque de démo ──────────────────────────────────────────────────────
  await query(`
    INSERT INTO banks (id, name, slug)
    VALUES ('${DEMO_BANK_ID}', 'Banque de Démonstration SIGFA', 'demo-sigfa')
    ON CONFLICT (id) DO NOTHING
  `);

  // ── Agences ─────────────────────────────────────────────────────────────
  await query(`
    INSERT INTO agencies (id, bank_id, name, city)
    VALUES
      ('${DEMO_AGENCY_1_ID}', '${DEMO_BANK_ID}', 'Agence Centre - Démo', 'Abidjan'),
      ('${DEMO_AGENCY_2_ID}', '${DEMO_BANK_ID}', 'Agence Plateau - Démo', 'Abidjan')
    ON CONFLICT (id) DO NOTHING
  `);

  // ── Services (catalogue par défaut × 2 agences) ──────────────────────
  for (const agency of [DEMO_AGENCY_1_ID, DEMO_AGENCY_2_ID]) {
    for (const service of DEFAULT_SERVICES) {
      const serviceId = generateDemoServiceId(agency, service.code);
      await query(`
        INSERT INTO services (id, bank_id, agency_id, code, name, sla_minutes, display_order)
        VALUES (
          '${serviceId}',
          '${DEMO_BANK_ID}',
          '${agency}',
          '${service.code}',
          '${service.name.replace(/'/g, "''")}',
          ${service.slaMinutes},
          ${service.displayOrder}
        )
        ON CONFLICT (agency_id, code) DO NOTHING
      `);
    }
  }

  // ── Guichets ─────────────────────────────────────────────────────────
  await query(`
    INSERT INTO counters (id, bank_id, agency_id, number, label)
    VALUES
      ('${DEMO_COUNTER_1_ID}', '${DEMO_BANK_ID}', '${DEMO_AGENCY_1_ID}', 1, 'Guichet 1'),
      ('${DEMO_COUNTER_2_ID}', '${DEMO_BANK_ID}', '${DEMO_AGENCY_1_ID}', 2, 'Guichet 2')
    ON CONFLICT (id) DO NOTHING
  `);

  // ── Kiosque ───────────────────────────────────────────────────────────
  await query(`
    INSERT INTO kiosks (id, bank_id, agency_id, label, credentials_hash)
    VALUES (
      '${DEMO_KIOSK_1_ID}',
      '${DEMO_BANK_ID}',
      '${DEMO_AGENCY_1_ID}',
      'Borne Accueil - Démo',
      '$demo$12$kiosk_placeholder_hash'
    )
    ON CONFLICT (id) DO NOTHING
  `);

  // ── Utilisateurs de démo par rôle (sauf SUPER_ADMIN — hors tenant) ───
  for (const role of PERSISTABLE_ROLES) {
    if (role === "SUPER_ADMIN") continue; // SUPER_ADMIN n'appartient pas à un tenant

    const password = `Demo${role}2026!`;
    passwords.set(role, password);
    const hash = demoPasswordHash(password);
    const userId = generateDemoUserId(role);
    const email = demoEmail(role);

    await query(`
      INSERT INTO users (id, bank_id, email, password_hash, first_name, last_name, role)
      VALUES (
        '${userId}',
        '${DEMO_BANK_ID}',
        '${email}',
        '${hash}',
        'Demo',
        '${role}',
        '${role}'
      )
      ON CONFLICT (email) DO NOTHING
    `);
  }

  // ── Templates de notification FR par défaut (DB-005) ──────────────────
  // Seed des 4 NotificationType × canal SMS en français pour le tenant de démo.
  // Les templates pour les autres canaux (WHATSAPP, EMAIL, PUSH) et langues
  // (DIOULA, BAOULE, EN) sont créés par le BANK_ADMIN via l'interface.
  await seedDefaultNotificationTemplates(query, DEMO_BANK_ID);
}

/**
 * Templates de notification FR par défaut pour les 4 NotificationType (DB-005).
 *
 * Variables autorisées : `{{number}}` (numéro de ticket), `{{position}}`
 * (position dans la file), `{{estimate}}` (estimation en minutes).
 * Validation côté API (CONTRACT-005) — la base stocke sans contrainte.
 *
 * Seed idempotent : ON CONFLICT (bank_id, type, channel, lang) DO NOTHING.
 *
 * @param query  - Connexion migrateur (BYPASSRLS)
 * @param bankId - UUID de la banque cible
 */
async function seedDefaultNotificationTemplates(
  query: QueryFn,
  bankId: string
): Promise<void> {
  /** Templates FR par défaut pour les 4 NotificationType, canal SMS. */
  const FR_SMS_TEMPLATES: Array<{ type: string; body: string }> = [
    {
      type: "TICKET_CONFIRMATION",
      body: "Votre ticket {{number}} a été enregistré. Vous êtes en position {{position}} dans la file. Estimation : {{estimate}} min.",
    },
    {
      type: "POSITION_UPDATE",
      body: "Mise à jour : vous êtes maintenant en position {{position}} dans la file. Estimation : {{estimate}} min.",
    },
    {
      type: "YOUR_TURN",
      body: "C'est bientôt votre tour ! Ticket {{number}} — préparez vos documents. Estimation : {{estimate}} min.",
    },
    {
      type: "DAILY_REPORT",
      body: "Rapport journalier de votre agence : {{number}} tickets traités aujourd'hui.",
    },
  ];

  for (const tpl of FR_SMS_TEMPLATES) {
    await query(`
      INSERT INTO notification_templates (id, bank_id, type, channel, lang, body)
      VALUES (
        gen_random_uuid(),
        '${bankId}',
        '${tpl.type}',
        'SMS',
        'FR',
        '${tpl.body.replace(/'/g, "''")}'
      )
      ON CONFLICT (bank_id, type, channel, lang) DO NOTHING
    `);
  }
}

/**
 * Génère un UUID déterministe pour un service de démo.
 * @param agencyId - UUID de l'agence
 * @param code     - Code du service
 */
function generateDemoServiceId(agencyId: string, code: string): string {
  const hash = createHash("sha256")
    .update(`demo-service-${agencyId}-${code}`)
    .digest("hex");
  // Format UUID v4-like depuis le hash
  return [
    hash.substring(0, 8),
    hash.substring(8, 12),
    "4" + hash.substring(13, 16),
    "8" + hash.substring(17, 20),
    hash.substring(20, 32),
  ].join("-");
}

/**
 * Génère un UUID déterministe pour un utilisateur de démo.
 * @param role - Rôle de l'utilisateur
 */
function generateDemoUserId(role: string): string {
  const hash = createHash("sha256")
    .update(`demo-user-${role}`)
    .digest("hex");
  return [
    hash.substring(0, 8),
    hash.substring(8, 12),
    "4" + hash.substring(13, 16),
    "8" + hash.substring(17, 20),
    hash.substring(20, 32),
  ].join("-");
}

// ─────────────────────────────────────────────────────────────────────────────
// Point d'entrée principal
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Exécute le seed complet (idempotent).
 *
 * @param query   - Connexion migrateur (BYPASSRLS) — pour les tables hors-tenant et démo
 * @param options - Options du seed (`{ seedDemo: boolean }`)
 */
export async function runSeed(
  query: QueryFn,
  options: SeedOptions = { seedDemo: false }
): Promise<void> {
  // 1. Avertissement si les fériés mobiles sont périmés
  await checkHolidayWarning(MAX_MOBILE_YEAR);

  // 2. Jours fériés ivoiriens (hors-tenant, connexion migrateur)
  await seedPublicHolidays(query);

  // 3. Tenant de démo (seulement si SEED_DEMO=1)
  if (options.seedDemo) {
    const passwords = new Map<string, string>();
    await seedDemoTenant(query, passwords);

    if (passwords.size > 0) {
      console.log("\n╔══════════════════════════════════════════════════════╗");
      console.log("║  SIGFA DEMO — Comptes créés (affichés UNE SEULE FOIS) ║");
      console.log("╠══════════════════════════════════════════════════════╣");
      for (const [role, password] of passwords) {
        const email = demoEmail(role);
        console.log(`║  ${role.padEnd(18)} │ ${email.padEnd(32)} │ ${password}`);
      }
      console.log("╚══════════════════════════════════════════════════════╝\n");
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Entrypoint CLI : `pnpm --filter @sigfa/database seed`
// ─────────────────────────────────────────────────────────────────────────────

// Seulement exécuté si lancé directement (pas en import de test)
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

  try {
    console.log(`[SIGFA SEED] Démarrage (SEED_DEMO=${seedDemo ? "1" : "0"})...`);
    await runSeed(queryFn, { seedDemo });
    console.log("[SIGFA SEED] Terminé avec succès.");
  } finally {
    await client.end();
  }
}
