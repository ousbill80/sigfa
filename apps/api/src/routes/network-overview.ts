/**
 * Route de supervision réseau cross-tenant — NET-001-API (reporting.yaml
 * `GET /admin/network-overview`, CONTRACT-006/013).
 *
 * SURFACE LA PLUS SENSIBLE du produit : l'UNIQUE lecture cross-tenant du SIGFA.
 * Réservée au `SUPER_ADMIN` (scope `platform`, `bank_id IS NULL`). Le RBAC middleware
 * garantit déjà l'accès exclusif SUPER_ADMIN (BANK_ADMIN/AUDITOR/MANAGER/AGENT → 403).
 *
 * GARANTIES (LA LOI) :
 *  1. ALLOW-LIST STRICTE — la réponse ne contient QUE des agrégats/compteurs
 *     (`network-overview-allowlist.ts`, construction additive). JAMAIS de PII client
 *     (phone/tracking_id/feedback/display_number), JAMAIS de contenu métier d'une
 *     banque. Un `bankId` opaque + `bankLabel` commercial + des compteurs.
 *  2. LECTURE SEULE ABSOLUE — toute mutation (POST/PATCH/PUT/DELETE) sur ce périmètre
 *     platform → 403 `PLATFORM_READ_ONLY`. Il n'existe AUCUNE route d'écriture
 *     cross-tenant (hors-scope DÉFINITIF).
 *  3. AUDIT CROSS-TENANT — chaque lecture écrit une entrée `audit_log` immuable
 *     `PLATFORM_READ` (scope CROSS_TENANT) PAR BANQUE lue : la lecture cross-tenant
 *     est un événement audité au même titre qu'une mutation sensible (DB-004/SEC-001).
 *     `audit_log.bank_id` étant NOT NULL, l'attribution par banque garantit qu'un
 *     AUDITOR de la banque X voit dans SON journal que la plateforme a lu ses agrégats.
 *
 * Accès DB via `withPlatform` (connexion plateforme, `bankId` non requis) : jamais de
 * `SET app.current_bank_id`, jamais de contournement de la RLS d'écriture tenant.
 *
 * @module
 */

import { Hono } from "hono";
import type { Client } from "pg";
import type { Redis } from "ioredis";
import { withPlatform } from "@sigfa/database";
import type { TenantContext } from "src/middleware/tenant.js";
import { errorResponse } from "src/lib/admin-helpers.js";
import { SigfaError, buildError } from "src/lib/errors.js";
import { recordAudit, extractIp } from "src/lib/audit-context.js";
import {
  toBankAggregate,
  toNetworkAggregate,
  toNetworkOverview,
  type RawBankAggregate,
  type RawNetworkAggregate,
} from "src/lib/network-overview-allowlist.js";
import { KIOSK_SILENT_THRESHOLD_S } from "src/config/kiosk.js";

/** Variables de contexte Hono du routeur network-overview. */
interface NetworkOverviewEnv {
  Variables: {
    db: Client;
    redis: Redis;
    jwtSecret: Uint8Array;
    tenant: TenantContext;
  };
}

/** Ligne brute d'agrégation par banque (jamais de PII : compteurs uniquement). */
interface BankAggregateRow {
  bank_id: string;
  bank_label: string;
  agency_count: number;
  kiosks_online: number;
  kiosks_offline: number;
  total_tickets: number;
}

/** Ligne brute d'agrégation réseau global (compteurs/moyennes uniquement). */
interface NetworkAggregateRow {
  total_tickets: number;
  agency_count: number;
  bank_count: number;
}

/** Méthodes de MUTATION refusées sur le périmètre platform (lecture seule). */
const MUTATION_METHODS: readonly string[] = ["POST", "PATCH", "PUT", "DELETE"];

/**
 * Crée le routeur de supervision réseau cross-tenant (monté sous /api/v1).
 *
 * @returns Routeur Hono de `GET /admin/network-overview` (+ gardes lecture seule)
 */
