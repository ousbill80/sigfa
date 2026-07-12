/**
 * Seed SIGFA — DB-003 / DB-009
 *
 * Exécutable : `pnpm --filter @sigfa/database seed`
 *
 * ## Périmètre
 * 1. Jours fériés ivoiriens (table `public_holidays`, hors-tenant) — via connexion migrateur
 * 2. Tenant de démonstration complet (flag `SEED_DEMO=1`) — via connexion migrateur (BYPASSRLS)
 *
 * ## DB-009 : Sécurité renforcée
 * - Mots de passe de démo générés via `crypto.randomBytes` (aléatoires, uniques par exécution)
 * - Hash bcrypt réel cost 12 (jamais de hash simulé)
 * - Garde `NODE_ENV !== 'production'` — le seed de démo lève une erreur en production
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

import { randomBytes, createHash } from "node:crypto";
import bcrypt from "bcryptjs";
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
// Seed démo : génération des mots de passe (DB-009)
// ─────────────────────────────────────────────────────────────────────────────

/** UUIDs déterministes de démo (stable entre exécutions). */
const DEMO_BANK_ID = "d0000000-1111-4000-8000-000000000001";
const DEMO_AGENCY_1_ID = "d0000001-1111-4000-8000-000000000001";
const DEMO_AGENCY_2_ID = "d0000001-1111-4000-8000-000000000002";
const DEMO_COUNTER_1_ID = "d0000002-1111-4000-8000-000000000001";
const DEMO_COUNTER_2_ID = "d0000002-1111-4000-8000-000000000002";
const DEMO_KIOSK_1_ID = "d0000003-1111-4000-8000-000000000001";

/**
 * Génère un mot de passe aléatoire de démo via `crypto.randomBytes`.
 * DB-009 : aucun mot de passe fixe — chaque exécution produit des mots de passe uniques.
 * Affiché UNE SEULE FOIS à la console (voir `runSeed`).
 *
 * @returns Mot de passe aléatoire (16 octets en hex = 32 caractères)
 */
function generateDemoPassword(): string {
  return randomBytes(16).toString("hex");
}

/**
 * Hash bcrypt réel cost 12 (DB-009 — plus aucun hash simulé de type demo).
 *
 * @param password - Mot de passe en clair
 * @returns Hash bcrypt (format $2b$12$...)
 */
async function hashDemoPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

/**
 * Génère un email de démo déterministe par rôle.
 *
 * @param role - Rôle SIGFA
 * @returns Email de démo
 */
