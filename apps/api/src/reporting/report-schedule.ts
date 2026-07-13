/**
 * REP-002 — Logique PURE de planification des rapports auto (fenêtres, cron,
 * périodes, misfire, destinataires). Aucune I/O, aucune horloge cachée : là où le
 * temps est nécessaire, l'instant est INJECTÉ.
 *
 * LA LOI (REP-002) :
 *  - Trois rapports planifiés en cron **fuseau `Africa/Abidjan`** (jamais UTC serveur) :
 *    - **journalier** 18h00 — 1 agence — fenêtre `00:00→18:00` Abidjan du jour civil courant (D confirmée) ;
 *    - **hebdo** lundi 07h00 — réseau — semaine PRÉCÉDENTE (lundi→dimanche Abidjan) ;
 *    - **mensuel** 1er 07h00 — réseau — mois civil PRÉCÉDENT.
 *  - Chaque type dérive ses KPI **exclusivement via REP-001** (aucune formule ici).
 *  - Idempotence : clé `(tenant, reportType, periodKey, recipient)` — `periodKey`
 *    normalisée et stable (`2026-07-12`, `2026-W28`, `2026-07`).
 *  - Misfire : rattrapage UNE SEULE FOIS si le worker était en retard, fenêtre bornée.
 *  - Le payload produit (`ReportPayload`) est aussi la matière du volet PDF (REP-002b).
 *
 * Abidjan = UTC+00 sans DST : la dérivation est explicite (jamais « UTC = Abidjan »
 * codé en dur — robustesse multi-pays UEMOA), toujours via le nom IANA.
 *
 * @module
 */

import { toAbidjanDay, type KpiSet } from "src/reporting/sla-engine.js";
import type { EmailNotificationType } from "src/services/email/email-types.js";

/** Types de rapport planifié (REP-002). */
export const REPORT_TYPES = ["DAILY", "WEEKLY", "MONTHLY"] as const;

/** Type de rapport planifié. */
export type ReportType = (typeof REPORT_TYPES)[number];

/** Portée d'un rapport : `agency` (journalier) ou `network` (hebdo/mensuel). */
export type ReportScope = "agency" | "network";

/** Fuseau de référence SIGFA (unique source de vérité). */
export const ABIDJAN_TZ = "Africa/Abidjan" as const;

// ─────────────────────────────────────────────────────────────────────────────
// 1. Crons (fuseau Africa/Abidjan) & mapping type ↔ email/scope/rôles
// ─────────────────────────────────────────────────────────────────────────────

/** Patterns cron (5 champs `m h dom mon dow`) — INTERPRÉTÉS en fuseau Abidjan. */
export const REPORT_CRONS: Record<ReportType, string> = {
  // Tous les jours à 18h00 Abidjan.
  DAILY: "0 18 * * *",
  // Lundi à 07h00 Abidjan (dow=1).
  WEEKLY: "0 7 * * 1",
  // 1er du mois à 07h00 Abidjan.
  MONTHLY: "0 7 1 * *",
};

/** Mapping type de rapport → type d'email NOTIF-004. */
export const REPORT_EMAIL_TYPE: Record<ReportType, EmailNotificationType> = {
  DAILY: "DAILY_REPORT",
  WEEKLY: "WEEKLY_REPORT",
  MONTHLY: "MONTHLY_REPORT",
};

/** Portée d'un rapport selon son type. */
export const REPORT_SCOPE: Record<ReportType, ReportScope> = {
  DAILY: "agency",
  WEEKLY: "network",
  MONTHLY: "network",
};

/**
 * Rôles destinataires par type de rapport (résolus par tenant/agence via le
 * mécanisme d'abonnement CONTRACT-013 + recipients NOTIF-004).
 *  - DAILY → directeur d'agence.
 *  - WEEKLY → directeur réseau.
 *  - MONTHLY → qualité + COMEX.
 */
export const REPORT_RECIPIENT_ROLES: Record<ReportType, readonly string[]> = {
  DAILY: ["AGENCY_DIRECTOR"],
  WEEKLY: ["NETWORK_DIRECTOR"],
  MONTHLY: ["QUALITY", "COMEX"],
};

// ─────────────────────────────────────────────────────────────────────────────
// 2. Fenêtres de données (jours civils Abidjan) + periodKey normalisée
// ─────────────────────────────────────────────────────────────────────────────

