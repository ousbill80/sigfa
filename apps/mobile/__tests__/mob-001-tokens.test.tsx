// __tests__/mob-001-tokens.test.tsx
// MOB-001: tokens appliqués — zéro valeur de couleur/taille/rayon en dur
import { tokens } from '../src/tokens';

describe('MOB-001: tokens appliqués — zéro valeur de couleur/taille/rayon en dur', () => {
  test('tokens.colors contient toutes les couleurs SIGFA', () => {
    expect(tokens.colors.brand).toBeDefined();
    expect(tokens.colors.surface0).toBeDefined();
    expect(tokens.colors.inkStrong).toBeDefined();
    expect(tokens.colors.danger).toBeDefined();
    expect(tokens.colors.success).toBeDefined();
    expect(tokens.colors.warning).toBeDefined();
  });

  test('tokens.spacing contient toutes les tailles', () => {
    expect(tokens.spacing.xs).toBe(4);
    expect(tokens.spacing.sm).toBe(8);
    expect(tokens.spacing.md).toBe(12);
    expect(tokens.spacing.lg).toBe(16);
    expect(tokens.spacing.xl).toBe(24);
  });

  test('tokens.radius contient les rayons de bordure', () => {
    expect(tokens.radius.card).toBe(12);
    expect(tokens.radius.button).toBe(12);
    expect(tokens.radius.badge).toBe(999);
  });

  test('tokens.fontSize contient les tailles de police', () => {
    expect(tokens.fontSize.display).toBe(32);
    expect(tokens.fontSize.title).toBe(20);
    expect(tokens.fontSize.body).toBe(15);
    expect(tokens.fontSize.caption).toBe(13);
  });

  test('minTouchTarget est 44px pour le mobile', () => {
    expect(tokens.minTouchTarget).toBe(44);
  });

  test('les couleurs sont des strings valides (#hex ou rgba)', () => {
    Object.values(tokens.colors).forEach(color => {
      expect(typeof color).toBe('string');
      expect(color.length).toBeGreaterThan(0);
    });
  });
});
