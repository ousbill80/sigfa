/**
 * DB-008 — Purge « droit à l'oubli » (UEMOA) : anonymisation des téléphones.
 *
 * Deux points d'entrée :
 *   - `purgeExpiredPhones()` : purge AUTOMATIQUE. Anonymise (met à NULL) les
 *     `phone_encrypted`/`phone_hash` des tickets clos depuis plus que la rétention
 *     de la banque (défaut 13 mois) — le ticket agrégé DEMEURE (anonymisation, PAS
 *     suppression) — et ÉRADIQUE (DELETE) les consentements révoqués expirés (PII pur
 *     sans agrégat). Idempotent, horloge injectable.
 *   - `purgePhone(bankId, phone)` : purge MANUELLE (support « droit à l'oubli »).
 *     Anonymise TOUTES les occurrences d'un numéro chez un tenant. Idempotent :
 *     `{ purged: true, affectedTickets: N }` puis `{ purged: false, affectedTickets: 0 }`.
 *
 * Chaque purge écrit une entrée `audit_log` action `DATA_PURGE` — SANS le téléphone
 * en clair : seul un préfixe TRONQUÉ du `phone_hash` (≤ 12 caractères) est consigné,
 * suffisant pour tracer l'opération sans exposer de PII.
 *
 * ## Orchestration
 * L'exécution périodique (cron) de `purgeExpiredPhones()` relève de F6/exploitation —
 * hors périmètre DB-008. Ce module fournit uniquement la logique idempotente.
 *
 * ## Connexion
 * Ces fonctions opèrent à l'échelle système (souvent multi-tenant, hors contexte RLS) :
 * elles s'attendent à recevoir la connexion migrateur (`sigfa_migrator`, BYPASSRLS).
 *
 * @module
 */

import { hashPhone } from "./phone-cipher.js";

/**
 * Type d'une fonction de requête SQL (compatible `DualConnectionHarness.query`).
 * Défini localement pour éviter un import parent (CLAUDE.md §7 — mêmes conventions
 * que `insert-audit-entry.ts` et `upsert-daily-stats.ts`).
 */
export type QueryFn = (sql: string) => Promise<{ rows: Array<Record<string, unknown>> }>;

/** Longueur du préfixe de hash consigné dans l'audit (jamais le hash complet ni le clair). */
const HASH_PREFIX_LENGTH = 12;

/** Options communes de purge. */
export interface PurgeOptions {
  /**
   * Horloge injectable (par défaut `new Date()`). Permet de tester la purge avec une
   * date contrôlée sans dépendre de l'heure système.
   */
  now?: Date;
  /** Acteur (optionnel) déclenchant la purge — consigné dans l'audit. */
  actorId?: string | null;
}

/** Résultat de `purgeExpiredPhones`. */
export interface PurgeExpiredResult {
  /** Nombre de tickets anonymisés (phone_* mis à NULL). */
  anonymizedTickets: number;
  /** Nombre de consentements anonymisés. */
  anonymizedConsents: number;
}

/** Résultat de `purgePhone`. */
export interface PurgePhoneResult {
  /** `true` si au moins une occurrence a été anonymisée à cet appel, `false` sinon (idempotence). */
  purged: boolean;
  /** Nombre de tickets affectés par cette purge. */
  affectedTickets: number;
}

/**
 * Échappe une valeur textuelle SQL (protection anti-injection pour ce helper sans
 * driver paramétré). Les valeurs proviennent de l'API/du système, jamais du client.
 * @param value - Chaîne à échapper
 * @returns Littéral SQL entre quotes
 */
function quote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Écrit une entrée `audit_log` action `DATA_PURGE` sans PII.
 *
 * Consigne uniquement un préfixe tronqué du `phone_hash` (jamais le clair ni le hash
 * complet) plus les compteurs d'occurrences. Insertion directe (connexion migrateur).
 *
 * @param query    - Fonction de requête (migrateur, BYPASSRLS)
 * @param bankId   - Tenant concerné
 * @param diff     - Métadonnées non-PII (compteurs, préfixe de hash tronqué)
 * @param actorId  - Acteur (optionnel)
 */