/** Fenêtre de données d'un rapport (jours civils Abidjan, bornes incluses). */
export interface ReportWindow {
  /** Type de rapport. */
  reportType: ReportType;
  /** Premier jour civil Abidjan de la fenêtre (YYYY-MM-DD, inclus). */
  dayStart: string;
  /** Dernier jour civil Abidjan de la fenêtre (YYYY-MM-DD, inclus). */
  dayEnd: string;
  /** Clé de période normalisée et stable (idempotence). */
  periodKey: string;
  /**
   * `true` pour le journalier (fenêtre partielle : le jour courant est arrêté à
   * 18h00, non clos). Sert la mention « données arrêtées à 18h00 ».
   */
  partial: boolean;
}

/** Ajoute `days` jours à un jour civil (`YYYY-MM-DD`), en UTC pur (pas de DST). */
function addDays(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Numéro de jour ISO (1=lundi … 7=dimanche) d'un jour civil `YYYY-MM-DD`. */
function isoDow(day: string): number {
  const dow = new Date(`${day}T00:00:00Z`).getUTCDay(); // 0=dim … 6=sam
  return dow === 0 ? 7 : dow;
}

/**
 * Numéro de semaine ISO 8601 (`{year, week}`) d'un jour civil. La semaine ISO
 * appartient à l'année de son jeudi ; les semaines commencent le lundi.
 */
function isoWeek(day: string): { year: number; week: number } {
  const d = new Date(`${day}T00:00:00Z`);
  // Décale au jeudi de la semaine ISO courante (jeudi = milieu, porte l'année).
  const dow = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  d.setUTCDate(d.getUTCDate() + 4 - dow);
  const year = d.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(year, 0, 4));
  const firstDow =
    firstThursday.getUTCDay() === 0 ? 7 : firstThursday.getUTCDay();
  firstThursday.setUTCDate(firstThursday.getUTCDate() + 4 - firstDow);
  const week =
    1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
  return { year, week };
}

/**
 * Calcule la fenêtre de données d'un rapport à partir de l'instant de déclenchement
 * (converti en jour civil Abidjan). PURE : l'instant est injecté.
 *
 *  - DAILY : le jour civil courant, marqué `partial` (arrêté à 18h00, non clos).
 *  - WEEKLY : la semaine PRÉCÉDENTE (lundi→dimanche) — le déclencheur est un lundi.
 *  - MONTHLY : le mois civil PRÉCÉDENT — le déclencheur est le 1er.
 *
 * @param reportType - Type de rapport
 * @param firedAt    - Instant de déclenchement (horloge injectée)
 * @returns Fenêtre de données (jours Abidjan) + `periodKey` + `partial`
 */
