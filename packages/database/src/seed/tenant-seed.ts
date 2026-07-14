/**
 * Moteur de seed de tenant PARAMÉTRABLE — extraction de `seedDemoTenant()` (DB-003/DB-009).
 *
 * RÈGLE PRODUIT : aucune donnée spécifique à une banque n'est codée en dur dans
 * l'applicatif. Chaque tenant de seed est décrit par une `TenantSeedConfig`
 * (fichier dédié sous `./tenants/`) : identité, thème (couleurs + messages
 * d'accueil FR/EN + logo), agences, guichets, kiosques. Le moteur `seedTenant()`
 * consomme cette config et insère le tenant complet de façon idempotente.
 *
 * ## Garanties héritées de DB-003/DB-009 (non-régression tenant démo)
 * - UUIDs déterministes : mêmes entrées ⇒ mêmes IDs (namespace `demo` conserve
 *   exactement les IDs historiques `demo-service-…`, `demo-user-…`).
 * - Idempotence : tous les INSERT sont `ON CONFLICT DO NOTHING`.
 * - Mots de passe aléatoires (`crypto.randomBytes`), hash bcrypt cost 12,
 *   affichés UNE SEULE FOIS à la console.
 * - Garde `NODE_ENV !== 'production'` : le seed de tenant lève en production.
 *
 * ## Thème et contraste WCAG
 * `appliedColors` est CALCULÉ à partir de `requestedColors` via l'utilitaire
 * partagé `correctContrast` de `@sigfa/schemas` (≥ 4.5:1 contre le fond) —
 * même logique que la route theming de l'API (API-009), aucune duplication.
 *
 * @module
 */

import { randomBytes, createHash } from "node:crypto";
import bcrypt from "bcryptjs";
import { correctContrast } from "@sigfa/schemas";
import type { BankTheme } from "src/schema/banks.js";
import type { WeeklySchedule } from "src/schema/agencies.js";
import { DEFAULT_SERVICES } from "./default-services.js";
import { PERSISTABLE_ROLES } from "./rbac-matrix.js";

/** Fonction de requête SQL compatible avec `DualConnectionHarness.query`. */
export type QueryFn = (sql: string) => Promise<{ rows: Array<Record<string, unknown>> }>;

// ─────────────────────────────────────────────────────────────────────────────
// Types de configuration de tenant
// ─────────────────────────────────────────────────────────────────────────────

/** Couleurs demandées par la banque (avant correction de contraste WCAG). */
export interface TenantColors {
  /** Couleur de marque principale `#RRGGBB`. */
  primary: string;
  /** Couleur secondaire `#RRGGBB`. */
  secondary: string;
  /** Couleur de fond `#RRGGBB`. */
  background: string;
}

/** Messages d'accueil localisés — FR/EN UNIQUEMENT (décision PO 2026-07). */
export interface TenantWelcomeMessages {
  /** Message d'accueil français. */
  fr: string;
  /** Message d'accueil anglais. */
  en: string;
}

/** Thème de tenant (habillage, jamais structure — CLAUDE.md §8). */
export interface TenantThemeConfig {
  /** Couleurs demandées ; `appliedColors` est dérivé par `buildAppliedTheme`. */
  requestedColors: TenantColors;
  /** Messages d'accueil FR/EN. */
  welcomeMessages: TenantWelcomeMessages;
  /** URL du logo (chemin servable par les apps, ex. `/tenants/<slug>/logo.png`). */
  logoUrl?: string;
}

/** Guichet à seeder pour une agence. */
export interface TenantCounterConfig {
  /** UUID déterministe du guichet. */
  id: string;
  /** Numéro du guichet (unique par agence). */
  number: number;
  /** Libellé public du guichet. */
  label: string;
}

/** Borne kiosque à seeder pour une agence. */
export interface TenantKioskConfig {
  /** UUID déterministe de la borne. */
  id: string;
  /** Libellé public de la borne. */
  label: string;
}

/** Agence à seeder. */
export interface TenantAgencyConfig {
  /** UUID déterministe de l'agence. */
  id: string;
  /** Nom public de l'agence. */
  name: string;
  /** Ville. */
  city?: string;
  /** Adresse postale. */
  address?: string;
  /** Téléphone de contact. */
  phone?: string;
  /** Fuseau IANA (défaut : `Africa/Abidjan`). */
  timezone?: string;
  /** Horaire hebdomadaire (une plage {start,end} par jour). */
  weeklySchedule?: WeeklySchedule;
  /** Guichets de l'agence (optionnel). */
  counters?: ReadonlyArray<TenantCounterConfig>;
  /** Bornes kiosque de l'agence (optionnel). */
  kiosks?: ReadonlyArray<TenantKioskConfig>;
}

