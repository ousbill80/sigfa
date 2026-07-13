/**
 * IA-001 — Calendrier Côte d'Ivoire (fonctions PURES, déterministes).
 *
 * Dérive, par jour civil Abidjan (`YYYY-MM-DD`), les indicateurs calendaires
 * consommés par le pipeline de features d'affluence :
 *  - `is_month_end`       : l'un des 3 derniers jours OUVRÉS du mois (lun–ven) ;
 *  - `is_public_pay_day`  : fenêtre paie fonction publique (paramétrable/banque,
 *                           défaut du jour 25 au dernier jour du mois) ;
 *  - `is_public_holiday`  : jour férié CI (jeu fourni — seed DB-003) ;
 *  - `is_eve_of_holiday`  : veille d'un jour férié CI ;
 *  - `day_of_week`        : 0 = dimanche … 6 = samedi (heure locale Abidjan) ;
 *  - `factors`            : sous-ensemble de `ContextualFactor` (CONTRACT-008)
 *                           déclenchés ce jour-là, libellés EXACTS de l'énum.
 *
 * ## Libellés = énumération CONTRACT-008 (LA LOI)
 * `ContextualFactor` reproduit à l'identique l'énum de `ai.yaml` (CONTRACT-008)
 * et du schéma DB-007 (`contextual_factor`). On ne dépend pas d'un import de type
 * cross-package (skew zod D8) : la constante `CONTEXTUAL_FACTORS` est vérifiée
 * structurellement par les tests contre l'énum de LA LOI.
 *
 * ## Zéro I/O, zéro horloge cachée, zéro PII
 * Le jeu de jours fériés (`holidays: ReadonlySet<string>`) est INJECTÉ (source =
 * seed `public_holidays`, DB-003). Aucune valeur n'est recalculée « à la main » à
 * partir d'une horloge système : le pipeline passe un jeu déjà chargé.
 *
 * ## Abidjan = UTC+00 sans DST
 * Un jour civil `YYYY-MM-DD` est manipulé comme une date sans fuseau (arithmétique
 * en UTC pur), ce qui est exact pour Africa/Abidjan (pas de changement d'heure).
 *
 * @module
 */

/**
 * Énumération EXACTE des facteurs contextuels de LA LOI (CONTRACT-008
 * `ContextualFactor`, miroir du pgEnum `contextual_factor` DB-007).
 */
export const CONTEXTUAL_FACTORS = [
  "END_OF_MONTH",
  "CIVIL_SERVICE_PAY",
  "PUBLIC_HOLIDAY",
  "SCHOOL_START",
  "NONE",
] as const;

/** Facteur contextuel de LA LOI (CONTRACT-008 `ContextualFactor`). */
export type ContextualFactor = (typeof CONTEXTUAL_FACTORS)[number];

/** Regex d'un jour civil `YYYY-MM-DD`. */
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Paramètres de la fenêtre de paie fonction publique (paramétrable par banque).
 *
 * Défaut métier (CONTRACT-008 / IA-001) : du jour **25** au **dernier jour du
 * mois** inclus. `payDayStart` peut être remonté/abaissé par banque ; la fin de
 * fenêtre est toujours le dernier jour du mois.
 */
export interface PayDayConfig {
  /** Premier jour (du mois) de la fenêtre paie, inclus. Défaut 25. Borné [1, 31]. */
  readonly payDayStart: number;
}

/** Configuration paie par défaut (jour 25 → fin de mois). */
export const DEFAULT_PAY_DAY_CONFIG: PayDayConfig = { payDayStart: 25 };

/** Indicateurs calendaires d'un jour (tous déterministes). */
export interface CalendarFlags {
  /** Jour civil Abidjan `YYYY-MM-DD`. */
  readonly day: string;
  /** 0 = dimanche … 6 = samedi. */
  readonly dayOfWeek: number;
  /** L'un des 3 derniers jours OUVRÉS (lun–ven) du mois. */
  readonly isMonthEnd: boolean;
  /** Dans la fenêtre paie fonction publique (défaut 25 → fin de mois). */
  readonly isPublicPayDay: boolean;
  /** Jour férié CI (présent dans le jeu injecté). */
  readonly isPublicHoliday: boolean;
  /** Veille d'un jour férié CI. */
  readonly isEveOfHoliday: boolean;
  /**
   * Facteurs contextuels CONTRACT-008 déclenchés ce jour (libellés EXACTS).
   * `["NONE"]` si aucun facteur exceptionnel.
   */
  readonly factors: readonly ContextualFactor[];
}