async function writeDataPurgeAudit(
  query: QueryFn,
  bankId: string,
  diff: Record<string, unknown>,
  actorId: string | null | undefined
): Promise<void> {
  const actorLiteral = actorId === null || actorId === undefined ? "NULL" : quote(actorId);
  await query(`
    INSERT INTO audit_log (bank_id, actor_id, action, entity_type, diff)
    VALUES (
      ${quote(bankId)},
      ${actorLiteral},
      'DATA_PURGE',
      'phone',
      ${quote(JSON.stringify(diff))}::jsonb
    )
  `);
}

/**
 * Purge AUTOMATIQUE : anonymise les téléphones expirés selon la rétention par banque.
 *
 * Pour chaque banque :
 *   - Tickets `closed_at` NOT NULL et antérieurs à `now - retention_months` →
 *     `phone_encrypted`/`phone_hash` mis à NULL (le ticket agrégé demeure) ;
 *   - Consentements `revoked_at` NOT NULL et antérieurs à `now - retention_months` →
 *     ligne supprimée (DELETE — PII pur, aucun agrégat à conserver).
 *
 * La rétention est lue dans `retention_policies` (défaut 13 mois si absente).
 * Idempotent : un second appel n'anonymise rien (les lignes déjà NULL sont exclues).
 * Une entrée `audit_log` DATA_PURGE agrégée (par banque, sans PII) est écrite si des
 * lignes ont été anonymisées.
 *
 * @param query   - Fonction de requête (migrateur, BYPASSRLS)
 * @param options - Options (horloge injectable, acteur)
 * @returns Compteurs d'anonymisation (tickets, consentements)
 */
export async function purgeExpiredPhones(
  query: QueryFn,
  options: PurgeOptions = {}
): Promise<PurgeExpiredResult> {
  const now = options.now ?? new Date();
  const nowLiteral = `${quote(now.toISOString())}::timestamptz`;
  // Expression de rétention : défaut 13 mois si aucune politique pour la banque.
  const retentionExpr = `(
    SELECT COALESCE(
      (SELECT rp.phone_retention_months FROM retention_policies rp WHERE rp.bank_id = t.bank_id),
      13
    )
  )`;

  // ── 1. Tickets clos expirés ─────────────────────────────────────────────────
  const ticketRes = await query(`
    WITH purged AS (
      UPDATE tickets t
      SET phone_encrypted = NULL,
          phone_hash = NULL,
          updated_at = ${nowLiteral}
      WHERE t.closed_at IS NOT NULL
        AND (t.phone_encrypted IS NOT NULL OR t.phone_hash IS NOT NULL)
        AND t.closed_at < (${nowLiteral} - (${retentionExpr} || ' months')::interval)
      RETURNING t.bank_id
    )
    SELECT bank_id, count(*)::int AS n FROM purged GROUP BY bank_id
  `);

  // ── 2. Consentements révoqués expirés ───────────────────────────────────────
  // Le consentement est du PII PUR (phone_encrypted/phone_hash NOT NULL, aucun agrégat
  // à conserver) : la purge l'ÉRADIQUE (DELETE), à la différence du ticket qui garde sa
  // ligne agrégée avec phone_* mis à NULL.
  const consentRes = await query(`
    WITH purged AS (
      DELETE FROM notification_consents c
      WHERE c.revoked_at IS NOT NULL
        AND c.revoked_at < (
          ${nowLiteral} - (
            COALESCE(
              (SELECT rp.phone_retention_months FROM retention_policies rp WHERE rp.bank_id = c.bank_id),
              13
            ) || ' months'
          )::interval
        )
      RETURNING c.bank_id
    )
    SELECT bank_id, count(*)::int AS n FROM purged GROUP BY bank_id
  `);

  // Agréger les compteurs par banque pour l'audit.
  const perBank = new Map<string, { tickets: number; consents: number }>();
  let anonymizedTickets = 0;
  let anonymizedConsents = 0;
  for (const row of ticketRes.rows) {
    const bankId = String(row.bank_id);
    const n = Number(row.n);
    anonymizedTickets += n;
    const entry = perBank.get(bankId) ?? { tickets: 0, consents: 0 };
    entry.tickets += n;
    perBank.set(bankId, entry);
  }
  for (const row of consentRes.rows) {
    const bankId = String(row.bank_id);
    const n = Number(row.n);
    anonymizedConsents += n;
    const entry = perBank.get(bankId) ?? { tickets: 0, consents: 0 };
    entry.consents += n;
    perBank.set(bankId, entry);
  }

  // Une entrée d'audit agrégée par banque (sans PII).
  for (const [bankId, counts] of perBank) {
    await writeDataPurgeAudit(
      query,
      bankId,
      {
        reason: "RETENTION_EXPIRY",
        anonymized_tickets: counts.tickets,
        anonymized_consents: counts.consents,
      },
      options.actorId
    );
  }

  return { anonymizedTickets, anonymizedConsents };
}