export function createNetworkOverviewRouter(): Hono<NetworkOverviewEnv> {
  const router = new Hono<NetworkOverviewEnv>();

  router.get("/admin/network-overview", async (c) => {
    const db = c.get("db");
    const tenant = c.get("tenant");
    try {
      // Défense route-level : la route n'est JAMAIS rabaissée à un rôle tenant.
      // Le RBAC middleware autorise déjà SUPER_ADMIN, mais AUDITOR (lecture seule
      // ORTHOGONALE) satisferait une route en lecture. Ici l'accès cross-tenant est
      // réservé au SEUL SUPER_ADMIN (`bank_id IS NULL`) — tout autre rôle → 403.
      assertSuperAdmin(tenant);
      const period = parsePeriodOrCurrent(c.req.query("period"));
      // Accès cross-tenant EXCLUSIVEMENT via la connexion plateforme (API-002) :
      // `withPlatform` matérialise la frontière (aucun `SET app.current_bank_id`,
      // aucun contournement RLS d'écriture). Les requêtes paramétrées passent par
      // `db` capturé dans la clôture (la `QueryFn` de `withPlatform` reste la marque
      // de périmètre plateforme, jamais utilisée pour une requête tenant-scopée).
      const overview = await withPlatform(
        (sql) =>
          db.query(sql) as unknown as Promise<{ rows: Record<string, unknown>[] }>,
        async () =>
          buildOverview(
            (sql, params) =>
              db.query(sql, params as unknown[]) as unknown as Promise<{
                rows: unknown[];
              }>,
            period
          )
      );
      // AUDIT cross-tenant : une entrée PLATFORM_READ immuable PAR banque lue.
      await auditCrossTenantRead(db, tenant, overview.bankIds, extractIp(c));
      return c.json(overview.body, 200);
    } catch (err) {
      return errorResponse(c, err);
    }
  });

  // LECTURE SEULE ABSOLUE : toute mutation sur le périmètre platform → 403
  // PLATFORM_READ_ONLY. Il n'existe AUCUNE route d'écriture cross-tenant.
  for (const method of MUTATION_METHODS) {
    router.on(method, "/admin/network-overview", (c) =>
      c.json(
        buildError(
          "PLATFORM_READ_ONLY",
          "Le périmètre plateforme est en lecture seule : aucune mutation cross-tenant n'est autorisée."
        ),
        403
      )
    );
  }

  return router;
}

/** Fonction de requête paramétrée (adaptée à `withPlatform`). */
type PlatformQuery = (
  sql: string,
  params?: readonly unknown[]
) => Promise<{ rows: unknown[] }>;

/** Résultat interne : corps de réponse (allow-list) + ids des banques lues (audit). */
interface OverviewResult {
  body: Record<string, unknown>;
  bankIds: string[];
}

/**
 * Construit la vue réseau : agrégats par banque + agrégat global, sérialisés en
 * allow-list stricte (zéro PII). Les compteurs de bornes ONLINE/OFFLINE réutilisent
 * le seuil de silence de la supervision borne (ADM-003).
 *
 * @param query  - Fonction de requête plateforme (cross-banques)
 * @param period - Période analysée (YYYY-MM)
 * @returns Corps de réponse + ids des banques lues
 */
async function buildOverview(
  query: PlatformQuery,
  period: string
): Promise<OverviewResult> {
  const perBankRows = (
    await query(PER_BANK_SQL, [String(KIOSK_SILENT_THRESHOLD_S), period])
  ).rows as BankAggregateRow[];
  const networkRow = (
    (await query(NETWORK_SQL, [period])).rows as NetworkAggregateRow[]
  )[0];

  const banks = perBankRows.map((row) => toBankAggregate(toRawBank(row)));
  const aggregate = toNetworkAggregate(toRawNetwork(networkRow, perBankRows.length));
  const body = toNetworkOverview(period, aggregate, banks, new Date());
  return { body, bankIds: perBankRows.map((r) => r.bank_id) };
}

/** Projette une ligne SQL vers l'entrée brute d'agrégat banque (compteurs). */
function toRawBank(row: BankAggregateRow): RawBankAggregate {
  return {
    bankId: row.bank_id,
    bankLabel: row.bank_label,
    agencyCount: Number(row.agency_count),
    kiosksOnline: Number(row.kiosks_online),
    kiosksOffline: Number(row.kiosks_offline),
    totalTickets: Number(row.total_tickets),
  };
}

/**
 * Projette la ligne réseau vers l'agrégat brut global. Les moyennes de temps
 * (TMA/TMT/…) ne sont pas encore alimentées par cette route (compteurs d'abord,
 * additif au contrat) : 0 par défaut, borné par la sérialisation allow-list.
 *
 * @param row       - Ligne réseau agrégée
 * @param bankCount - Nombre de banques contribuant
 * @returns Agrégat brut réseau
 */
function toRawNetwork(
  row: NetworkAggregateRow | undefined,
  bankCount: number
): RawNetworkAggregate {
  return {
    totalTickets: row ? Number(row.total_tickets) : 0,
    avgTma: 0,
    avgTmt: 0,
    avgTts: 0,
    avgTauxAbandon: 0,
    avgTauxSLA: 0,
    avgOccupation: 0,
    agencyCount: row ? Number(row.agency_count) : 0,
    bankCount: row ? Number(row.bank_count) : bankCount,
  };
}

/**
 * Écrit une entrée `audit_log` immuable `PLATFORM_READ` (scope CROSS_TENANT) PAR
 * banque lue. Aucune banque lue (réseau vide) → aucune lecture cross-tenant, donc
 * aucune entrée. Le `diff` porte le scope + la ressource (jamais de PII).
 *
 * @param db       - Connexion PG (plateforme)
 * @param tenant   - Contexte SUPER_ADMIN (acteur)
 * @param bankIds  - Banques dont les agrégats ont été lus
 * @param ip       - IP réelle de l'acteur (XFF durci)
 */