/** Décompose un `YYYY-MM-DD` valide en `{ year, month, day }`. Lève si invalide. */
function parseDay(day: string): { year: number; month: number; day: number } {
  const m = DAY_RE.exec(day);
  if (!m) throw new Error(`ci-calendar: jour civil invalide « ${day} » (attendu YYYY-MM-DD)`);
  const year = Number(m[1]);
  const month = Number(m[2]);
  const dom = Number(m[3]);
  if (month < 1 || month > 12) throw new Error(`ci-calendar: mois invalide dans « ${day} »`);
  if (dom < 1 || dom > lastDayOfMonth(year, month)) {
    throw new Error(`ci-calendar: jour du mois invalide dans « ${day} »`);
  }
  return { year, month, day: dom };
}

/** Dernier jour d'un mois (gère les bissextiles), en UTC pur. */
function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Formate `YYYY-MM-DD` à partir de composants numériques. */
function fmt(year: number, month: number, day: number): string {
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

/** Jour de la semaine (0 = dim … 6 = sam) d'un jour civil Abidjan (UTC pur). */
export function dayOfWeek(day: string): number {
  const { year, month, day: dom } = parseDay(day);
  return new Date(Date.UTC(year, month - 1, dom)).getUTCDay();
}

/** `true` si `dow` (0=dim..6=sam) est un jour ouvré (lundi–vendredi). */
function isWeekday(dow: number): boolean {
  return dow >= 1 && dow <= 5;
}

/**
 * Retourne les `count` derniers jours OUVRÉS (lun–ven) d'un mois, en `YYYY-MM-DD`.
 * On remonte depuis le dernier jour calendaire du mois et on collecte les jours
 * ouvrés jusqu'à en avoir `count`.
 */
function lastBusinessDays(year: number, month: number, count = 3): Set<string> {
  const result = new Set<string>();
  let dom = lastDayOfMonth(year, month);
  while (dom >= 1 && result.size < count) {
    const dow = new Date(Date.UTC(year, month - 1, dom)).getUTCDay();
    if (isWeekday(dow)) result.add(fmt(year, month, dom));
    dom -= 1;
  }
  return result;
}

/** Jour civil précédent (J-1) d'un `YYYY-MM-DD` (UTC pur). */
export function previousDay(day: string): string {
  const { year, month, day: dom } = parseDay(day);
  const d = new Date(Date.UTC(year, month - 1, dom));
  d.setUTCDate(d.getUTCDate() - 1);
  return fmt(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/** Jour civil suivant (J+1) d'un `YYYY-MM-DD` (UTC pur). */
export function nextDay(day: string): string {
  const { year, month, day: dom } = parseDay(day);
  const d = new Date(Date.UTC(year, month - 1, dom));
  d.setUTCDate(d.getUTCDate() + 1);
  return fmt(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/**
 * Calcule les indicateurs calendaires d'un jour civil Abidjan.
 *
 * @param day      - Jour civil `YYYY-MM-DD`
 * @param holidays - Jeu de jours fériés CI (`YYYY-MM-DD`), source seed DB-003 (injecté)
 * @param payCfg   - Config paie fonction publique (défaut : jour 25 → fin de mois)
 * @returns Indicateurs + facteurs contextuels (libellés CONTRACT-008 exacts)
 */
export function calendarFlags(
  day: string,
  holidays: ReadonlySet<string>,
  payCfg: PayDayConfig = DEFAULT_PAY_DAY_CONFIG
): CalendarFlags {
  const { year, month, day: dom } = parseDay(day);
  const dow = new Date(Date.UTC(year, month - 1, dom)).getUTCDay();

  const monthEndDays = lastBusinessDays(year, month);
  const isMonthEnd = monthEndDays.has(day);

  const payStart = Math.min(Math.max(payCfg.payDayStart, 1), 31);
  const isPublicPayDay = dom >= payStart && dom <= lastDayOfMonth(year, month);

  const isPublicHoliday = holidays.has(day);
  const isEveOfHoliday = holidays.has(nextDay(day));

  const factors: ContextualFactor[] = [];
  if (isMonthEnd) factors.push("END_OF_MONTH");
  if (isPublicPayDay) factors.push("CIVIL_SERVICE_PAY");
  if (isPublicHoliday || isEveOfHoliday) factors.push("PUBLIC_HOLIDAY");

  return {
    day,
    dayOfWeek: dow,
    isMonthEnd,
    isPublicPayDay,
    isPublicHoliday,
    isEveOfHoliday,
    factors: factors.length > 0 ? factors : ["NONE"],
  };
}
