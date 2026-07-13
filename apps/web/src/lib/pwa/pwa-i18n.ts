/**
 * NOTIF-005-B — PWA i18n namespace (`pwa.*`).
 *
 * Isolated FR/EN dictionary for the public ticket-tracking PWA. Kept SEPARATE
 * from `src/lib/i18n.ts` (dashboards/admin/tv) so this story never rewrites an
 * existing `audit.*` / `ai.*` / `tv.*` key. Two locales only (FR/EN — décision
 * PO). Zero emoji. Every screen state carries a human message (5 états design).
 *
 * @module lib/pwa/pwa-i18n
 */

/** Supported PWA locales — FR/EN only (décision PO 2026-07). */
export const PWA_LOCALES = ["fr", "en"] as const;
export type PwaLocale = (typeof PWA_LOCALES)[number];

/** Every translation key used by the PWA (all namespaced `pwa.*`). */
export type PwaKey =
  | "pwa.app.name"
  | "pwa.brand.tagline"
  | "pwa.lang.fr"
  | "pwa.lang.en"
  | "pwa.step.service"
  | "pwa.step.confirm"
  | "pwa.step.ticket"
  | "pwa.service.title"
  | "pwa.service.subtitle"
  | "pwa.service.wait"
  | "pwa.service.closed"
  | "pwa.service.empty"
  | "pwa.confirm.title"
  | "pwa.confirm.service_label"
  | "pwa.confirm.phone_label"
  | "pwa.confirm.phone_hint"
  | "pwa.confirm.phone_placeholder"
  | "pwa.confirm.phone_invalid"
  | "pwa.confirm.consent_label"
  | "pwa.confirm.consent_required"
  | "pwa.confirm.submit"
  | "pwa.confirm.back"
  | "pwa.confirm.submitting"
  | "pwa.ticket.eyebrow"
  | "pwa.ticket.message"
  | "pwa.ticket.position"
  | "pwa.ticket.wait"
  | "pwa.ticket.minutes"
  | "pwa.ticket.status.WAITING"
  | "pwa.ticket.status.CALLED"
  | "pwa.ticket.status.SERVING"
  | "pwa.ticket.status.DONE"
  | "pwa.ticket.status.NO_SHOW"
  | "pwa.ticket.status.ABANDONED"
  | "pwa.ticket.status.TRANSFERRED"
  | "pwa.ticket.called_now"
  | "pwa.ticket.done"
  | "pwa.ticket.refresh"
  | "pwa.ticket.new"
  | "pwa.state.loading"
  | "pwa.state.empty"
  | "pwa.state.error"
  | "pwa.state.error_action"
  | "pwa.state.offline"
  | "pwa.state.offline_hint"
  | "pwa.token.invalid_title"
  | "pwa.token.invalid_body"
  | "pwa.token.expired_title"
  | "pwa.token.expired_body";

/** Full dictionary shape for one locale. */
export type PwaDict = Record<PwaKey, string>;

/** French — base locale. */
export const PWA_FR: PwaDict = {
  "pwa.app.name": "SIGFA — Mon ticket",
  "pwa.brand.tagline": "Prenez votre ticket, suivez votre tour en toute sérénité.",
  "pwa.lang.fr": "Français",
  "pwa.lang.en": "English",
  "pwa.step.service": "Service",
  "pwa.step.confirm": "Confirmation",
  "pwa.step.ticket": "Ticket",
  "pwa.service.title": "Quel service souhaitez-vous ?",
  "pwa.service.subtitle": "Choisissez le motif de votre visite.",
  "pwa.service.wait": "Environ {minutes} min d'attente",
  "pwa.service.closed": "Fermé",
  "pwa.service.empty": "Aucun service disponible pour le moment.",
  "pwa.confirm.title": "Confirmez votre demande",
  "pwa.confirm.service_label": "Service choisi",
  "pwa.confirm.phone_label": "Téléphone (facultatif)",
  "pwa.confirm.phone_hint": "Recevez un SMS quand votre tour approche. Vous pouvez suivre sans numéro.",
  "pwa.confirm.phone_placeholder": "+225 07 00 00 00 00",
  "pwa.confirm.phone_invalid": "Numéro invalide (format international attendu).",
  "pwa.confirm.consent_label": "J'accepte de recevoir un SMS pour ce ticket.",
  "pwa.confirm.consent_required": "Le consentement SMS est requis si vous renseignez un numéro.",
  "pwa.confirm.submit": "Prendre mon ticket",
  "pwa.confirm.back": "Retour",
  "pwa.confirm.submitting": "Émission en cours…",
  "pwa.ticket.eyebrow": "Votre ticket",
  "pwa.ticket.message": "Gardez cet écran ouvert : votre position se met à jour toute seule.",
  "pwa.ticket.position": "Position dans la file",
  "pwa.ticket.wait": "Attente estimée",
  "pwa.ticket.minutes": "{minutes} min",
  "pwa.ticket.status.WAITING": "En attente",
  "pwa.ticket.status.CALLED": "C'est à vous",
  "pwa.ticket.status.SERVING": "En cours",
  "pwa.ticket.status.DONE": "Terminé",
  "pwa.ticket.status.NO_SHOW": "Non présenté",
  "pwa.ticket.status.ABANDONED": "Abandonné",
  "pwa.ticket.status.TRANSFERRED": "Transféré",
  "pwa.ticket.called_now": "Présentez-vous au guichet.",
  "pwa.ticket.done": "Merci de votre visite.",
  "pwa.ticket.refresh": "Actualiser",
  "pwa.ticket.new": "Nouveau ticket",
  "pwa.state.loading": "Chargement…",
  "pwa.state.empty": "Rien à afficher pour le moment.",
  "pwa.state.error": "Une erreur est survenue. Veuillez réessayer.",
  "pwa.state.error_action": "Réessayer",
  "pwa.state.offline": "Hors ligne — dernier état connu affiché.",
  "pwa.state.offline_hint": "La mise à jour reprendra dès le retour du réseau.",
  "pwa.token.invalid_title": "QR non reconnu",
  "pwa.token.invalid_body": "Ce QR code n'est pas valide. Demandez de l'aide à l'accueil de l'agence.",
  "pwa.token.expired_title": "QR expiré",
  "pwa.token.expired_body": "Ce QR code a expiré. Un QR à jour est affiché en agence.",
};

