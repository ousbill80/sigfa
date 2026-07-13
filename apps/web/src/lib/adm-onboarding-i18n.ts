/**
 * adm-onboarding-i18n.ts — dedicated `admOnboard.*` i18n namespace (ADM-002b).
 *
 * The onboarding parcours owns its own namespace so it never collides with the
 * existing `admin.*` (WEB-006), `admTheme.*` (ADM-001b) or other keys. Two
 * locales only (FR/EN — décision PO 2026-07). FR is the base; EN mirrors it
 * key-for-key. `tAdmOnboard` falls back to FR (then the raw key) so a missing
 * translation is never a crash.
 *
 * @module lib/adm-onboarding-i18n
 */
import type { Locale } from "./i18n";

/** Every `admOnboard.*` translation key. */
export type AdmOnboardKey =
  | "admOnboard.title"
  | "admOnboard.subtitle"
  | "admOnboard.target_notice"
  | "admOnboard.chrono_label"
  | "admOnboard.chrono_target"
  | "admOnboard.under_target"
  | "admOnboard.over_target"
  | "admOnboard.step_of"
  | "admOnboard.step_target"
  | "admOnboard.next"
  | "admOnboard.back"
  | "admOnboard.retry"
  // step labels
  | "admOnboard.step.clone"
  | "admOnboard.step.services"
  | "admOnboard.step.counters"
  | "admOnboard.step.agents"
  | "admOnboard.step.kiosk"
  // clone step
  | "admOnboard.clone.name_label"
  | "admOnboard.clone.name_hint"
  | "admOnboard.clone.source_label"
  | "admOnboard.clone.source_template"
  | "admOnboard.clone.source_agency"
  | "admOnboard.clone.template_id_label"
  | "admOnboard.clone.agency_id_label"
  | "admOnboard.clone.structural_notice"
  | "admOnboard.clone.submit"
  | "admOnboard.clone.done"
  // verify steps
  | "admOnboard.verify.services"
  | "admOnboard.verify.counters"
  | "admOnboard.verify.confirm"
  | "admOnboard.verify.confirmed"
  // agents step
  | "admOnboard.agents.intro"
  // cloned-config recap chips (per verify step)
  | "admOnboard.recap_chip.services"
  | "admOnboard.recap_chip.sla"
  | "admOnboard.recap_chip.counters"
  | "admOnboard.recap_chip.thresholds"
  | "admOnboard.recap_chip.agents"
  | "admOnboard.recap_chip.roles"
  | "admOnboard.recap_chip.cloned"
  // kiosk / QR step
  | "admOnboard.kiosk.intro"
  | "admOnboard.kiosk.provision"
  | "admOnboard.kiosk.regenerate"
  | "admOnboard.kiosk.print"
  | "admOnboard.kiosk.qr_alt"
  | "admOnboard.kiosk.scan_instructions"
  | "admOnboard.kiosk.expires_at"
  | "admOnboard.kiosk.expired"
  | "admOnboard.kiosk.not_provisioned"
  // recap
  | "admOnboard.recap.title"
  | "admOnboard.recap.operational"
  | "admOnboard.recap.total_duration"
  | "admOnboard.recap.agency_id"
  | "admOnboard.recap.kiosk_id"
  // five states
  | "admOnboard.state.loading"
  | "admOnboard.state.provisioning"
  | "admOnboard.state.error"
  | "admOnboard.state.offline"
  | "admOnboard.forbidden";

/** Translation dictionary for the onboarding parcours. */
export type AdmOnboardDict = Record<AdmOnboardKey, string>;

