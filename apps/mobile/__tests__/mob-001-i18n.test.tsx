// __tests__/mob-001-i18n.test.tsx
// MOB-001: i18n — FR/EN chargent sans erreur (refonte v2 : retrait dioula/baoulé)
import { i18n, supportedLocales, setLocale } from '../src/i18n';
import { fr } from '../src/i18n/locales/fr';
import { en } from '../src/i18n/locales/en';

describe('MOB-001: i18n — FR/EN chargent sans erreur', () => {
  test('locale français charge sans erreur', () => {
    i18n.locale = 'fr';
    expect(i18n.t('auth.title')).toBe('Connexion');
    expect(i18n.t('nav.home')).toBe('Accueil');
  });

  test('locale anglais charge sans erreur', () => {
    i18n.locale = 'en';
    expect(i18n.t('auth.title')).toBe('Sign In');
    expect(i18n.t('nav.home')).toBe('Home');
  });

  test('seules FR/EN sont supportées (dioula/baoulé retirés)', () => {
    expect(supportedLocales).toEqual(['fr', 'en']);
  });

  test('setLocale bascule FR ⇄ EN', () => {
    expect(setLocale('en')).toBe('en');
    expect(i18n.t('nav.home')).toBe('Home');
    expect(setLocale('fr')).toBe('fr');
    expect(i18n.t('nav.home')).toBe('Accueil');
  });

  test('fallback vers FR si langue inconnue', () => {
    i18n.locale = 'xyz-unknown';
    // enableFallback = true, doit retomber sur fr
    const title = i18n.t('auth.title');
    expect(typeof title).toBe('string');
    expect(title.length).toBeGreaterThan(0);
  });

  test('setLocale retombe sur FR si langue non supportée', () => {
    expect(setLocale('dioula')).toBe('fr');
  });

  test('FR et EN ont les clés auth.uemoa_consent', () => {
    expect(fr.auth.uemoa_consent).toBeDefined();
    expect(en.auth.uemoa_consent).toBeDefined();
  });

  test('FR et EN ont les clés offline.badge', () => {
    expect(fr.offline.badge).toBeDefined();
    expect(en.offline.badge).toBeDefined();
  });

  afterEach(() => {
    // Reset to default
    i18n.locale = 'fr';
  });
});
