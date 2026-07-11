// i18n/index.ts — Setup i18n-js avec 4 langues SIGFA
import { I18n } from 'i18n-js';
import * as ExpoLocalization from 'expo-localization';
import { fr } from './locales/fr';
import { en } from './locales/en';
import { dioula } from './locales/dioula';
import { baoule } from './locales/baoule';

const i18n = new I18n({
  fr,
  en,
  dioula,
  baoule,
});

// Défaut = FR (langue officielle Côte d'Ivoire)
i18n.defaultLocale = 'fr';
i18n.enableFallback = true;

// Détecter la langue du device
const locales = ExpoLocalization.getLocales();
const deviceLocale = locales[0]?.languageCode ?? 'fr';

// Mapper vers les 4 langues supportées
const supportedLocales = ['fr', 'en', 'dioula', 'baoule'] as const;
type SupportedLocale = typeof supportedLocales[number];

function detectLocale(code: string): SupportedLocale {
  if ((supportedLocales as readonly string[]).includes(code)) {
    return code as SupportedLocale;
  }
  return 'fr';
}

i18n.locale = detectLocale(deviceLocale);

export { i18n };
export type { SupportedLocale };