/** French translations (base locale). */
export const ADM_ONBOARD_FR: AdmOnboardDict = {
  "admOnboard.title": "ONBOARDING D'UNE AGENCE",
  "admOnboard.subtitle":
    "Créez une agence opérationnelle — de la configuration clonée à une borne qui imprime son premier ticket.",
  "admOnboard.target_notice":
    "Objectif : une agence opérationnelle en moins de 2 heures. Chaque étape indique un temps cible pour vous guider, sans pression.",
  "admOnboard.chrono_label": "Temps écoulé",
  "admOnboard.chrono_target": "Cible",
  "admOnboard.under_target": "Dans les temps",
  "admOnboard.over_target": "Au-delà de la cible — poursuivez à votre rythme",
  "admOnboard.step_of": "Étape",
  "admOnboard.step_target": "Temps cible",
  "admOnboard.next": "Suivant",
  "admOnboard.back": "Précédent",
  "admOnboard.retry": "Réessayer",
  "admOnboard.step.clone": "Créer l'agence",
  "admOnboard.step.services": "Services & SLA",
  "admOnboard.step.counters": "Guichets",
  "admOnboard.step.agents": "Agents",
  "admOnboard.step.kiosk": "Borne & QR",
  "admOnboard.clone.name_label": "Nom de la nouvelle agence",
  "admOnboard.clone.name_hint": "Ex. « Agence Marcory ».",
  "admOnboard.clone.source_label": "Cloner à partir de",
  "admOnboard.clone.source_template": "Un template d'agence",
  "admOnboard.clone.source_agency": "Une agence existante",
  "admOnboard.clone.template_id_label": "Identifiant du template",
  "admOnboard.clone.agency_id_label": "Identifiant de l'agence source",
  "admOnboard.clone.structural_notice":
    "Le clonage copie uniquement la configuration (services, SLA, guichets, seuils). Aucune donnée client, aucun ticket n'est copié.",
  "admOnboard.clone.submit": "Créer et démarrer l'onboarding",
  "admOnboard.clone.done": "Agence créée — configuration clonée.",
  "admOnboard.verify.services":
    "Vérifiez les services et les SLA clonés, puis ajustez si nécessaire.",
  "admOnboard.verify.counters": "Vérifiez les guichets clonés.",
  "admOnboard.verify.confirm": "Confirmer et continuer",
  "admOnboard.verify.confirmed": "Vérification confirmée.",
  "admOnboard.agents.intro":
    "Importez les agents de l'agence via un fichier CSV (réutilise l'import agents).",
  "admOnboard.recap_chip.services": "Services",
  "admOnboard.recap_chip.sla": "SLA",
  "admOnboard.recap_chip.counters": "Guichets",
  "admOnboard.recap_chip.thresholds": "Seuils",
  "admOnboard.recap_chip.agents": "Agents",
  "admOnboard.recap_chip.roles": "Rôles",
  "admOnboard.recap_chip.cloned": "Cloné depuis la source",
  "admOnboard.kiosk.intro":
    "Provisionnez la borne pour obtenir le QR d'installation à scanner depuis la borne.",
  "admOnboard.kiosk.provision": "Provisionner la borne",
  "admOnboard.kiosk.regenerate": "Régénérer le QR",
  "admOnboard.kiosk.print": "Imprimer",
  "admOnboard.kiosk.qr_alt": "QR d'installation de la borne",
  "admOnboard.kiosk.scan_instructions":
    "Depuis l'application borne, scannez ce QR pour enrôler la borne. Le code est à usage unique.",
  "admOnboard.kiosk.expires_at": "Expire le",
  "admOnboard.kiosk.expired": "Le QR a expiré. Régénérez-le pour continuer.",
  "admOnboard.kiosk.not_provisioned": "Borne non provisionnée : {reason}",
  "admOnboard.recap.title": "RÉCAPITULATIF",
  "admOnboard.recap.operational": "Agence opérationnelle",
  "admOnboard.recap.total_duration": "Durée totale mesurée",
  "admOnboard.recap.agency_id": "Identifiant de l'agence",
  "admOnboard.recap.kiosk_id": "Identifiant de la borne",
  "admOnboard.state.loading": "Chargement du parcours d'onboarding…",
  "admOnboard.state.provisioning": "Provisionnement de la borne…",
  "admOnboard.state.error": "Une erreur est survenue. Veuillez réessayer.",
  "admOnboard.state.offline": "Connexion requise pour l'onboarding.",
  "admOnboard.forbidden": "Vous n'avez pas les droits pour lancer l'onboarding d'une agence.",
};

