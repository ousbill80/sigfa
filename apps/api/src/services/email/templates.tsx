/**
 * templates — gabarits React Email (JSX) des e-mails internes NOTIF-004.
 *
 * LA LOI (NOTIF-004) :
 *  - 4 gabarits TYPÉS rendus côté serveur (`apps/api`) : `MANAGER_ALERT`,
 *    `DAILY_REPORT`, `WEEKLY_REPORT`, `MONTHLY_REPORT`.
 *  - FR/EN uniquement (MEMORY). Aucun calcul métier : les props portent des valeurs
 *    déjà calculées par F7/REP-002 (transport pur).
 *  - Le repli pièce jointe hors limite (lien signé TTL 24 h) s'affiche comme un
 *    bouton de téléchargement dans le corps quand `attachmentSignedUrl` est présent.
 *
 * Les composants sont PURS (props → JSX) ; le rendu HTML (snapshot FR/EN) est
 * délégué à `render.ts`.
 *
 * @module
 */

import {
  Html,
  Head,
  Body,
  Container,
  Section,
  Heading,
  Text,
  Button,
  Hr,
  Preview,
} from "@react-email/components";
import type { JSX, ReactNode } from "react";
import type {
  EmailLang,
  ManagerAlertProps,
  ReportProps,
} from "src/services/email/email-types.js";
import { emailStrings } from "src/services/email/email-i18n.js";

/** Styles inline email-safe (aucun token en dur exposé ailleurs — chrome de transport). */
const styles = {
  body: { backgroundColor: "#f4f4f5", fontFamily: "Arial, sans-serif", margin: 0 },
  container: {
    backgroundColor: "#ffffff",
    margin: "0 auto",
    padding: "24px",
    maxWidth: "600px",
  },
  heading: { fontSize: "20px", fontWeight: 700, color: "#111827", margin: "0 0 8px" },
  label: { fontSize: "12px", color: "#6b7280", margin: "8px 0 0", textTransform: "uppercase" as const },
  value: { fontSize: "14px", color: "#111827", margin: "2px 0 0" },
  kpiLabel: { fontSize: "13px", color: "#374151", margin: 0 },
  kpiValue: { fontSize: "16px", fontWeight: 700, color: "#111827", margin: "0 0 8px" },
  button: {
    backgroundColor: "#111827",
    color: "#ffffff",
    borderRadius: "6px",
    padding: "10px 18px",
    fontSize: "14px",
    textDecoration: "none",
    display: "inline-block",
  },
  footer: { fontSize: "11px", color: "#9ca3af", margin: "16px 0 0" },
  bank: { fontSize: "13px", color: "#6b7280", margin: "0 0 12px" },
} as const;

/** Enveloppe commune des gabarits (Html/Head/Body/Container). */
function Layout(props: {
  lang: EmailLang;
  preview: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <Html lang={props.lang.toLowerCase()}>
      <Head />
      <Preview>{props.preview}</Preview>
      <Body style={styles.body}>
        <Container style={styles.container}>{props.children}</Container>
      </Body>
    </Html>
  );
}

/** Bloc pied de page interne (rappelle que l'email est destiné au staff). */
function InternalFooter(props: { lang: EmailLang }): JSX.Element {
  const t = emailStrings(props.lang);
  return (
    <>
      <Hr />
      <Text style={styles.footer}>{t.internalFooter}</Text>
    </>
  );
}

/** Gabarit d'alerte manager (MANAGER_ALERT). */
export function ManagerAlertEmail(props: {
  lang: EmailLang;
  data: ManagerAlertProps;
}): JSX.Element {
  const t = emailStrings(props.lang);
  const { data } = props;
  return (
    <Layout lang={props.lang} preview={`${t.alertLabel}: ${data.alertKind}`}>
      <Text style={styles.bank}>{data.bankName}</Text>
      <Heading style={styles.heading}>
        {t.alertLabel} — {data.alertKind}
      </Heading>
      <Text style={styles.value}>{data.message}</Text>
      <Text style={styles.label}>{t.agencyLabel}</Text>
      <Text style={styles.value}>{data.agencyName}</Text>
      <Text style={styles.label}>{t.severityLabel}</Text>
      <Text style={styles.value}>{data.severity}</Text>
      <Text style={styles.label}>{t.occurredAtLabel}</Text>
      <Text style={styles.value}>{data.occurredAt}</Text>
      <InternalFooter lang={props.lang} />
    </Layout>
  );
}

/** Bloc rapport commun (DAILY/WEEKLY/MONTHLY) — titre + période + KPIs + pièce jointe. */
function ReportEmail(props: {
  lang: EmailLang;
  title: string;
  data: ReportProps;
}): JSX.Element {
  const t = emailStrings(props.lang);
  const { data } = props;
  return (
    <Layout lang={props.lang} preview={`${props.title} — ${data.periodLabel}`}>
      <Text style={styles.bank}>{data.bankName}</Text>
      <Heading style={styles.heading}>{props.title}</Heading>
      <Text style={styles.label}>{t.agencyLabel}</Text>
      <Text style={styles.value}>{data.agencyName}</Text>
      <Text style={styles.label}>{t.periodLabel}</Text>
      <Text style={styles.value}>{data.periodLabel}</Text>
      <Hr />
      <Section>
        {data.kpis.map((kpi) => (
          <div key={kpi.label}>
            <Text style={styles.kpiLabel}>{kpi.label}</Text>
            <Text style={styles.kpiValue}>{kpi.value}</Text>
          </div>
        ))}
      </Section>
      {data.attachmentSignedUrl ? (
        <Section>
          <Button style={styles.button} href={data.attachmentSignedUrl}>
            {t.downloadAttachment}
          </Button>
          <Text style={styles.footer}>{t.linkValidity}</Text>
        </Section>
      ) : null}
      <InternalFooter lang={props.lang} />
    </Layout>
  );
}

/** Gabarit rapport journalier (DAILY_REPORT). */
export function DailyReportEmail(props: {
  lang: EmailLang;
  data: ReportProps;
}): JSX.Element {
  return (
    <ReportEmail lang={props.lang} title={emailStrings(props.lang).dailyTitle} data={props.data} />
  );
}

/** Gabarit rapport hebdomadaire (WEEKLY_REPORT). */
export function WeeklyReportEmail(props: {
  lang: EmailLang;
  data: ReportProps;
}): JSX.Element {
  return (
    <ReportEmail lang={props.lang} title={emailStrings(props.lang).weeklyTitle} data={props.data} />
  );
}

/** Gabarit rapport mensuel (MONTHLY_REPORT). */
export function MonthlyReportEmail(props: {
  lang: EmailLang;
  data: ReportProps;
}): JSX.Element {
  return (
    <ReportEmail lang={props.lang} title={emailStrings(props.lang).monthlyTitle} data={props.data} />
  );
}
