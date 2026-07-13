/**
 * REP-002b — Gabarits de DOCUMENTS PDF (`@react-pdf/renderer`, A4 portrait) des
 * rapports SIGFA. Rendu PUR : props (view-model + thème) → document. Aucun calcul
 * métier, aucune I/O. FR/EN + theming tenant (habillage, jamais structure).
 *
 * Trois formes :
 *  - journalier (directeur d'agence) : entête tenant + KPIs détaillés ;
 *  - hebdo (réseau) : agrégats anonymisés (aucun nom d'agent) ;
 *  - mensuel qualité + **page COMEX 1 page** (densité contrôlée, 3 KPIs stratégiques).
 *
 * Le mensuel produit DEUX pages : une page qualité détaillée + une page COMEX. Le
 * COMEX seul (`ComexDocument`) est un document 1 page, testé pour non-débordement.
 *
 * @module
 */

import {
  Document,
  Page,
  View,
  Text,
  Image,
  StyleSheet,
} from "@react-pdf/renderer";
import type { JSX } from "react";
import type { ResolvedPdfTheme } from "src/reporting/pdf/theme.js";
import type { ReportViewModel } from "src/reporting/pdf/report-view-model.js";
import { pdfStrings, type PdfLang } from "src/reporting/pdf/pdf-i18n.js";

/** Props communes des gabarits : modèle d'affichage + thème + langue. */
export interface ReportDocumentProps {
  /** Modèle d'affichage projeté du payload (view-model). */
  view: ReportViewModel;
  /** Thème tenant résolu (couleurs + identité). */
  theme: ResolvedPdfTheme;
  /** Langue du document (FR/EN). */
  lang: PdfLang;
}

/**
 * Feuille de styles paramétrée par le thème (couleurs INJECTÉES — jamais de valeur
 * de marque en dur). La STRUCTURE (tailles, marges) est fixe ; seul l'habillage
 * (couleurs, logo) varie par tenant.
 */
function makeStyles(theme: ResolvedPdfTheme) {
  return StyleSheet.create({
    page: {
      backgroundColor: theme.pageBackground,
      color: theme.text,
      paddingTop: 32,
      paddingBottom: 40,
      paddingHorizontal: 40,
      fontSize: 11,
      fontFamily: "Helvetica",
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      backgroundColor: theme.brand,
      color: theme.onBrand,
      paddingVertical: 14,
      paddingHorizontal: 18,
      borderRadius: 6,
    },
    headerText: { color: theme.onBrand },
    logo: { width: 90, height: 28, objectFit: "contain" },
    bankName: { fontSize: 16, fontFamily: "Helvetica-Bold", color: theme.onBrand },
    title: { fontSize: 13, marginTop: 2, color: theme.onBrand },
    metaRow: { flexDirection: "row", marginTop: 18, flexWrap: "wrap" },
    metaItem: { width: "33%", marginBottom: 8 },
    metaLabel: { fontSize: 9, color: theme.muted, textTransform: "uppercase" },
    metaValue: { fontSize: 12, fontFamily: "Helvetica-Bold", color: theme.text, marginTop: 2 },
    partial: { fontSize: 9, color: theme.muted, marginTop: 4, fontStyle: "italic" },
    sectionTitle: {
      fontSize: 12,
      fontFamily: "Helvetica-Bold",
      color: theme.text,
      marginTop: 18,
      marginBottom: 8,
    },
    kpiRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      paddingVertical: 7,
      borderBottomWidth: 1,
      borderBottomColor: theme.surface,
    },
    kpiLabel: { fontSize: 11, color: theme.text },
    kpiValue: { fontSize: 11, fontFamily: "Helvetica-Bold", color: theme.text },
    footer: {
      position: "absolute",
      bottom: 20,
      left: 40,
      right: 40,
      fontSize: 8,
      color: theme.muted,
      textAlign: "center",
    },
    // COMEX — densité contrôlée pour tenir sur 1 page.
    comexHero: { marginTop: 8, marginBottom: 12 },
    comexTitle: { fontSize: 18, fontFamily: "Helvetica-Bold", color: theme.text },
    comexSubtitle: { fontSize: 11, color: theme.muted, marginTop: 2 },
    comexCards: { flexDirection: "row", justifyContent: "space-between", marginTop: 10 },
    comexCard: {
      width: "31%",
      backgroundColor: theme.surface,
      borderRadius: 6,
      padding: 14,
    },
    comexCardLabel: { fontSize: 10, color: theme.muted },
    comexCardValue: {
      fontSize: 22,
      fontFamily: "Helvetica-Bold",
      color: theme.brand,
      marginTop: 6,
    },
  });
}

/** En-tête de marque (logo optionnel + nom banque + titre du document). */
function BrandHeader(props: {
  theme: ResolvedPdfTheme;
  view: ReportViewModel;
  styles: ReturnType<typeof makeStyles>;
}): JSX.Element {
  const { theme, view, styles } = props;
  return (
    <View style={styles.header}>
      <View>
        <Text style={styles.bankName}>{theme.bankName}</Text>
        <Text style={styles.title}>{view.title}</Text>
      </View>
      {theme.logoSrc ? <Image style={styles.logo} src={theme.logoSrc} /> : null}
    </View>
  );
}

