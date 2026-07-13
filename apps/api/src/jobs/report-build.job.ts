/**
 * REP-002 — Assemblage d'un rapport planifié (logique testable SANS BullMQ).
 *
 * Rôle (orchestration, PAS de calcul, PAS de rendu de document) :
 *  1. **Dérive** les KPI de la fenêtre EXCLUSIVEMENT via REP-001
 *     (`loadAgencyAggregate`/`computeKpiSet`) — zéro formule ici.
 *  2. **Construit** le `ReportPayload` normalisé (matière commune email + PDF REP-002b).
 *  3. **Résout** les destinataires par rôle/agence (via l'abonnement CONTRACT-013 /
 *     recipients NOTIF-004) puis **enfile un envoi email** via NOTIF-004/NOTIF-001,
 *     un job par destinataire, sous clé d'idempotence `(tenant,reportType,periodKey,recipient)`.
 *
 * Le rendu du document (email HTML, PDF « COMEX 1 page ») est HORS de cette story
 * (REP-002b, agent-web) : ici on prépare les PROPS de rapport (transport pur).
 *
 * Garde tenant D5 : le `bankId` du job est la source de vérité ; toute lecture DB
 * passe par la `QueryFn` sous `withTenant` (recipients) ou filtre `bank_id` explicite.
 *
 * @module
 */

import type { QueryFn as DbQueryFn } from "@sigfa/database";
import {
  loadAgencyAggregate,
  mapRowToAggregate,
  type QueryFn as ReportQueryFn,
  type DailyStatsRow,
} from "src/reporting/aggregate-service.js";
import {
  computeKpiSet,
  sumAggregates,
  type DailyStatsAggregate,
  type KpiSet,
} from "src/reporting/sla-engine.js";
import {
  computeReportWindow,
  reportIdempotencyKey,
  REPORT_EMAIL_TYPE,
  REPORT_SCOPE,
  REPORT_RECIPIENT_ROLES,
  type ReportType,
  type ReportPayload,
} from "src/reporting/report-schedule.js";
import { resolveInternalRecipients } from "src/services/email/recipients.js";
import type { EmailNotificationType } from "src/services/email/email-types.js";

/**
 * Un envoi de rapport prêt à enfiler : la ligne `notification_log` (QUEUED) est
 * créée par le producteur, et le job porte la clé d'idempotence en `dedupeKey`.
 */
export interface ReportEmailEnqueue {
  /** Tenant — banque. */
  bankId: string;
  /** Type d'email NOTIF-004 (`DAILY_REPORT`/`WEEKLY_REPORT`/`MONTHLY_REPORT`). */
  emailType: EmailNotificationType;
  /** Destinataire interne résolu (adresse). */
  recipient: string;
  /** Clé d'idempotence `(tenant,reportType,periodKey,recipient)` (= jobId BullMQ). */
  dedupeKey: string;
  /** Agence de contexte (`agency` uniquement) ; `null` pour le réseau. */
  agencyId: string | null;
}

/** Fonction d'enfilement d'un envoi email de rapport (branchée sur NOTIF-004/NOTIF-001). */
export type EnqueueReportEmailFn = (
  enqueue: ReportEmailEnqueue,
  payload: ReportPayload
) => Promise<void>;

/** Résout les agences d'un tenant (portée `agency` = une agence par envoi). */
export type ListAgenciesFn = (
  bankId: string
) => Promise<string[]>;

/** Dépendances de l'assemblage d'un rapport. */
export interface BuildReportDeps {
  /**
   * Requête SQL PARAMÉTRÉE (`(sql, values?)`) pour les lectures d'agrégats REP-001
   * (DB-009 : valeurs en paramètres positionnels, aucune interpolation).
   */
  reportQuery: ReportQueryFn;
  /**
   * Requête SQL applicative single-arg (`@sigfa/database`) pour la résolution des
   * destinataires sous garde tenant D5 (`withTenant`).
   */
  recipientsQuery: DbQueryFn;
  /** Résout les agences du tenant (portée agency). */
  listAgencies: ListAgenciesFn;
  /** Enfile l'envoi email d'un rapport (NOTIF-004/NOTIF-001). */
  enqueueReportEmail: EnqueueReportEmailFn;
  /** Journalise un événement d'orchestration (skip, alerte). */
  log?: (event: ReportJobLog) => void;
}

