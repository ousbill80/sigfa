/**
 * email-i18n — libellés statiques FR/EN des gabarits email NOTIF-004.
 *
 * LA LOI : FR/EN UNIQUEMENT (MEMORY — Dioula/Baoulé retirés). Aucune valeur métier
 * ici (transport pur) : uniquement le chrome des gabarits (titres, boutons, labels).
 *
 * @module
 */

import type { EmailLang } from "src/services/email/email-types.js";

/** Dictionnaire de libellés d'un gabarit. */
export interface EmailStrings {
  /** Étiquette « Alerte ». */
  alertLabel: string;
  /** Étiquette « Agence ». */
  agencyLabel: string;
  /** Étiquette « Sévérité ». */
  severityLabel: string;
  /** Étiquette « Survenu le ». */
  occurredAtLabel: string;
  /** Titre d'un rapport journalier. */
  dailyTitle: string;
  /** Titre d'un rapport hebdomadaire. */
  weeklyTitle: string;
  /** Titre d'un rapport mensuel. */
  monthlyTitle: string;
  /** Étiquette « Période ». */
  periodLabel: string;
  /** Texte du bouton de téléchargement de la pièce jointe (lien signé). */
  downloadAttachment: string;
  /** Mention « lien valable 24 h ». */
  linkValidity: string;
  /** Pied de page — email interne. */
  internalFooter: string;
}

/** Table des libellés par langue. */
const STRINGS: Record<EmailLang, EmailStrings> = {
  FR: {
    alertLabel: "Alerte manager",
    agencyLabel: "Agence",
    severityLabel: "Sévérité",
    occurredAtLabel: "Survenu le",
    dailyTitle: "Rapport journalier",
    weeklyTitle: "Rapport hebdomadaire",
    monthlyTitle: "Rapport mensuel",
    periodLabel: "Période",
    downloadAttachment: "Télécharger le document",
    linkValidity: "Ce lien est valable 24 heures.",
    internalFooter:
      "Email interne SIGFA — destiné au personnel de la banque uniquement.",
  },
  EN: {
    alertLabel: "Manager alert",
    agencyLabel: "Branch",
    severityLabel: "Severity",
    occurredAtLabel: "Occurred at",
    dailyTitle: "Daily report",
    weeklyTitle: "Weekly report",
    monthlyTitle: "Monthly report",
    periodLabel: "Period",
    downloadAttachment: "Download the document",
    linkValidity: "This link is valid for 24 hours.",
    internalFooter: "SIGFA internal email — for bank staff only.",
  },
};

/**
 * Retourne les libellés d'une langue (FR/EN).
 *
 * @param lang - Langue du gabarit
 * @returns Dictionnaire de libellés
 */
export function emailStrings(lang: EmailLang): EmailStrings {
  return STRINGS[lang];
}
