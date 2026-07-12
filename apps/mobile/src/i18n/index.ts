// i18n/index.ts — Setup i18n-js (FR/EN uniquement)
// Refonte v2 : le mobile ne porte plus que le français et l'anglais
// (retrait de dioula/baoulé sur directive PO).
import { I18n } from 'i18n-js';
import * as ExpoLocalization from 'expo-localization';
import { fr } from './locales/fr';
import { en } from './locales/en';

const i18n = new I18n({
  fr,
  en,
});

// Défaut = FR (langue officielle Côte d'Ivoire)
i18n.defaultLocale = 'fr';
i18n.enableFallback = true;

// Détecter la langue du device
const locales = ExpoLocalization.getLocales();
const deviceLocale = locales[0]?.languageCode ?? 'fr';

// Langues supportées : FR / EN
const supportedLocales = ['fr', 'en'] as const;
type SupportedLocale = typeof supportedLocales[number];

function detectLocale(code: string): SupportedLocale {
  if ((supportedLocales as readonly string[]).includes(code)) {
    return code as SupportedLocale;
  }
  return 'fr';
}

/** Change la langue active. Retombe sur FR si non supportée. */
function setLocale(code: string): SupportedLocale {
  const next = detectLocale(code);
  i18n.locale = next;
  return next;
}

i18n.locale = detectLocale(deviceLocale);

export { i18n, supportedLocales, setLocale };
export type { SupportedLocale };
