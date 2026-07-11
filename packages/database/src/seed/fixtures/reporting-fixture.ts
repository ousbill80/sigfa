/**
 * DB-006 — Fixture déterministe pour les tests de reporting.
 *
 * Contient des tickets DONE/ABANDONED/NO_SHOW avec durées et feedbacks FIXÉS,
 * ainsi que des entrées d'historique agent, permettant de valider que les valeurs
 * calculées par `upsertDailyStats` correspondent exactement aux valeurs attendues.
 *
 * ## Principe de la fixture
 * - Toutes les valeurs sont DÉTERMINISTES (pas de Date.now(), pas de random())
 * - Les UUIDs sont fixes et reproductibles
 * - Les valeurs attendues (`EXPECTED_STATS`) sont calculées manuellement et exportées
 *   pour que les tests puissent les comparer directement
 *
 * ## Tickets de test (day = 2026-07-01, timezone Africa/Abidjan = UTC+0 en juillet)
 *
 * | # | Status    | wait_s | service_s | feedback | NPS cat  | SLA (15min=900s) |
 * |---|-----------|--------|-----------|----------|----------|-----------------|
 * | 1 | DONE      | 300    | 600       | 5        | promoter | met (300 < 900)  |
 * | 2 | DONE      | 600    | 480       | 4        | passive  | met (600 < 900)  |
 * | 3 | DONE      | 1200   | 360       | 2        | detract  | miss (1200>900)  |
 * | 4 | DONE      | 450    | 720       | null     | —        | met (450 < 900)  |
 * | 5 | ABANDONED | null   | null      | null     | —        | —                |
 * | 6 | NO_SHOW   | null   | null      | null     | —        | —                |
 *
 * ## Valeurs attendues (EXPECTED_STATS)
 * - tickets_issued    = 6  (tous les tickets du jour)
 * - tickets_served    = 4  (status DONE)
 * - tickets_abandoned = 1  (status ABANDONED)
 * - tickets_no_show   = 1  (status NO_SHOW)
 * - total_wait_s      = 300 + 600 + 1200 + 450 = 2550
 * - total_service_s   = 600 + 480 + 360 + 720 = 2160
 * - sla_met_count     = 3  (tickets 1, 2, 4)
 * - sla_total_count   = 4  (tous les DONE)
 * - feedback_count    = 3  (tickets 1, 2, 3)
 * - feedback_sum      = 5 + 4 + 2 = 11
 * - nps_promoters     = 1  (ticket 1 : score 5)
 * - nps_passives      = 1  (ticket 2 : score 4)
 * - nps_detractors    = 1  (ticket 3 : score ≤ 3)
 *
 * @module
 */

// ─────────────────────────────────────────────────────────────────────────────
// Types internes de la fixture
// ─────────────────────────────────────────────────────────────────────────────

/** Ticket de fixture pour les tests de reporting. */
export interface FixtureTicket {
  id: string;
  number: number;
  trackingId: string;
  channel: "KIOSK" | "QR" | "MOBILE" | "WHATSAPP";
  status: "WAITING" | "CALLED" | "SERVING" | "DONE" | "NO_SHOW" | "ABANDONED" | "TRANSFERRED";
  issuedAt: string;
  calledAt: string | null;
  servedAt: string | null;
  closedAt: string | null;
  noShowAt: string | null;
  waitTimeSeconds: number | null;
  serviceTimeSeconds: number | null;
  feedbackScore: number | null;
  counterId: string | null;
  agentId: string | null;
}

/** Entrée d'historique de statut agent pour les tests de reporting. */
export interface FixtureAgentStatusEntry {
  id: string;
  fromStatus: "AVAILABLE" | "SERVING" | "PAUSED" | "ABSENT" | "OFFLINE" | null;
  toStatus: "AVAILABLE" | "SERVING" | "PAUSED" | "ABSENT" | "OFFLINE";
  changedAt: string;
}

/** Structure de la fixture complète. */
export interface ReportingFixture {
  tickets: FixtureTicket[];
  agentStatusHistory: FixtureAgentStatusEntry[];
}