/** English translation. */
export const PWA_EN: PwaDict = {
  "pwa.app.name": "SIGFA — My ticket",
  "pwa.brand.tagline": "Take your ticket, follow your turn with peace of mind.",
  "pwa.lang.fr": "Français",
  "pwa.lang.en": "English",
  "pwa.step.service": "Service",
  "pwa.step.confirm": "Confirmation",
  "pwa.step.ticket": "Ticket",
  "pwa.service.title": "Which service do you need?",
  "pwa.service.subtitle": "Choose the reason for your visit.",
  "pwa.service.wait": "About {minutes} min wait",
  "pwa.service.closed": "Closed",
  "pwa.service.empty": "No service available right now.",
  "pwa.confirm.title": "Confirm your request",
  "pwa.confirm.service_label": "Chosen service",
  "pwa.confirm.phone_label": "Phone (optional)",
  "pwa.confirm.phone_hint": "Get an SMS when your turn is near. You can track without a number.",
  "pwa.confirm.phone_placeholder": "+225 07 00 00 00 00",
  "pwa.confirm.phone_invalid": "Invalid number (international format expected).",
  "pwa.confirm.consent_label": "I agree to receive an SMS for this ticket.",
  "pwa.confirm.consent_required": "SMS consent is required if you provide a number.",
  "pwa.confirm.submit": "Get my ticket",
  "pwa.confirm.back": "Back",
  "pwa.confirm.submitting": "Issuing…",
  "pwa.ticket.eyebrow": "Your ticket",
  "pwa.ticket.message": "Keep this screen open: your position updates on its own.",
  "pwa.ticket.position": "Position in queue",
  "pwa.ticket.wait": "Estimated wait",
  "pwa.ticket.minutes": "{minutes} min",
  "pwa.ticket.status.WAITING": "Waiting",
  "pwa.ticket.status.CALLED": "It's your turn",
  "pwa.ticket.status.SERVING": "In progress",
  "pwa.ticket.status.DONE": "Done",
  "pwa.ticket.status.NO_SHOW": "No show",
  "pwa.ticket.status.ABANDONED": "Abandoned",
  "pwa.ticket.status.TRANSFERRED": "Transferred",
  "pwa.ticket.called_now": "Please proceed to the counter.",
  "pwa.ticket.done": "Thank you for your visit.",
  "pwa.ticket.refresh": "Refresh",
  "pwa.ticket.new": "New ticket",
  "pwa.state.loading": "Loading…",
  "pwa.state.empty": "Nothing to display yet.",
  "pwa.state.error": "Something went wrong. Please try again.",
  "pwa.state.error_action": "Retry",
  "pwa.state.offline": "Offline — showing the last known state.",
  "pwa.state.offline_hint": "Updates will resume as soon as the network is back.",
  "pwa.token.invalid_title": "Unrecognized QR",
  "pwa.token.invalid_body": "This QR code is not valid. Please ask for help at the branch desk.",
  "pwa.token.expired_title": "Expired QR",
  "pwa.token.expired_body": "This QR code has expired. An up-to-date QR is displayed at the branch.",
};

/** Locale → dictionary map. */
export const PWA_LOCALES_MAP: Record<PwaLocale, PwaDict> = {
  fr: PWA_FR,
  en: PWA_EN,
};

/**
 * Resolves a PWA translation, interpolating `{name}` placeholders.
 * Falls back to French, then to the raw key (never throws).
 *
 * @param key - Namespaced `pwa.*` key.
 * @param locale - Target locale (default `"fr"`).
 * @param vars - Optional interpolation values for `{placeholder}` tokens.
 * @returns The localized string.
 */
export function pt(
  key: PwaKey,
  locale: PwaLocale = "fr",
  vars?: Record<string, string | number>,
): string {
  const raw = PWA_LOCALES_MAP[locale][key] ?? PWA_FR[key] ?? key;
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = vars[name];
    return value === undefined ? match : String(value);
  });
}
