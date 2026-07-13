/**
 * render — rendu HTML des gabarits React Email NOTIF-004 (côté serveur `apps/api`).
 *
 * LA LOI (NOTIF-004) :
 *  - Rendu TYPÉ : les props sont d'abord VALIDÉES par Zod (`validateEmailProps`).
 *    Props invalides ⇒ `EmailPropsInvalidError` levée AVANT tout rendu — jamais de
 *    HTML cassé produit (refus d'envoi côté worker).
 *  - FR/EN uniquement. Le sujet est dérivé du type + langue + props.
 *
 * @module
 */

import { render } from "@react-email/render";
import type { JSX } from "react";
import {
  validateEmailProps,
  type EmailLang,
  type EmailNotificationType,
  type ManagerAlertProps,
  type ReportProps,
} from "src/services/email/email-types.js";
import { emailStrings } from "src/services/email/email-i18n.js";
import {
  ManagerAlertEmail,
  DailyReportEmail,
  WeeklyReportEmail,
  MonthlyReportEmail,
} from "src/services/email/templates.js";

/** Résultat d'un rendu : sujet + HTML (prêts pour `EmailMessage`). */
export interface RenderedEmail {
  /** Sujet localisé. */
  subject: string;
  /** Corps HTML rendu (email-safe). */
  html: string;
}

/** Construit l'élément React du gabarit pour un type donné (props déjà validées). */
function elementFor(
  type: EmailNotificationType,
  lang: EmailLang,
  props: ManagerAlertProps | ReportProps
): JSX.Element {
  switch (type) {
    case "MANAGER_ALERT":
      return <ManagerAlertEmail lang={lang} data={props as ManagerAlertProps} />;
    case "DAILY_REPORT":
      return <DailyReportEmail lang={lang} data={props as ReportProps} />;
    case "WEEKLY_REPORT":
      return <WeeklyReportEmail lang={lang} data={props as ReportProps} />;
    case "MONTHLY_REPORT":
      return <MonthlyReportEmail lang={lang} data={props as ReportProps} />;
  }
}

/** Dérive le sujet localisé d'un email à partir du type + props validées. */
function subjectFor(
  type: EmailNotificationType,
  lang: EmailLang,
  props: ManagerAlertProps | ReportProps
): string {
  const t = emailStrings(lang);
  switch (type) {
    case "MANAGER_ALERT": {
      const p = props as ManagerAlertProps;
      return `[${p.severity}] ${t.alertLabel} — ${p.agencyName} : ${p.alertKind}`;
    }
    case "DAILY_REPORT": {
      const p = props as ReportProps;
      return `${t.dailyTitle} — ${p.agencyName} — ${p.periodLabel}`;
    }
    case "WEEKLY_REPORT": {
      const p = props as ReportProps;
      return `${t.weeklyTitle} — ${p.agencyName} — ${p.periodLabel}`;
    }
    case "MONTHLY_REPORT": {
      const p = props as ReportProps;
      return `${t.monthlyTitle} — ${p.agencyName} — ${p.periodLabel}`;
    }
  }
}

/**
 * Valide les props (Zod) puis rend le gabarit React Email en HTML.
 *
 * @param type  - Type d'email interne
 * @param lang  - Langue (FR/EN)
 * @param props - Props candidates (non typées — validées ici)
 * @returns Sujet + HTML rendu
 * @throws {EmailPropsInvalidError} Si les props ne valident pas (aucun HTML rendu)
 */
export async function renderEmail(
  type: EmailNotificationType,
  lang: EmailLang,
  props: unknown
): Promise<RenderedEmail> {
  // 1. Validation Zod AVANT rendu : props invalides ⇒ refus, aucun HTML cassé.
  const validated = validateEmailProps(type, props);
  // 2. Rendu du gabarit typé.
  const element = elementFor(type, lang, validated);
  const html = await render(element, { pretty: false });
  return { subject: subjectFor(type, lang, validated), html };
}