/** Valeurs attendues après upsertDailyStats sur la fixture. */
export interface ExpectedStats {
  ticketsIssued: number;
  ticketsServed: number;
  ticketsAbandoned: number;
  ticketsNoShow: number;
  totalWaitSeconds: number;
  totalServiceSeconds: number;
  slaMetCount: number;
  slaTotalCount: number;
  feedbackCount: number;
  feedbackSum: number;
  npsPromoters: number;
  npsPassives: number;
  npsDetractors: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constantes
// ─────────────────────────────────────────────────────────────────────────────

/** Jour de test (Africa/Abidjan = UTC+0 en juillet, donc 2026-07-01 UTC = 2026-07-01 local). */
export const FIXTURE_DAY = "2026-07-01";

/** UUIDs fixes pour les entités de test (rattachés par le test d'intégration). */
const COUNTER_ID_TEST = "ffffffff-0006-4000-8000-000000000005";
const AGENT_ID_TEST = "ffffffff-0006-4000-8000-000000000006";

// ─────────────────────────────────────────────────────────────────────────────
// Fixture principale
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fixture déterministe pour les tests de reporting.
 *
 * Les tickets ont été construits pour couvrir tous les statuts pertinents
 * (DONE, ABANDONED, NO_SHOW) et toutes les catégories NPS (promoteur, passif, détracteur).
 *
 * **IMPORTANT** : Les `issued_at` sont tous dans la journée du 2026-07-01 en UTC
 * (Africa/Abidjan = UTC+0 en juillet), garantissant que `issued_day = '2026-07-01'`.
 */
export const REPORTING_FIXTURE: ReportingFixture = {
  tickets: [
    // Ticket 1 : DONE, SLA met, NPS promoteur (score 5)
    {
      id: "f0000001-0006-4000-8000-000000000001",
      number: 1,
      trackingId: "RPT001AAAAAAAAAAAA", // char(21)
      channel: "KIOSK",
      status: "DONE",
      issuedAt: "2026-07-01T08:00:00Z",
      calledAt: "2026-07-01T08:05:00Z",
      servedAt: "2026-07-01T08:10:00Z",
      closedAt: "2026-07-01T08:20:00Z",
      noShowAt: null,
      waitTimeSeconds: 300,      // 5 min d'attente (SLA met : 300 < 900)
      serviceTimeSeconds: 600,   // 10 min de service
      feedbackScore: 5,          // promoteur NPS
      counterId: COUNTER_ID_TEST,
      agentId: AGENT_ID_TEST,
    },
    // Ticket 2 : DONE, SLA met, NPS passif (score 4)
    {
      id: "f0000001-0006-4000-8000-000000000002",
      number: 2,
      trackingId: "RPT002AAAAAAAAAAAA",
      channel: "KIOSK",
      status: "DONE",
      issuedAt: "2026-07-01T08:30:00Z",
      calledAt: "2026-07-01T08:40:00Z",
      servedAt: "2026-07-01T08:50:00Z",
      closedAt: "2026-07-01T08:58:00Z",
      noShowAt: null,
      waitTimeSeconds: 600,      // 10 min d'attente (SLA met : 600 < 900)
      serviceTimeSeconds: 480,   // 8 min de service
      feedbackScore: 4,          // passif NPS
      counterId: COUNTER_ID_TEST,
      agentId: AGENT_ID_TEST,
    },
    // Ticket 3 : DONE, SLA missed, NPS détracteur (score 2)
    {
      id: "f0000001-0006-4000-8000-000000000003",
      number: 3,
      trackingId: "RPT003AAAAAAAAAAAA",
      channel: "QR",
      status: "DONE",
      issuedAt: "2026-07-01T09:00:00Z",
      calledAt: "2026-07-01T09:20:00Z",
      servedAt: "2026-07-01T09:35:00Z",
      closedAt: "2026-07-01T09:41:00Z",
      noShowAt: null,
      waitTimeSeconds: 1200,     // 20 min d'attente (SLA missed : 1200 > 900)
      serviceTimeSeconds: 360,   // 6 min de service
      feedbackScore: 2,          // détracteur NPS
      counterId: COUNTER_ID_TEST,
      agentId: AGENT_ID_TEST,
    },
    // Ticket 4 : DONE, SLA met, pas de feedback
    {
      id: "f0000001-0006-4000-8000-000000000004",
      number: 4,
      trackingId: "RPT004AAAAAAAAAAAA",
      channel: "MOBILE",
      status: "DONE",
      issuedAt: "2026-07-01T10:00:00Z",
      calledAt: "2026-07-01T10:07:30Z",
      servedAt: "2026-07-01T10:15:00Z",
      closedAt: "2026-07-01T10:27:00Z",
      noShowAt: null,
      waitTimeSeconds: 450,      // 7.5 min d'attente (SLA met : 450 < 900)
      serviceTimeSeconds: 720,   // 12 min de service
      feedbackScore: null,       // pas de feedback
      counterId: COUNTER_ID_TEST,
      agentId: AGENT_ID_TEST,
    },
    // Ticket 5 : ABANDONED
    {
      id: "f0000001-0006-4000-8000-000000000005",
      number: 5,
      trackingId: "RPT005AAAAAAAAAAAA",
      channel: "KIOSK",
      status: "ABANDONED",
      issuedAt: "2026-07-01T11:00:00Z",
      calledAt: null,
      servedAt: null,
      closedAt: null,
      noShowAt: null,
      waitTimeSeconds: null,
      serviceTimeSeconds: null,
      feedbackScore: null,
      counterId: null,
      agentId: null,
    },
    // Ticket 6 : NO_SHOW
    {
      id: "f0000001-0006-4000-8000-000000000006",
      number: 6,
      trackingId: "RPT006AAAAAAAAAAAA",
      channel: "KIOSK",
      status: "NO_SHOW",
      issuedAt: "2026-07-01T11:30:00Z",
      calledAt: "2026-07-01T11:45:00Z",
      servedAt: null,
      closedAt: null,
      noShowAt: "2026-07-01T11:50:00Z",
      waitTimeSeconds: null,
      serviceTimeSeconds: null,
      feedbackScore: null,
      counterId: null,
      agentId: null,
    },
  ],
  agentStatusHistory: [
    // L'agent commence à travailler (OFFLINE → AVAILABLE) à 8h
    {
      id: "a0000001-0006-4000-8000-000000000001",
      fromStatus: null,
      toStatus: "AVAILABLE",
      changedAt: "2026-07-01T08:00:00Z",
    },
    // Pause à 12h (AVAILABLE → PAUSED)
    {
      id: "a0000001-0006-4000-8000-000000000002",
      fromStatus: "AVAILABLE",
      toStatus: "PAUSED",
      changedAt: "2026-07-01T12:00:00Z",
    },
    // Retour de pause (PAUSED → AVAILABLE)
    {
      id: "a0000001-0006-4000-8000-000000000003",
      fromStatus: "PAUSED",
      toStatus: "AVAILABLE",
      changedAt: "2026-07-01T13:00:00Z",
    },
    // Fin de journée (AVAILABLE → OFFLINE)
    {
      id: "a0000001-0006-4000-8000-000000000004",
      fromStatus: "AVAILABLE",
      toStatus: "OFFLINE",
      changedAt: "2026-07-01T17:00:00Z",
    },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Valeurs attendues (calculées manuellement depuis la fixture)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Valeurs exactes attendues après `upsertDailyStats(FIXTURE_DAY, agencyId)`.
 *
 * Ces valeurs sont calculées manuellement depuis `REPORTING_FIXTURE.tickets`
 * et exportées pour être utilisées dans les assertions des tests d'intégration.
 *
 * Vérification :
 * - tickets_issued    = 6 (tous les 6 tickets du jour)
 * - tickets_served    = 4 (tickets 1, 2, 3, 4 — status DONE)
 * - tickets_abandoned = 1 (ticket 5 — status ABANDONED)
 * - tickets_no_show   = 1 (ticket 6 — status NO_SHOW)
 * - total_wait_s      = 300 + 600 + 1200 + 450 = 2550
 * - total_service_s   = 600 + 480 + 360 + 720 = 2160
 * - sla_met_count     = 3 (tickets 1[300<900], 2[600<900], 4[450<900])
 * - sla_total_count   = 4 (tous les DONE)
 * - feedback_count    = 3 (tickets 1, 2, 3)
 * - feedback_sum      = 5 + 4 + 2 = 11
 * - nps_promoters     = 1 (ticket 1 : score 5)
 * - nps_passives      = 1 (ticket 2 : score 4)
 * - nps_detractors    = 1 (ticket 3 : score 2 ≤ 3)
 */
export const EXPECTED_STATS: ExpectedStats = {
  ticketsIssued: 6,
  ticketsServed: 4,
  ticketsAbandoned: 1,
  ticketsNoShow: 1,
  totalWaitSeconds: 2550,     // 300 + 600 + 1200 + 450
  totalServiceSeconds: 2160,  // 600 + 480 + 360 + 720
  slaMetCount: 3,
  slaTotalCount: 4,
  feedbackCount: 3,
  feedbackSum: 11,            // 5 + 4 + 2
  npsPromoters: 1,
  npsPassives: 1,
  npsDetractors: 1,
};