async function auditCrossTenantRead(
  db: Client,
  tenant: TenantContext,
  bankIds: string[],
  ip: string | null
): Promise<void> {
  for (const bankId of bankIds) {
    await recordAudit({
      db,
      // L'entrée est attribuée à la banque LUE (audit_log.bank_id NOT NULL) ; l'acteur
      // reste le SUPER_ADMIN plateforme (actorId/role du tenant courant).
      tenant: { ...tenant, bankId },
      action: "PLATFORM_READ",
      entityType: "network",
      entityId: bankId,
      ip,
      diff: { scope: "CROSS_TENANT", resource: "GET /admin/network-overview" },
    });
  }
}

/**
 * Garde route-level : l'accès cross-tenant est réservé au SEUL SUPER_ADMIN plateforme
 * (`bank_id IS NULL`). Refuse tout autre rôle (y compris AUDITOR, lecture seule
 * orthogonale qui satisferait autrement une route en lecture) → 403 FORBIDDEN. La
 * route n'est JAMAIS rabaissée à un rôle tenant (exigence EARS NET-001).
 *
 * @param tenant - Contexte tenant courant
 * @throws {SigfaError} 403 si le rôle n'est pas SUPER_ADMIN ou si un bankId est présent
 */
export function assertSuperAdmin(tenant: TenantContext): void {
  if (tenant.role !== "SUPER_ADMIN" || tenant.bankId !== null) {
    throw new SigfaError(
      "FORBIDDEN",
      "Console réseau réservée au SUPER_ADMIN plateforme.",
      403
    );
  }
}

/**
 * Valide le paramètre `period` (YYYY-MM) ou renvoie le mois courant (UTC) par défaut.
 *
 * @param period - Query param brut (optionnel)
 * @returns Période normalisée YYYY-MM
 * @throws {SigfaError} 400 si `period` est fourni mais malformé
 */
export function parsePeriodOrCurrent(period: string | undefined): string {
  if (period === undefined || period === "") {
    const now = new Date();
    return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  }
  if (!/^\d{4}-\d{2}$/.test(period)) {
    throw new SigfaError(
      "VALIDATION_ERROR",
      "Paramètre `period` invalide (format attendu : YYYY-MM).",
      400
    );
  }
  const month = Number(period.slice(5, 7));
  if (month < 1 || month > 12) {
    throw new SigfaError("VALIDATION_ERROR", "Mois invalide dans `period`.", 400);
  }
  return period;
}

/**
 * SQL d'agrégation PAR BANQUE (allow-list : uniquement des compteurs). `$1` = seuil
 * de silence borne (secondes), `$2` = période YYYY-MM. Une borne est OFFLINE si
 * `last_seen` est NULL ou antérieur à `NOW() - seuil` (cohérent ADM-003). Les tickets
 * sont comptés sur le mois de la période. AUCUNE colonne PII n'est projetée.
 */
const PER_BANK_SQL = `
  SELECT
    b.id AS bank_id,
    b.name AS bank_label,
    COUNT(DISTINCT ag.id) AS agency_count,
    COUNT(DISTINCT k.id) FILTER (
      WHERE k.last_seen IS NOT NULL
        AND k.last_seen >= NOW() - ($1 || ' seconds')::interval
    ) AS kiosks_online,
    COUNT(DISTINCT k.id) FILTER (
      WHERE k.last_seen IS NULL
        OR k.last_seen < NOW() - ($1 || ' seconds')::interval
    ) AS kiosks_offline,
    COUNT(DISTINCT t.id) FILTER (
      WHERE to_char(t.issued_at, 'YYYY-MM') = $2
    ) AS total_tickets
  FROM banks b
  LEFT JOIN agencies ag ON ag.bank_id = b.id AND ag.deleted_at IS NULL
  LEFT JOIN kiosks k ON k.bank_id = b.id
  LEFT JOIN tickets t ON t.bank_id = b.id
  WHERE b.deleted_at IS NULL
  GROUP BY b.id, b.name
  ORDER BY b.created_at ASC
`;

/**
 * SQL d'agrégation RÉSEAU global (totaux/compteurs). `$1` = période YYYY-MM. Aucune
 * PII : uniquement des comptages. Les moyennes de temps (TMA/…) sont additives et
 * non alimentées par cette requête (0 par la sérialisation).
 */
const NETWORK_SQL = `
  SELECT
    (SELECT COUNT(*) FROM tickets t WHERE to_char(t.issued_at, 'YYYY-MM') = $1) AS total_tickets,
    (SELECT COUNT(*) FROM agencies ag WHERE ag.deleted_at IS NULL) AS agency_count,
    (SELECT COUNT(*) FROM banks b WHERE b.deleted_at IS NULL) AS bank_count
`;
