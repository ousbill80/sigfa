/**
 * email-types — types + schémas Zod des e-mails internes NOTIF-004.
 *
 * LA LOI (NOTIF-004) :
 *  - 4 types d'email internes : `MANAGER_ALERT`, `DAILY_REPORT`, `WEEKLY_REPORT`,
 *    `MONTHLY_REPORT` (LA LOI `NotificationType`, additifs CONTRACT-013).
 *  - Chaque type a des **props TYPÉES validées par Zod** : le worker REFUSE
 *    d'envoyer si les props ne valident pas, plutôt que de rendre un HTML cassé.
 *  - Langues FR/EN UNIQUEMENT (MEMORY — Dioula/Baoulé retirés).
 *  - **Transport pur** : le CONTENU métier des rapports (KPI, agrégats) vient de
 *    F7 (REP-002). Ici les props sont un conteneur de valeurs déjà calculées.
 *
 * @module
 */

import { z } from "zod";

/** Langues supportées par les gabarits email (FR/EN uniquement — MEMORY). */
export const EMAIL_LANGS = ["FR", "EN"] as const;

/** Langue d'un email interne. */
export type EmailLang = (typeof EMAIL_LANGS)[number];

/** Schéma Zod de la langue. */
export const emailLangSchema = z.enum(EMAIL_LANGS);

/** Types d'email interne de NOTIF-004 (sous-ensemble `NotificationType`). */
export const EMAIL_NOTIFICATION_TYPES = [
  "MANAGER_ALERT",
  "DAILY_REPORT",
  "WEEKLY_REPORT",
  "MONTHLY_REPORT",
] as const;

/** Type d'email interne. */
export type EmailNotificationType = (typeof EMAIL_NOTIFICATION_TYPES)[number];

/** Schéma Zod du type d'email. */
export const emailNotificationTypeSchema = z.enum(EMAIL_NOTIFICATION_TYPES);

// ─────────────────────────────────────────────────────────────────────────────
// Props par type — VALIDÉES par Zod avant rendu (refus si invalide)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Props d'une alerte manager (MANAGER_ALERT). `metric`/`threshold` déjà calculés
 * par le producteur (API-007) — transport pur.
 */
export const managerAlertPropsSchema = z.object({
  /** Nom de la banque (habillage). */
  bankName: z.string().min(1),
  /** Nom de l'agence concernée. */
  agencyName: z.string().min(1),
  /** Sous-type d'alerte (ex. SLA_BREACH, AGENT_INACTIVE, KIOSK_SILENT). */
  alertKind: z.string().min(1),
  /** Message lisible décrivant l'alerte (déjà localisé par le producteur si besoin). */
  message: z.string().min(1),
  /** Horodatage ISO 8601 de l'alerte. */
  occurredAt: z.string().min(1),
  /** Sévérité indicative (affichage). */
  severity: z.enum(["INFO", "WARNING", "CRITICAL"]),
});

/** Props d'une alerte manager. */
export type ManagerAlertProps = z.infer<typeof managerAlertPropsSchema>;

/** Une ligne de KPI de rapport (libellé + valeur déjà formatée par F7). */
export const reportKpiSchema = z.object({
  /** Libellé du KPI (ex. « Tickets servis »). */
  label: z.string().min(1),
  /** Valeur déjà formatée (ex. « 1 240 », « 87 % »). */
  value: z.string().min(1),
});

/** Props communes aux rapports (DAILY/WEEKLY/MONTHLY). */
const reportBaseShape = {
  /** Nom de la banque. */
  bankName: z.string().min(1),
  /** Nom de l'agence (ou « Toutes agences »). */
  agencyName: z.string().min(1),
  /** Clé de période normalisée (ex. `2026-07-12`, `2026-W28`, `2026-07`). */
  periodKey: z.string().min(1),
  /** Libellé lisible de la période (ex. « 12 juillet 2026 »). */
  periodLabel: z.string().min(1),
  /** KPIs pré-calculés (F7/REP-002 — transport pur, aucun calcul ici). */
  kpis: z.array(reportKpiSchema).min(1),
  /**
   * Lien signé de pièce jointe (repli hors limite Resend). `null` si la pièce a
   * pu être jointe en ligne ou s'il n'y a pas de pièce jointe.
   */
  attachmentSignedUrl: z.string().url().nullable(),
} as const;

/** Props d'un rapport journalier. */
export const dailyReportPropsSchema = z.object(reportBaseShape);
/** Props d'un rapport hebdomadaire. */
export const weeklyReportPropsSchema = z.object(reportBaseShape);
/** Props d'un rapport mensuel. */
export const monthlyReportPropsSchema = z.object(reportBaseShape);

/** Props d'un rapport (structure commune). */
export type ReportProps = z.infer<typeof dailyReportPropsSchema>;

/** Map type → schéma Zod des props. */
export const EMAIL_PROPS_SCHEMAS = {
  MANAGER_ALERT: managerAlertPropsSchema,
  DAILY_REPORT: dailyReportPropsSchema,
  WEEKLY_REPORT: weeklyReportPropsSchema,
  MONTHLY_REPORT: monthlyReportPropsSchema,
} as const satisfies Record<EmailNotificationType, z.ZodType>;

/** Union discriminée des props par type (pour le typage du rendu). */
export type EmailPropsByType = {
  MANAGER_ALERT: ManagerAlertProps;
  DAILY_REPORT: ReportProps;
  WEEKLY_REPORT: ReportProps;
  MONTHLY_REPORT: ReportProps;
};

/** Erreur de validation des props d'un email (refus d'envoi, aucun HTML cassé). */
export class EmailPropsInvalidError extends Error {
  /** Détail des erreurs Zod (jamais de HTML rendu à partir de props invalides). */
  readonly issues: z.core.$ZodIssue[];
  constructor(type: EmailNotificationType, issues: z.core.$ZodIssue[]) {
    super(`Props invalides pour l'email ${type} — rendu refusé.`);
    this.name = "EmailPropsInvalidError";
    this.issues = issues;
  }
}

/**
 * Valide les props d'un type d'email. Lève `EmailPropsInvalidError` si invalides —
 * garantit qu'aucun HTML n'est rendu à partir de props cassées (LA LOI).
 *
 * @param type  - Type d'email
 * @param props - Props candidates (non typées)
 * @returns Props validées et typées
 * @throws {EmailPropsInvalidError} Si la validation Zod échoue
 */
export function validateEmailProps<T extends EmailNotificationType>(
  type: T,
  props: unknown
): EmailPropsByType[T] {
  const schema = EMAIL_PROPS_SCHEMAS[type];
  const result = schema.safeParse(props);
  if (!result.success) {
    throw new EmailPropsInvalidError(type, result.error.issues);
  }
  return result.data as EmailPropsByType[T];
}