function demoEmail(role: string): string {
  return `demo.${role.toLowerCase().replace(/_/g, ".")}@sigfa-demo.ci`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Seed démo : fixtures structurelles
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Insère la banque et les agences de démo (idempotent).
 *
 * @param query - Connexion migrateur (BYPASSRLS)
 */
async function seedDemoBank(query: QueryFn): Promise<void> {
  await query(`
    INSERT INTO banks (id, name, slug)
    VALUES ('${DEMO_BANK_ID}', 'Banque de Démonstration SIGFA', 'demo-sigfa')
    ON CONFLICT (id) DO NOTHING
  `);
  await query(`
    INSERT INTO agencies (id, bank_id, name, city)
    VALUES
      ('${DEMO_AGENCY_1_ID}', '${DEMO_BANK_ID}', 'Agence Centre - Démo', 'Abidjan'),
      ('${DEMO_AGENCY_2_ID}', '${DEMO_BANK_ID}', 'Agence Plateau - Démo', 'Abidjan')
    ON CONFLICT (id) DO NOTHING
  `);
}

/**
 * Insère les services du catalogue par défaut pour une agence de démo.
 *
 * @param query    - Connexion migrateur (BYPASSRLS)
 * @param agencyId - UUID de l'agence cible
 */
async function seedDemoServices(query: QueryFn, agencyId: string): Promise<void> {
  for (const service of DEFAULT_SERVICES) {
    const serviceId = generateDemoServiceId(agencyId, service.code);
    await query(`
      INSERT INTO services (id, bank_id, agency_id, code, name, sla_minutes, display_order)
      VALUES (
        '${serviceId}', '${DEMO_BANK_ID}', '${agencyId}',
        '${service.code}', '${service.name.replace(/'/g, "''")}',
        ${service.slaMinutes}, ${service.displayOrder}
      )
      ON CONFLICT (agency_id, code) DO NOTHING
    `);
  }
}

/**
 * Catalogue d'opérations de démo (MODEL-DB-A) — démontre le modèle 2 niveaux
 * Service → Opération. `serviceCode` cible le service parent (par agence).
 * `slaMinutes = null` → hérite du SLA du service (D4). Codes conformes `^[A-Z0-9]{2,6}$`,
 * uniques par service. ≥2 opérations sous ≥1 service (ici : OC et OA).
 */
const DEMO_OPERATIONS: ReadonlyArray<{
  serviceCode: string;
  code: string;
  name: string;
  slaMinutes: number | null;
  displayOrder: number;
}> = [
  // Service OC (Opérations courantes) — 3 opérations (démontre la granularité fine)
  { serviceCode: "OC", code: "OCDEP", name: "Dépôt d'espèces", slaMinutes: null, displayOrder: 0 },
  { serviceCode: "OC", code: "OCRET", name: "Retrait d'espèces", slaMinutes: 5, displayOrder: 1 },
  { serviceCode: "OC", code: "OCVIR", name: "Virement", slaMinutes: null, displayOrder: 2 },
  // Service OA (Ouverture de compte) — 2 opérations
  { serviceCode: "OA", code: "OAPART", name: "Compte particulier", slaMinutes: null, displayOrder: 0 },
  { serviceCode: "OA", code: "OAPRO", name: "Compte professionnel", slaMinutes: 40, displayOrder: 1 },
] as const;

/**
 * Génère un UUID déterministe pour une opération de démo.
 *
 * @param agencyId - UUID de l'agence
 * @param code     - Code de l'opération
 */
function generateDemoOperationId(agencyId: string, code: string): string {
  const hash = createHash("sha256")
    .update(`demo-operation-${agencyId}-${code}`)
    .digest("hex");
  return hexToUuid(hash);
}

/**
 * Insère les opérations de démo sous les services d'une agence (idempotent).
 * Démontre le modèle 2 niveaux (MODEL-DB-A). `sla_minutes` NULL → hérite du service.
 *
 * @param query    - Connexion migrateur (BYPASSRLS)
 * @param agencyId - UUID de l'agence cible
 */
async function seedDemoOperations(query: QueryFn, agencyId: string): Promise<void> {
  for (const op of DEMO_OPERATIONS) {
    const serviceId = generateDemoServiceId(agencyId, op.serviceCode);
    const operationId = generateDemoOperationId(agencyId, op.code);
    const sla = op.slaMinutes === null ? "NULL" : String(op.slaMinutes);
    await query(`
      INSERT INTO operations (id, bank_id, agency_id, service_id, code, name, sla_minutes, display_order)
      VALUES (
        '${operationId}', '${DEMO_BANK_ID}', '${agencyId}', '${serviceId}',
        '${op.code}', '${op.name.replace(/'/g, "''")}',
        ${sla}, ${op.displayOrder}
      )
      ON CONFLICT (service_id, code) DO NOTHING
    `);
  }
}

/**
 * Insère les guichets et le kiosque de démo (idempotent).
 *
 * @param query - Connexion migrateur (BYPASSRLS)
 */
async function seedDemoCountersAndKiosk(query: QueryFn): Promise<void> {
  await query(`
    INSERT INTO counters (id, bank_id, agency_id, number, label)
    VALUES
      ('${DEMO_COUNTER_1_ID}', '${DEMO_BANK_ID}', '${DEMO_AGENCY_1_ID}', 1, 'Guichet 1'),
      ('${DEMO_COUNTER_2_ID}', '${DEMO_BANK_ID}', '${DEMO_AGENCY_1_ID}', 2, 'Guichet 2')
    ON CONFLICT (id) DO NOTHING
  `);
  await query(`
    INSERT INTO kiosks (id, bank_id, agency_id, label, credentials_hash)
    VALUES (
      '${DEMO_KIOSK_1_ID}', '${DEMO_BANK_ID}', '${DEMO_AGENCY_1_ID}',
      'Borne Accueil - Démo', '$2b$12$placeholder_kiosk_hash_value'
    )
    ON CONFLICT (id) DO NOTHING
  `);
}

/**
 * Insère un utilisateur de démo pour un rôle donné.
 *
 * @param query    - Connexion migrateur (BYPASSRLS)
 * @param role     - Rôle SIGFA à créer
 * @param passwords - Map role → password (pour affichage unique)
 */
async function seedDemoUser(
  query: QueryFn,
  role: string,
  passwords: Map<string, string>
): Promise<void> {
  const password = generateDemoPassword();
  passwords.set(role, password);
  const hash = await hashDemoPassword(password);
  const userId = generateDemoUserId(role);
  const email = demoEmail(role);
  await query(`
    INSERT INTO users (id, bank_id, email, password_hash, first_name, last_name, role)
    VALUES (
      '${userId}', '${DEMO_BANK_ID}', '${email}',
      '${hash}', 'Demo', '${role}', '${role}'
    )
    ON CONFLICT (email) DO NOTHING
  `);
}

/**
 * Insère un template de notification SMS FR par défaut.
 *
 * @param query  - Connexion migrateur (BYPASSRLS)
 * @param bankId - UUID de la banque cible
 * @param type   - Type de notification
 * @param body   - Corps du message (avec variables {{...}})
 */
async function insertNotificationTemplate(
  query: QueryFn,
  bankId: string,
  type: string,
  body: string
): Promise<void> {
  await query(`
    INSERT INTO notification_templates (id, bank_id, type, channel, lang, body)
    VALUES (
      gen_random_uuid(), '${bankId}', '${type}', 'SMS', 'FR',
      '${body.replace(/'/g, "''")}'
    )
    ON CONFLICT (bank_id, type, channel, lang) DO NOTHING
  `);
}

/**
 * Templates de notification FR par défaut pour les 4 NotificationType (DB-005).
 * Seed idempotent : ON CONFLICT (bank_id, type, channel, lang) DO NOTHING.
 *
 * @param query  - Connexion migrateur (BYPASSRLS)
 * @param bankId - UUID de la banque cible
 */
async function seedDefaultNotificationTemplates(
  query: QueryFn,
  bankId: string
): Promise<void> {
  const templates = [
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
  for (const tpl of templates) {
    await insertNotificationTemplate(query, bankId, tpl.type, tpl.body);
  }
}

/**
 * Convertit un hash hex en UUID v4-like déterministe.
 *
 * @param hash - Hash hex de 64 caractères (SHA256)
 * @returns UUID déterministe (format xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx)
 */
function hexToUuid(hash: string): string {
  return [
    hash.substring(0, 8),
    hash.substring(8, 12),
    "4" + hash.substring(13, 16),
    "8" + hash.substring(17, 20),
    hash.substring(20, 32),
  ].join("-");
}

/**
 * Génère un UUID déterministe pour un service de démo.
 *
 * @param agencyId - UUID de l'agence
 * @param code     - Code du service
 */
function generateDemoServiceId(agencyId: string, code: string): string {
  const hash = createHash("sha256")
    .update(`demo-service-${agencyId}-${code}`)
    .digest("hex");
  return hexToUuid(hash);
}

/**
 * Génère un UUID déterministe pour un utilisateur de démo.
 *
 * @param role - Rôle de l'utilisateur
 */
function generateDemoUserId(role: string): string {
  const hash = createHash("sha256").update(`demo-user-${role}`).digest("hex");
  return hexToUuid(hash);
}

// ─────────────────────────────────────────────────────────────────────────────
// Seed démo : point d'entrée principal
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Affiche les mots de passe de démo à la console (UNE SEULE FOIS).
 *
 * @param passwords - Map role → password généré
 */
function printDemoPasswords(passwords: Map<string, string>): void {
  if (passwords.size === 0) return;
  console.log("\n╔══════════════════════════════════════════════════════╗");
  console.log("║  SIGFA DEMO — Comptes créés (affichés UNE SEULE FOIS) ║");
  console.log("╠══════════════════════════════════════════════════════╣");
  for (const [role, password] of passwords) {
    const email = demoEmail(role);
    console.log(`║  ${role.padEnd(18)} │ ${email.padEnd(32)} │ ${password}`);
  }
  console.log("╚══════════════════════════════════════════════════════╝\n");
}

/**
 * Insère le tenant de démonstration complet.
 * DB-009 : garde `NODE_ENV !== 'production'` — lève une erreur en production.
 * Idempotent : ON CONFLICT DO NOTHING partout.
 *
 * @param query - Connexion migrateur (BYPASSRLS)
 */
async function seedDemoTenant(query: QueryFn): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "[SIGFA SEED] Le seed de démo est interdit en production (NODE_ENV=production). " +
      "Retirer SEED_DEMO=1 ou utiliser NODE_ENV=development."
    );
  }

  await seedDemoBank(query);

  for (const agencyId of [DEMO_AGENCY_1_ID, DEMO_AGENCY_2_ID]) {
    await seedDemoServices(query, agencyId);
    await seedDemoOperations(query, agencyId);
  }

  await seedDemoCountersAndKiosk(query);

  const passwords = new Map<string, string>();
  for (const role of PERSISTABLE_ROLES) {
    if (role === "SUPER_ADMIN") continue;
    await seedDemoUser(query, role, passwords);
  }

  await seedDefaultNotificationTemplates(query, DEMO_BANK_ID);
  printDemoPasswords(passwords);
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
  await checkHolidayWarning(MAX_MOBILE_YEAR);
  await seedPublicHolidays(query);
  if (options.seedDemo) {
    await seedDemoTenant(query);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Entrypoint CLI : `pnpm --filter @sigfa/database seed`
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

  try {
    console.log(`[SIGFA SEED] Démarrage (SEED_DEMO=${seedDemo ? "1" : "0"})...`);
    await runSeed(queryFn, { seedDemo });
    console.log("[SIGFA SEED] Terminé avec succès.");
  } finally {
    await client.end();
  }
}
