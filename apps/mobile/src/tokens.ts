// Tokens design SIGFA — aucune valeur en dur dans les composants
export const tokens = {
  colors: {
    surface0: '#FAFBFC',
    surface1: '#FFFFFF',
    inkStrong: '#101828',
    inkSoft: '#475467',
    inkInverse: '#F5F7FA',
    success: '#12B76A',
    warning: '#F79009',
    danger: '#F04438',
    info: '#2E90FA',
    // Brand injectée par tenant (valeur par défaut SIGFA)
    brand: '#2E90FA',
    brandSoft: 'rgba(46, 144, 250, 0.1)',
  },
  spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48, xxxxl: 64 },
  radius: { card: 12, button: 12, badge: 999 },
  fontSize: { display: 32, title: 20, body: 15, caption: 13 },
  minTouchTarget: 44, // mobile (kiosque = 72)
} as const;

export type Tokens = typeof tokens;