/** Événement d'orchestration journalisé (skip destinataire, misfire, etc.). */
export interface ReportJobLog {
  /** Niveau. */
  level: "info" | "warn";
  /** Message. */
  message: string;
  /** Contexte structuré. */
  context: Record<string, unknown>;
}

/** Résultat de l'assemblage d'un rapport (pour l'observabilité/tests). */
export interface BuildReportResult {
  /** Type de rapport. */
  reportType: ReportType;
  /** Clé de période. */
  periodKey: string;
  /** Nombre de payloads construits (1 par agence en `agency`, 1 en `network`). */
  payloadsBuilt: number;
  /** Nombre d'envois email enfilés (1 par destinataire résolu). */
  emailsEnqueued: number;
  /** Payloads produits (réutilisables par REP-002b PDF). */
  payloads: ReportPayload[];
}

/**
 * Charge l'agrégat RÉSEAU (toutes agences du tenant) sur la fenêtre et le nombre
 * d'agences distinctes contributrices — anonymisé (aucun `agency_id` exposé au
 * payload réseau, cf. `AnonymizedNetworkAggregate` CONTRACT-006).
 *
 * @param query    - Requête reporting (paramétrée)
 * @param bankId   - Tenant
 * @param dayStart - Jour Abidjan de début (inclus)
 * @param dayEnd   - Jour Abidjan de fin (inclus)
 * @returns Agrégat sommé réseau + nombre d'agences distinctes
 */
async function loadNetworkAggregate(
  query: ReportQueryFn,
  bankId: string,
  dayStart: string,
  dayEnd: string
): Promise<{ aggregate: DailyStatsAggregate; agencyCount: number }> {
  const res = await query(
    `SELECT tickets_issued, tickets_served, tickets_abandoned, tickets_no_show,
            total_wait_seconds, total_service_seconds, sla_met_count, sla_total_count,
            feedback_count, nps_promoters, nps_passives, nps_detractors,
            agent_active_seconds, agent_available_seconds, agency_id
       FROM daily_agency_stats
      WHERE bank_id = $1 AND service_id IS NULL
        AND day >= $2::date AND day <= $3::date`,
    [bankId, dayStart, dayEnd]
  );
  const rows = res.rows as Array<Record<string, unknown>>;
  const aggregate = sumAggregates(
    rows.map((r) => mapRowToAggregate(r as unknown as DailyStatsRow))
  );
  const agencyCount = new Set(rows.map((r) => String(r["agency_id"]))).size;
  return { aggregate, agencyCount };
}

/** Construit le `ReportPayload` d'une agence (portée `agency`). */
async function buildAgencyPayload(
  query: ReportQueryFn,
  bankId: string,
  agencyId: string,
  reportType: ReportType,
  window: ReturnType<typeof computeReportWindow>
): Promise<ReportPayload> {
  const aggregate = await loadAgencyAggregate(
    query,
    bankId,
    agencyId,
    window.dayStart,
    window.dayEnd
  );
  return {
    bankId,
    reportType,
    scope: "agency",
    agencyId,
    periodKey: window.periodKey,
    dayStart: window.dayStart,
    dayEnd: window.dayEnd,
    partial: window.partial,
    kpis: computeKpiSet(aggregate),
    totalTickets: aggregate.ticketsIssued,
    agencyCount: 1,
  };
}

/** Construit le `ReportPayload` réseau anonymisé (portée `network`). */
async function buildNetworkPayload(
  query: ReportQueryFn,
  bankId: string,
  reportType: ReportType,
  window: ReturnType<typeof computeReportWindow>
): Promise<ReportPayload> {
  const { aggregate, agencyCount } = await loadNetworkAggregate(
    query,
    bankId,
    window.dayStart,
    window.dayEnd
  );
  // Anonymisation STRUCTURELLE : le payload réseau ne porte QUE la somme des
  // agrégats (aucun nom d'agent, aucun `agency_id`, aucune PII), conformément à
  // `AnonymizedNetworkAggregate` (CONTRACT-006).
  return {
    bankId,
    reportType,
    scope: "network",
    agencyId: null,
    periodKey: window.periodKey,
    dayStart: window.dayStart,
    dayEnd: window.dayEnd,
    partial: window.partial,
    kpis: computeKpiSet(aggregate),
    totalTickets: aggregate.ticketsIssued,
    agencyCount,
  };
}

