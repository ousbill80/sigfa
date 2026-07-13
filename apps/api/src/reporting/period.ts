/**
 * REP-001 — Parseur de période reporting (fonction PURE, jour civil Abidjan).
 *
 * Traduit une chaîne ISO 8601 acceptée par CONTRACT-006
 * (`YYYY`, `YYYY-MM`, `YYYY-Qn`, `YYYY-MM-DD`) en bornes de **jours civils
 * Abidjan** `[dayStart, dayEnd]` (bornes incluses) + une `periodKey` normalisée
 * (clé d'idempotence des rapports). Aucune horloge, aucune I/O.
 *
 * @module
 */

/** Bornes d'une période exprimées en jours civils Abidjan (incluses). */
export interface PeriodBounds {
  /** Premier jour civil Abidjan de la période (YYYY-MM-DD, inclus). */
  dayStart: string;
  /** Dernier jour civil Abidjan de la période (YYYY-MM-DD, inclus). */
  dayEnd: string;
  /** Clé de période normalisée et stable (idempotence). */
  periodKey: string;
}

/** Formate année/mois/jour en `YYYY-MM-DD`. */
function ymd(year: number, month: number, day: number): string {
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

/** Dernier jour d'un mois (gère les années bissextiles). */
function lastDayOfMonth(year: number, month: number): number {
  // Le jour 0 du mois suivant = dernier jour du mois courant (UTC pour éviter tout DST).
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Analyse `YYYY-MM-DD` (jour unique). Retourne `null` si la date est invalide. */
function parseDay(period: string): PeriodBounds | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(period);
  if (!m) return null;
  const [, y, mo, d] = m;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > lastDayOfMonth(year, month)) return null;
  const key = ymd(year, month, day);
  return { dayStart: key, dayEnd: key, periodKey: key };
}

/** Analyse `YYYY-MM` (mois). Retourne `null` si le mois est invalide. */
function parseMonth(period: string): PeriodBounds | null {
  const m = /^(\d{4})-(\d{2})$/.exec(period);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return {
    dayStart: ymd(year, month, 1),
    dayEnd: ymd(year, month, lastDayOfMonth(year, month)),
    periodKey: `${m[1]}-${m[2]}`,
  };
}

/** Analyse `YYYY-Qn` (trimestre). Retourne `null` si le trimestre est invalide. */
function parseQuarter(period: string): PeriodBounds | null {
  const m = /^(\d{4})-Q([1-4])$/.exec(period);
  if (!m) return null;
  const year = Number(m[1]);
  const quarter = Number(m[2]);
  const startMonth = (quarter - 1) * 3 + 1;
  const endMonth = startMonth + 2;
  return {
    dayStart: ymd(year, startMonth, 1),
    dayEnd: ymd(year, endMonth, lastDayOfMonth(year, endMonth)),
    periodKey: `${m[1]}-Q${m[2]}`,
  };
}

/** Analyse `YYYY` (année). */
function parseYear(period: string): PeriodBounds | null {
  const m = /^(\d{4})$/.exec(period);
  if (!m) return null;
  const y = m[1] as string;
  return { dayStart: `${y}-01-01`, dayEnd: `${y}-12-31`, periodKey: y };
}

/**
 * Analyse une chaîne de période ISO 8601 en bornes de jours civils Abidjan.
 *
 * Formats acceptés (les plus spécifiques d'abord) :
 * - `YYYY-MM-DD` — un jour
 * - `YYYY-Qn`    — un trimestre (n ∈ 1..4)
 * - `YYYY-MM`    — un mois
 * - `YYYY`       — une année
 *
 * @param period - Chaîne de période
 * @returns Bornes + `periodKey`, ou `null` si le format/valeur est invalide
 */
export function parsePeriod(period: string): PeriodBounds | null {
  return (
    parseDay(period) ??
    parseQuarter(period) ??
    parseMonth(period) ??
    parseYear(period)
  );
}