/** Conseiller clientèle public (MODEL-DB-B, D5) rattaché à un rôle seedé. */
export interface TenantRelationshipManager {
  /** Nom public affiché (zéro PII supplémentaire). */
  displayName: string;
  /** URL de la photo publique. */
  photoUrl: string;
}

/** Mapping menu WhatsApp : mot-clé → service d'une agence. */
export interface TenantWhatsAppMenuMapping {
  /** Mot-clé saisi par le client (ex. "1"). */
  keyword: string;
  /** Agence portant le service ciblé. */
  agencyId: string;
  /** Code du service ciblé (ex. "OC"). */
  serviceCode: string;
}

/** Config WhatsApp Business du tenant (optionnelle). */
export interface TenantWhatsAppConfig {
  /** Numéro WhatsApp Business E.164. */
  businessNumber: string;
  /** Secret webhook DE DÉMO (jamais un secret de production). */
  webhookSecret: string;
  /** Agence par défaut pour les tickets WhatsApp. */
  defaultAgencyId: string;
  /** Mappings menu mot-clé → service. */
  menuMappings: ReadonlyArray<TenantWhatsAppMenuMapping>;
}

/**
 * Configuration complète d'un tenant de seed.
 * Un fichier par tenant sous `./tenants/` — RIEN en dur dans le moteur.
 */
export interface TenantSeedConfig {
  /**
   * Espace de noms des IDs déterministes (sha256). Le namespace `demo`
   * reproduit exactement les IDs historiques du tenant de démonstration.
   */
  idNamespace: string;
  /** UUID déterministe de la banque. */
  bankId: string;
  /** Raison sociale. */
  name: string;
  /** Slug unique kebab-case (résolution du tenant). */
  slug: string;
  /** Domaine des emails des comptes de test (`demo.<rôle>@<domaine>`). */
  userEmailDomain: string;
  /** Thème d'habillage (couleurs, messages FR/EN, logo). */
  theme: TenantThemeConfig;
  /** Agences à seeder (avec guichets/kiosques éventuels). */
  agencies: ReadonlyArray<TenantAgencyConfig>;
  /** Rôles seedés marqués conseillers publics (MODEL-DB-B). */
  relationshipManagers?: Readonly<Record<string, TenantRelationshipManager>>;
  /** Config WhatsApp Business (optionnelle). */
  whatsapp?: TenantWhatsAppConfig;
}

// ─────────────────────────────────────────────────────────────────────────────
// Catalogue d'opérations par défaut (MODEL-DB-A) — commun à tous les tenants seedés
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Catalogue d'opérations par défaut (MODEL-DB-A) — démontre le modèle 2 niveaux
 * Service → Opération. `serviceCode` cible le service parent (par agence).
 * `slaMinutes = null` → hérite du SLA du service (D4). Codes conformes
 * `^[A-Z0-9]{2,6}$`, uniques par service. ≥2 opérations sous ≥1 service (OC et OA).
 */