/** Bandeau de métadonnées (période, portée, tickets, agences). */
function MetaBlock(props: {
  view: ReportViewModel;
  lang: PdfLang;
  styles: ReturnType<typeof makeStyles>;
}): JSX.Element {
  const { view, lang, styles } = props;
  const t = pdfStrings(lang);
  return (
    <View>
      <View style={styles.metaRow}>
        <View style={styles.metaItem}>
          <Text style={styles.metaLabel}>{t.periodLabel}</Text>
          <Text style={styles.metaValue}>{view.periodKey}</Text>
        </View>
        <View style={styles.metaItem}>
          <Text style={styles.metaLabel}>{t.scopeLabel}</Text>
          <Text style={styles.metaValue}>{view.scopeLabel}</Text>
        </View>
        <View style={styles.metaItem}>
          <Text style={styles.metaLabel}>{t.totalTicketsLabel}</Text>
          <Text style={styles.metaValue}>{view.totalTickets}</Text>
        </View>
        <View style={styles.metaItem}>
          <Text style={styles.metaLabel}>{t.agencyCountLabel}</Text>
          <Text style={styles.metaValue}>{view.agencyCount}</Text>
        </View>
      </View>
      {view.partial ? <Text style={styles.partial}>{t.partialNotice}</Text> : null}
    </View>
  );
}

/** Table des 7 KPIs (libellé + valeur). */
function KpiTable(props: {
  view: ReportViewModel;
  lang: PdfLang;
  styles: ReturnType<typeof makeStyles>;
}): JSX.Element {
  const { view, lang, styles } = props;
  const t = pdfStrings(lang);
  return (
    <View>
      <Text style={styles.sectionTitle}>{t.kpiSectionTitle}</Text>
      {view.kpiRows.map((row) => (
        <View key={row.key} style={styles.kpiRow}>
          <Text style={styles.kpiLabel}>{row.label}</Text>
          <Text style={styles.kpiValue}>{row.value}</Text>
        </View>
      ))}
    </View>
  );
}

/** Une page « détaillée » standard (journalier / hebdo / page qualité mensuelle). */
function DetailPage(props: ReportDocumentProps): JSX.Element {
  const { view, theme, lang } = props;
  const styles = makeStyles(theme);
  const t = pdfStrings(lang);
  return (
    <Page size="A4" style={styles.page}>
      <BrandHeader theme={theme} view={view} styles={styles} />
      <MetaBlock view={view} lang={lang} styles={styles} />
      <KpiTable view={view} lang={lang} styles={styles} />
      <Text style={styles.footer} fixed>
        {t.internalFooter}
      </Text>
    </Page>
  );
}

/** Une page COMEX — densité contrôlée, 3 KPIs stratégiques, TIENT sur 1 page. */
function ComexPage(props: ReportDocumentProps): JSX.Element {
  const { view, theme, lang } = props;
  const styles = makeStyles(theme);
  const t = pdfStrings(lang);
  return (
    <Page size="A4" style={styles.page}>
      <BrandHeader theme={theme} view={view} styles={styles} />
      <View style={styles.comexHero}>
        <Text style={styles.comexTitle}>{t.comexTitle}</Text>
        <Text style={styles.comexSubtitle}>{t.comexSubtitle}</Text>
      </View>
      <MetaBlock view={view} lang={lang} styles={styles} />
      <View style={styles.comexCards}>
        {view.comexHighlights.map((row) => (
          <View key={row.key} style={styles.comexCard}>
            <Text style={styles.comexCardLabel}>{row.label}</Text>
            <Text style={styles.comexCardValue}>{row.value}</Text>
          </View>
        ))}
      </View>
      <Text style={styles.footer} fixed>
        {t.internalFooter}
      </Text>
    </Page>
  );
}

/**
 * Document PDF d'un rapport JOURNALIER (A4 portrait, 1 page détaillée).
 *
 * @param props - view-model + thème + langue
 * @returns Document React-PDF
 */
export function DailyReportDocument(props: ReportDocumentProps): JSX.Element {
  return (
    <Document>
      <DetailPage {...props} />
    </Document>
  );
}

/**
 * Document PDF d'un rapport HEBDOMADAIRE réseau (A4 portrait, agrégats anonymisés).
 *
 * @param props - view-model + thème + langue
 * @returns Document React-PDF
 */
export function WeeklyReportDocument(props: ReportDocumentProps): JSX.Element {
  return (
    <Document>
      <DetailPage {...props} />
    </Document>
  );
}

/**
 * Document PDF d'un rapport MENSUEL qualité : une page détaillée + une page COMEX.
 *
 * @param props - view-model + thème + langue
 * @returns Document React-PDF (2 pages)
 */
export function MonthlyReportDocument(props: ReportDocumentProps): JSX.Element {
  return (
    <Document>
      <DetailPage {...props} />
      <ComexPage {...props} />
    </Document>
  );
}

/**
 * Document PDF COMEX SEUL (1 page — densité contrôlée). Utilisé pour le test de
 * non-débordement (nombre de pages == 1).
 *
 * @param props - view-model + thème + langue
 * @returns Document React-PDF (1 page)
 */
export function ComexDocument(props: ReportDocumentProps): JSX.Element {
  return (
    <Document>
      <ComexPage {...props} />
    </Document>
  );
}