export function computeReportWindow(
  reportType: ReportType,
  firedAt: Date
): ReportWindow {
  const today = toAbidjanDay(firedAt);
  if (reportType === "DAILY") {
    return {
      reportType,
      dayStart: today,
      dayEnd: today,
      periodKey: today,
      partial: true,
    };
  }
  if (reportType === "WEEKLY") {
    // Le déclencheur est un lundi 07h : la semaine précédente est lundi-7 → dimanche-1.
    const dowToday = isoDow(today);
    const thisMonday = addDays(today, -(dowToday - 1));
    const prevMonday = addDays(thisMonday, -7);
    const prevSunday = addDays(prevMonday, 6);
    const { year, week } = isoWeek(prevMonday);
    return {
      reportType,
      dayStart: prevMonday,
      dayEnd: prevSunday,
      periodKey: `${year}-W${String(week).padStart(2, "0")}`,
      partial: false,
    };
  }
  // MONTHLY : mois civil précédent (le déclencheur est le 1er).
  const [y, m] = today.split("-").map(Number) as [number, number];
  const prevMonthYear = m === 1 ? y - 1 : y;
  const prevMonth = m === 1 ? 12 : m - 1;
  const mm = String(prevMonth).padStart(2, "0");
  const dayStart = `${prevMonthYear}-${mm}-01`;
  const lastDay = new Date(Date.UTC(prevMonthYear, prevMonth, 0)).getUTCDate();
  const dayEnd = `${prevMonthYear}-${mm}-${String(lastDay).padStart(2, "0")}`;
  return {
    reportType,
    dayStart,
    dayEnd,
    periodKey: `${prevMonthYear}-${mm}`,
    partial: false,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Payload de rapport (réutilisé par REP-002b PDF) — transport pur
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Payload NORMALISÉ d'un rapport planifié : matière commune de l'email NOTIF-004
 * ET du document PDF REP-002b. Contient les KPI DÉRIVÉS de REP-001 (jamais
 * recalculés ici) + les métadonnées de période. Aucune PII (réseau anonymisé).
 */
export interface ReportPayload {
  /** Tenant — banque (source de vérité D5). */
  bankId: string;
  /** Type de rapport. */
  reportType: ReportType;
  /** Portée (`agency`/`network`). */
  scope: ReportScope;
  /** Agence concernée (`agency` uniquement) ; `null` pour le réseau. */
  agencyId: string | null;
  /** Clé de période normalisée (idempotence + affichage). */
  periodKey: string;
  /** Premier jour civil Abidjan de la fenêtre (inclus). */
  dayStart: string;
  /** Dernier jour civil Abidjan de la fenêtre (inclus). */
  dayEnd: string;
  /** `true` si la fenêtre est partielle (journalier arrêté à 18h00). */
  partial: boolean;
  /** Les 7 KPIs DÉRIVÉS de REP-001 (`computeKpiSet`) — aucun recalcul ici. */
  kpis: KpiSet;
  /** Nombre total de tickets émis sur la fenêtre (issus de l'agrégat REP-001). */
  totalTickets: number;
  /** Nombre d'agences agrégées (réseau) ; `1` pour une agence. */
  agencyCount: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Clé d'idempotence (tenant, reportType, periodKey, recipient)
// ─────────────────────────────────────────────────────────────────────────────

/** Composants de la clé d'idempotence d'un envoi de rapport. */
export interface ReportIdempotencyInput {
  /** Tenant — banque. */
  bankId: string;
  /** Type de rapport. */
  reportType: ReportType;
  /** Clé de période normalisée. */
  periodKey: string;
  /** Destinataire (adresse ou id). */
  recipient: string;
}

/**
 * Construit la clé d'idempotence STABLE d'un envoi de rapport :
 * `(tenant, reportType, periodKey, recipient)`. Un même rapport/période/destinataire
 * produit TOUJOURS la même clé → un seul envoi (garde BullMQ jobId + log unique).
 *
 * @param input - Composants de la clé
 * @returns Clé stable `report:<bank>:<type>:<period>:<recipient>`
 */
export function reportIdempotencyKey(input: ReportIdempotencyInput): string {
  return `report:${input.bankId}:${input.reportType}:${input.periodKey}:${input.recipient}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Misfire : rattrapage UNE SEULE FOIS d'un déclenchement manqué
// ─────────────────────────────────────────────────────────────────────────────

/** Décision de rattrapage misfire (fenêtre bornée). */
export interface MisfireDecision {
  /** `true` si le job doit être rejoué (rattrapage). */
  recover: boolean;
  /** Retard mesuré en millisecondes (déclencheur prévu → maintenant). */
  lateBy: number;
}

/**
 * Décide d'un rattrapage misfire : si le worker a démarré en retard (downtime
 * couvrant l'heure planifiée), on rattrape le déclenchement manqué UNE SEULE FOIS,
 * à condition que le retard reste dans une fenêtre BORNÉE (`graceMs`). Au-delà, on
 * skippe (le rapport de la fenêtre manquée est trop vieux) — l'appelant journalise.
 *
 * L'idempotence (clé `periodKey`/recipient) garantit qu'un rattrapage ne produit
 * JAMAIS de doublon même si le job planifié finit aussi par s'exécuter.
 *
 * @param scheduledAt - Instant planifié du déclenchement manqué
 * @param now         - Instant courant (horloge injectée)
 * @param graceMs     - Fenêtre de rattrapage maximale (ms)
 * @returns `{ recover, lateBy }`
 */
export function decideMisfire(
  scheduledAt: Date,
  now: Date,
  graceMs: number
): MisfireDecision {
  const lateBy = now.getTime() - scheduledAt.getTime();
  // En retard (lateBy > 0) mais dans la fenêtre bornée ⇒ rattrapage unique.
  const recover = lateBy > 0 && lateBy <= graceMs;
  return { recover, lateBy };
}