export const DEFAULT_OPERATIONS: ReadonlyArray<{
  serviceCode: string;
  code: string;
  name: string;
  slaMinutes: number | null;
  displayOrder: number;
}> = [
  // Service OC (Opérations courantes) — 3 opérations (granularité fine)
  { serviceCode: "OC", code: "OCDEP", name: "Dépôt d'espèces", slaMinutes: null, displayOrder: 0 },
  { serviceCode: "OC", code: "OCRET", name: "Retrait d'espèces", slaMinutes: 5, displayOrder: 1 },
  { serviceCode: "OC", code: "OCVIR", name: "Virement", slaMinutes: null, displayOrder: 2 },
  // Service OA (Ouverture de compte) — 2 opérations
  { serviceCode: "OA", code: "OAPART", name: "Compte particulier", slaMinutes: null, displayOrder: 0 },
  { serviceCode: "OA", code: "OAPRO", name: "Compte professionnel", slaMinutes: 40, displayOrder: 1 },
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers déterministes (IDs, emails, SQL)
// ─────────────────────────────────────────────────────────────────────────────

/** Échappe une chaîne pour un littéral SQL simple quote. */
function sqlEscape(value: string): string {
  return value.replace(/'/g, "''");
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

/** UUID déterministe depuis une graine texte (sha256 → v4-like). */
function deterministicUuid(seedText: string): string {
  return hexToUuid(createHash("sha256").update(seedText).digest("hex"));
}

/**
 * UUID déterministe d'un service seedé.
 * Namespace `demo` ⇒ IDs identiques à l'historique `demo-service-…` (non-régression).
 *
 * @param namespace - `TenantSeedConfig.idNamespace`
 * @param agencyId  - UUID de l'agence
 * @param code      - Code du service
 */
export function tenantServiceId(namespace: string, agencyId: string, code: string): string {
  return deterministicUuid(`${namespace}-service-${agencyId}-${code}`);
}

/**
 * UUID déterministe d'une opération seedée.
 *
 * @param namespace - `TenantSeedConfig.idNamespace`
 * @param agencyId  - UUID de l'agence
 * @param code      - Code de l'opération
 */
export function tenantOperationId(namespace: string, agencyId: string, code: string): string {
  return deterministicUuid(`${namespace}-operation-${agencyId}-${code}`);
}

/**
 * UUID déterministe d'un utilisateur seedé (un par rôle persistable).
 *
 * @param namespace - `TenantSeedConfig.idNamespace`
 * @param role      - Rôle SIGFA
 */
export function tenantUserId(namespace: string, role: string): string {
  return deterministicUuid(`${namespace}-user-${role}`);
}

/**
 * Email déterministe d'un compte de test par rôle.
 * Namespace `demo` + domaine `sigfa-demo.ci` ⇒ emails historiques inchangés.
 *
 * @param role   - Rôle SIGFA
 * @param domain - `TenantSeedConfig.userEmailDomain`
 */
export function tenantUserEmail(role: string, domain: string): string {
  return `demo.${role.toLowerCase().replace(/_/g, ".")}@${domain}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Thème : calcul des appliedColors (contraste WCAG ≥ 4.5:1)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Construit le `BankTheme` persisté (colonne `banks.theme` jsonb) depuis la
 * config : `appliedColors` = couleurs corrigées via `correctContrast`
 * (@sigfa/schemas) contre le fond — même logique que la route theming API-009.
 *
 * @param theme - Thème demandé par la config du tenant
 * @returns Thème complet à persister (requested + applied + messages + logo)
 */
export function buildAppliedTheme(theme: TenantThemeConfig): BankTheme {
  const { primary, secondary, background } = theme.requestedColors;
  const applied: BankTheme = {
    requestedColors: { primary, secondary, background },
    appliedColors: {
      primary: correctContrast(primary, background),
      secondary: correctContrast(secondary, background),
      background: background.toLowerCase(),
    },
    welcomeMessages: {
      fr: theme.welcomeMessages.fr,
      en: theme.welcomeMessages.en,
    },
  };
  if (theme.logoUrl !== undefined) {
    applied.logoUrl = theme.logoUrl;
  }
  return applied;
}

// ─────────────────────────────────────────────────────────────────────────────
// Mots de passe de seed (DB-009)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Génère un mot de passe aléatoire via `crypto.randomBytes`.
 * DB-009 : aucun mot de passe fixe — chaque exécution produit des mots de passe
 * uniques, affichés UNE SEULE FOIS à la console.
 *
 * @returns Mot de passe aléatoire (16 octets en hex = 32 caractères)
 */
function generateSeedPassword(): string {
  return randomBytes(16).toString("hex");
}

/**
 * Hash bcrypt réel cost 12 (DB-009 — jamais de hash simulé).
 *
 * @param password - Mot de passe en clair
 * @returns Hash bcrypt (format $2b$12$...)
 */
async function hashSeedPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

// ─────────────────────────────────────────────────────────────────────────────
// Étapes d'insertion (toutes idempotentes : ON CONFLICT DO NOTHING)
// ─────────────────────────────────────────────────────────────────────────────

/** Insère la banque avec son thème calculé (contraste WCAG appliqué). */
async function seedBank(query: QueryFn, config: TenantSeedConfig): Promise<void> {
  const theme = buildAppliedTheme(config.theme);
  await query(`
    INSERT INTO banks (id, name, slug, theme)
    VALUES (
      '${config.bankId}',
      '${sqlEscape(config.name)}',
      '${sqlEscape(config.slug)}',
      '${sqlEscape(JSON.stringify(theme))}'::jsonb
    )
    ON CONFLICT (id) DO NOTHING
  `);
}

/** Insère les agences (ville/adresse/téléphone/fuseau/horaires). */
async function seedAgencies(query: QueryFn, config: TenantSeedConfig): Promise<void> {
  for (const agency of config.agencies) {
    const city = agency.city !== undefined ? `'${sqlEscape(agency.city)}'` : "NULL";
    const address = agency.address !== undefined ? `'${sqlEscape(agency.address)}'` : "NULL";
    const phone = agency.phone !== undefined ? `'${sqlEscape(agency.phone)}'` : "NULL";
    const timezone = agency.timezone ?? "Africa/Abidjan";
    const schedule = JSON.stringify(agency.weeklySchedule ?? {});
    await query(`
      INSERT INTO agencies (id, bank_id, name, city, address, phone, timezone, weekly_schedule)
      VALUES (
        '${agency.id}', '${config.bankId}', '${sqlEscape(agency.name)}',
        ${city}, ${address}, ${phone},
        '${sqlEscape(timezone)}', '${sqlEscape(schedule)}'::jsonb
      )
      ON CONFLICT (id) DO NOTHING
    `);
  }
}

/** Insère le catalogue de services par défaut pour une agence. */
async function seedServices(
  query: QueryFn,
  config: TenantSeedConfig,
  agencyId: string
): Promise<void> {
  for (const service of DEFAULT_SERVICES) {
    const serviceId = tenantServiceId(config.idNamespace, agencyId, service.code);
    await query(`
      INSERT INTO services (id, bank_id, agency_id, code, name, sla_minutes, display_order)
      VALUES (
        '${serviceId}', '${config.bankId}', '${agencyId}',
        '${service.code}', '${sqlEscape(service.name)}',
        ${service.slaMinutes}, ${service.displayOrder}
      )
      ON CONFLICT (agency_id, code) DO NOTHING
    `);
  }
}

/** Insère les opérations par défaut sous les services d'une agence (MODEL-DB-A). */
async function seedOperations(
  query: QueryFn,
  config: TenantSeedConfig,
  agencyId: string
): Promise<void> {
  for (const op of DEFAULT_OPERATIONS) {
    const serviceId = tenantServiceId(config.idNamespace, agencyId, op.serviceCode);
    const operationId = tenantOperationId(config.idNamespace, agencyId, op.code);
    const sla = op.slaMinutes === null ? "NULL" : String(op.slaMinutes);
    await query(`
      INSERT INTO operations (id, bank_id, agency_id, service_id, code, name, sla_minutes, display_order)
      VALUES (
        '${operationId}', '${config.bankId}', '${agencyId}', '${serviceId}',
        '${op.code}', '${sqlEscape(op.name)}',
        ${sla}, ${op.displayOrder}
      )
      ON CONFLICT (service_id, code) DO NOTHING
    `);
  }
}

/** Insère les guichets et bornes kiosque décrits par la config d'agence. */
async function seedCountersAndKiosks(query: QueryFn, config: TenantSeedConfig): Promise<void> {
  for (const agency of config.agencies) {
    for (const counter of agency.counters ?? []) {
      await query(`
        INSERT INTO counters (id, bank_id, agency_id, number, label)
        VALUES (
          '${counter.id}', '${config.bankId}', '${agency.id}',
          ${counter.number}, '${sqlEscape(counter.label)}'
        )
        ON CONFLICT (id) DO NOTHING
      `);
    }
    for (const kiosk of agency.kiosks ?? []) {
      await query(`
        INSERT INTO kiosks (id, bank_id, agency_id, label, credentials_hash)
        VALUES (
          '${kiosk.id}', '${config.bankId}', '${agency.id}',
          '${sqlEscape(kiosk.label)}', '$2b$12$placeholder_kiosk_hash_value'
        )
        ON CONFLICT (id) DO NOTHING
      `);
    }
  }
}

/**
 * Insère un utilisateur de test pour un rôle donné.
 * MODEL-DB-B : les rôles listés dans `config.relationshipManagers` sont marqués
 * conseillers publics (`is_relationship_manager=true` + display_name + photo_url).
 */
async function seedUser(
  query: QueryFn,
  config: TenantSeedConfig,
  role: string,
  passwords: Map<string, string>
): Promise<void> {
  const password = generateSeedPassword();
  passwords.set(role, password);
  const hash = await hashSeedPassword(password);
  const userId = tenantUserId(config.idNamespace, role);
  const email = tenantUserEmail(role, config.userEmailDomain);
  const manager = config.relationshipManagers?.[role];
  const isRm = manager !== undefined;
  const displayName = manager ? `'${sqlEscape(manager.displayName)}'` : "NULL";
  const photoUrl = manager ? `'${sqlEscape(manager.photoUrl)}'` : "NULL";
  await query(`
    INSERT INTO users (id, bank_id, email, password_hash, first_name, last_name, role,
                       is_relationship_manager, display_name, photo_url)
    VALUES (
      '${userId}', '${config.bankId}', '${email}',
      '${hash}', 'Demo', '${role}', '${role}',
      ${isRm}, ${displayName}, ${photoUrl}
    )
    ON CONFLICT (email) DO NOTHING
  `);
}

/**
 * Templates de notification SMS FR par défaut pour les 4 NotificationType (DB-005).
 * Idempotent : ON CONFLICT (bank_id, type, channel, lang) DO NOTHING.
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
    await query(`
      INSERT INTO notification_templates (id, bank_id, type, channel, lang, body)
      VALUES (
        gen_random_uuid(), '${bankId}', '${tpl.type}', 'SMS', 'FR',
        '${sqlEscape(tpl.body)}'
      )
      ON CONFLICT (bank_id, type, channel, lang) DO NOTHING
    `);
  }
}

/** Insère la config WhatsApp Business du tenant si la config en décrit une (DB-NOTIF). */
async function seedWhatsAppConfig(query: QueryFn, config: TenantSeedConfig): Promise<void> {
  const wa = config.whatsapp;
  if (!wa) return;
  await query(`
    INSERT INTO whatsapp_config (bank_id, business_number, webhook_secret, default_agency_id, enabled)
    VALUES (
      '${config.bankId}', '${sqlEscape(wa.businessNumber)}', '${sqlEscape(wa.webhookSecret)}',
      '${wa.defaultAgencyId}', true
    )
    ON CONFLICT (bank_id) DO NOTHING
  `);
  for (const mapping of wa.menuMappings) {
    const serviceId = tenantServiceId(config.idNamespace, mapping.agencyId, mapping.serviceCode);
    await query(`
      INSERT INTO whatsapp_menu_mapping (bank_id, keyword, service_id)
      VALUES ('${config.bankId}', '${sqlEscape(mapping.keyword)}', '${serviceId}')
      ON CONFLICT (bank_id, keyword) DO NOTHING
    `);
  }
}

/**
 * Affiche les mots de passe des comptes de test à la console (UNE SEULE FOIS).
 *
 * @param config    - Config du tenant (pour le libellé)
 * @param passwords - Map role → password généré
 */
function printSeedPasswords(config: TenantSeedConfig, passwords: Map<string, string>): void {
  if (passwords.size === 0) return;
  console.log("\n╔══════════════════════════════════════════════════════╗");
  console.log(`║  SIGFA SEED [${config.slug}] — Comptes créés (affichés UNE SEULE FOIS)`);
  console.log("╠══════════════════════════════════════════════════════╣");
  for (const [role, password] of passwords) {
    const email = tenantUserEmail(role, config.userEmailDomain);
    console.log(`║  ${role.padEnd(18)} │ ${email.padEnd(40)} │ ${password}`);
  }
  console.log("╚══════════════════════════════════════════════════════╝\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Point d'entrée : seedTenant(config)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Insère un tenant complet décrit par sa config (idempotent, relançable).
 * DB-009 : garde `NODE_ENV !== 'production'` — lève une erreur en production.
 *
 * @param query  - Connexion migrateur (BYPASSRLS)
 * @param config - Config du tenant (voir `./tenants/`)
 */
export async function seedTenant(query: QueryFn, config: TenantSeedConfig): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      `[SIGFA SEED] Le seed de tenant '${config.slug}' est interdit en production ` +
      "(NODE_ENV=production). Retirer SEED_TENANTS/SEED_DEMO ou utiliser NODE_ENV=development."
    );
  }

  await seedBank(query, config);
  await seedAgencies(query, config);

  for (const agency of config.agencies) {
    await seedServices(query, config, agency.id);
    await seedOperations(query, config, agency.id);
  }

  await seedCountersAndKiosks(query, config);

  const passwords = new Map<string, string>();
  for (const role of PERSISTABLE_ROLES) {
    if (role === "SUPER_ADMIN") continue;
    await seedUser(query, config, role, passwords);
  }

  await seedDefaultNotificationTemplates(query, config.bankId);
  await seedWhatsAppConfig(query, config);
  printSeedPasswords(config, passwords);
}