/**
 * Purge MANUELLE « droit à l'oubli » : anonymise toutes les occurrences d'un numéro
 * chez un tenant donné.
 *
 * Anonymise (`phone_encrypted`/`phone_hash` → NULL) toutes les lignes de `tickets` et
 * ÉRADIQUE (DELETE) toutes les lignes de `notification_consents` du tenant dont le
 * `phone_hash` correspond au numéro fourni.
 * Idempotent : si aucune occurrence n'existe, retourne
 * `{ purged: false, affectedTickets: 0 }` sans écrire d'audit.
 *
 * Une entrée `audit_log` DATA_PURGE (préfixe de hash tronqué, jamais le clair) est
 * écrite uniquement lorsque des lignes sont effectivement anonymisées.
 *
 * @param query   - Fonction de requête (migrateur, BYPASSRLS)
 * @param bankId  - Tenant concerné
 * @param phone   - Numéro brut (normalisé + haché en interne)
 * @param options - Options (acteur)
 * @returns `{ purged, affectedTickets }`
 * @throws {InvalidPhoneError} Si le numéro n'est pas E.164
 */
export async function purgePhone(
  query: QueryFn,
  bankId: string,
  phone: string,
  options: PurgeOptions = {}
): Promise<PurgePhoneResult> {
  const phoneHash = hashPhone(phone);
  const hashLiteral = quote(phoneHash);
  const bankLiteral = quote(bankId);

  // ── 1. Anonymiser les tickets correspondants ────────────────────────────────
  const ticketRes = await query(`
    WITH purged AS (
      UPDATE tickets t
      SET phone_encrypted = NULL,
          phone_hash = NULL,
          updated_at = now()
      WHERE t.bank_id = ${bankLiteral}
        AND t.phone_hash = ${hashLiteral}
      RETURNING t.id
    )
    SELECT count(*)::int AS n FROM purged
  `);
  const affectedTickets = Number(ticketRes.rows[0]?.n ?? 0);

  // ── 2. Éradiquer les consentements correspondants (PII pur → DELETE) ─────────
  const consentRes = await query(`
    WITH purged AS (
      DELETE FROM notification_consents c
      WHERE c.bank_id = ${bankLiteral}
        AND c.phone_hash = ${hashLiteral}
      RETURNING c.id
    )
    SELECT count(*)::int AS n FROM purged
  `);
  const affectedConsents = Number(consentRes.rows[0]?.n ?? 0);

  const total = affectedTickets + affectedConsents;
  if (total === 0) {
    // Idempotence : rien à purger, aucune entrée d'audit.
    return { purged: false, affectedTickets: 0 };
  }

  // Entrée d'audit : préfixe de hash TRONQUÉ uniquement (jamais le clair ni le hash complet).
  await writeDataPurgeAudit(
    query,
    bankId,
    {
      reason: "RIGHT_TO_ERASURE",
      phone_hash_prefix: phoneHash.slice(0, HASH_PREFIX_LENGTH),
      affected_tickets: affectedTickets,
      affected_consents: affectedConsents,
    },
    options.actorId
  );

  return { purged: true, affectedTickets };
}
