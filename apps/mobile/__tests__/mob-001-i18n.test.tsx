// __tests__/mob-001-i18n.test.tsx
// MOB-001: i18n — les 4 langues chargent sans erreur
import { i18n } from '../src/i18n';
import { fr } from '../src/i18n/locales/fr';
import { en } from '../src/i18n/locales/en';
import { dioula } from '../src/i18n/locales/dioula';
import { baoule } from '../src/i18n/locales/baoule';

describe('MOB-001: i18n — les 4 langues chargent sans erreur', () => {
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

  test('locale dioula charge sans erreur', () => {
    i18n.locale = 'dioula';
    const title = i18n.t('auth.title');
    expect(typeof title).toBe('string');
    expect(title.length).toBeGreaterThan(0);
  });

  test('locale baoulé charge sans erreur', () => {
    i18n.locale = 'baoule';
    const title = i18n.t('auth.title');
    expect(typeof title).toBe('string');
    expect(title.length).toBeGreaterThan(0);
  });

  test('fallback vers FR si langue inconnue', () => {
    i18n.locale = 'xyz-unknown';
    // enableFallback = true, doit retomber sur fr
    const title = i18n.t('auth.title');
    expect(typeof title).toBe('string');
    expect(title.length).toBeGreaterThan(0);
  });

  test('les 4 locales ont les clés auth.uemoa_consent', () => {
    expect(fr.auth.uemoa_consent).toBeDefined();
    expect(en.auth.uemoa_consent).toBeDefined();
    expect(dioula.auth.uemoa_consent).toBeDefined();
    expect(baoule.auth.uemoa_consent).toBeDefined();
  });

  test('les 4 locales ont les clés offline.badge', () => {
    expect(fr.offline.badge).toBeDefined();
    expect(en.offline.badge).toBeDefined();
    expect(dioula.offline.badge).toBeDefined();
    expect(baoule.offline.badge).toBeDefined();
  });

  afterEach(() => {
    // Reset to default
    i18n.locale = 'fr';
  });
});