/** English translations. */
export const ADM_ONBOARD_EN: AdmOnboardDict = {
  "admOnboard.title": "AGENCY ONBOARDING",
  "admOnboard.subtitle":
    "Stand up an operational agency — from cloned configuration to a kiosk printing its first ticket.",
  "admOnboard.target_notice":
    "Goal: an operational agency in under 2 hours. Each step shows a target time to guide you, without pressure.",
  "admOnboard.chrono_label": "Elapsed time",
  "admOnboard.chrono_target": "Target",
  "admOnboard.under_target": "On track",
  "admOnboard.over_target": "Past the target — carry on at your own pace",
  "admOnboard.step_of": "Step",
  "admOnboard.step_target": "Target time",
  "admOnboard.next": "Next",
  "admOnboard.back": "Back",
  "admOnboard.retry": "Retry",
  "admOnboard.step.clone": "Create the agency",
  "admOnboard.step.services": "Services & SLA",
  "admOnboard.step.counters": "Counters",
  "admOnboard.step.agents": "Agents",
  "admOnboard.step.kiosk": "Kiosk & QR",
  "admOnboard.clone.name_label": "New agency name",
  "admOnboard.clone.name_hint": "e.g. “Marcory Branch”.",
  "admOnboard.clone.source_label": "Clone from",
  "admOnboard.clone.source_template": "An agency template",
  "admOnboard.clone.source_agency": "An existing agency",
  "admOnboard.clone.template_id_label": "Template identifier",
  "admOnboard.clone.agency_id_label": "Source agency identifier",
  "admOnboard.clone.structural_notice":
    "Cloning copies only the configuration (services, SLA, counters, thresholds). No customer data and no tickets are copied.",
  "admOnboard.clone.submit": "Create and start onboarding",
  "admOnboard.clone.done": "Agency created — configuration cloned.",
  "admOnboard.verify.services":
    "Check the cloned services and SLAs, then adjust if needed.",
  "admOnboard.verify.counters": "Check the cloned counters.",
  "admOnboard.verify.confirm": "Confirm and continue",
  "admOnboard.verify.confirmed": "Verification confirmed.",
  "admOnboard.agents.intro":
    "Import the agency's agents from a CSV file (reuses the agents import).",
  "admOnboard.recap_chip.services": "Services",
  "admOnboard.recap_chip.sla": "SLA",
  "admOnboard.recap_chip.counters": "Counters",
  "admOnboard.recap_chip.thresholds": "Thresholds",
  "admOnboard.recap_chip.agents": "Agents",
  "admOnboard.recap_chip.roles": "Roles",
  "admOnboard.recap_chip.cloned": "Cloned from source",
  "admOnboard.kiosk.intro":
    "Provision the kiosk to get the installation QR to scan from the kiosk.",
  "admOnboard.kiosk.provision": "Provision the kiosk",
  "admOnboard.kiosk.regenerate": "Regenerate the QR",
  "admOnboard.kiosk.print": "Print",
  "admOnboard.kiosk.qr_alt": "Kiosk installation QR",
  "admOnboard.kiosk.scan_instructions":
    "From the kiosk app, scan this QR to enroll the kiosk. The code is single-use.",
  "admOnboard.kiosk.expires_at": "Expires on",
  "admOnboard.kiosk.expired": "The QR has expired. Regenerate it to continue.",
  "admOnboard.kiosk.not_provisioned": "Kiosk not provisioned: {reason}",
  "admOnboard.recap.title": "SUMMARY",
  "admOnboard.recap.operational": "Agency operational",
  "admOnboard.recap.total_duration": "Measured total duration",
  "admOnboard.recap.agency_id": "Agency identifier",
  "admOnboard.recap.kiosk_id": "Kiosk identifier",
  "admOnboard.state.loading": "Loading the onboarding parcours…",
  "admOnboard.state.provisioning": "Provisioning the kiosk…",
  "admOnboard.state.error": "An error occurred. Please try again.",
  "admOnboard.state.offline": "Connection required for onboarding.",
  "admOnboard.forbidden": "You do not have permission to start an agency onboarding.",
};

/** Locale → dictionary map. */
export const ADM_ONBOARD_LOCALES: Record<Locale, AdmOnboardDict> = {
  fr: ADM_ONBOARD_FR,
  en: ADM_ONBOARD_EN,
};

/**
 * Translate an `admOnboard.*` key. Falls back to FR, then the raw key.
 * @param key - The onboarding parcours key.
 * @param locale - Target locale (default `fr`).
 * @returns The translated string.
 */
export function tAdmOnboard(key: AdmOnboardKey, locale: Locale = "fr"): string {
  return ADM_ONBOARD_LOCALES[locale][key] ?? ADM_ONBOARD_FR[key] ?? key;
}

/**
 * Interpolates a single `{reason}` placeholder in a translated string.
 * @param template - The translated template containing `{reason}`.
 * @param reason - The human reason to inject.
 * @returns The interpolated string.
 */
export function withReason(template: string, reason: string): string {
  return template.replace("{reason}", reason);
}