/**
 * Enfile un envoi email de rapport par DESTINATAIRE résolu (rôle/agence), sous clé
 * d'idempotence `(tenant,reportType,periodKey,recipient)`. Zéro destinataire ⇒ on
 * ne jette PAS : le rapport est simplement non distribué (journalisé), jamais un
 * échec silencieux du planificateur.
 *
 * @returns Nombre d'envois enfilés
 */
async function enqueueForRecipients(
  deps: BuildReportDeps,
  reportType: ReportType,
  payload: ReportPayload
): Promise<number> {
  const roles = REPORT_RECIPIENT_ROLES[reportType];
  const recipients = await resolveInternalRecipients(deps.recipientsQuery, {
    bankId: payload.bankId,
    roles,
    agencyId: payload.agencyId ?? null,
  });
  if (recipients.length === 0) {
    deps.log?.({
      level: "warn",
      message: "Rapport planifié sans destinataire résolu — non distribué.",
      context: {
        bankId: payload.bankId,
        reportType,
        periodKey: payload.periodKey,
        roles,
        agencyId: payload.agencyId,
      },
    });
    return 0;
  }
  const emailType = REPORT_EMAIL_TYPE[reportType];
  let enqueued = 0;
  for (const recipient of recipients) {
    const dedupeKey = reportIdempotencyKey({
      bankId: payload.bankId,
      reportType,
      periodKey: payload.periodKey,
      recipient,
    });
    await deps.enqueueReportEmail(
      {
        bankId: payload.bankId,
        emailType,
        recipient,
        dedupeKey,
        agencyId: payload.agencyId,
      },
      payload
    );
    enqueued += 1;
  }
  return enqueued;
}

/**
 * Assemble et enfile un rapport planifié pour un tenant à un instant donné.
 *
 * Étapes :
 *  1. Calcule la fenêtre de données Abidjan + `periodKey` (`computeReportWindow`).
 *  2. Portée `agency` (journalier) : un payload PAR agence du tenant.
 *     Portée `network` (hebdo/mensuel) : UN payload agrégé anonymisé.
 *  3. Pour chaque payload, résout les destinataires par rôle/agence puis enfile
 *     un envoi email idempotent par destinataire.
 *
 * @param reportType - Type de rapport
 * @param bankId     - Tenant (source de vérité D5)
 * @param firedAt    - Instant de déclenchement (horloge injectée)
 * @param deps       - queryFn, résolveur d'agences, enfileur email, log
 * @returns Compteurs + payloads construits (réutilisables par REP-002b)
 */
export async function buildAndEnqueueReport(
  reportType: ReportType,
  bankId: string,
  firedAt: Date,
  deps: BuildReportDeps
): Promise<BuildReportResult> {
  const query = deps.reportQuery;
  const window = computeReportWindow(reportType, firedAt);
  const scope = REPORT_SCOPE[reportType];

  const payloads: ReportPayload[] = [];
  if (scope === "agency") {
    const agencies = await deps.listAgencies(bankId);
    for (const agencyId of agencies) {
      payloads.push(
        await buildAgencyPayload(query, bankId, agencyId, reportType, window)
      );
    }
  } else {
    payloads.push(await buildNetworkPayload(query, bankId, reportType, window));
  }

  let emailsEnqueued = 0;
  for (const payload of payloads) {
    emailsEnqueued += await enqueueForRecipients(deps, reportType, payload);
  }

  return {
    reportType,
    periodKey: window.periodKey,
    payloadsBuilt: payloads.length,
    emailsEnqueued,
    payloads,
  };
}

export type { KpiSet };
