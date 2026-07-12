/**
 * Correction de contraste WCAG 2.x (API-009, admin.yaml theming).
 *
 * Le theming banque fournit des couleurs `requestedColors` (primary/secondary/
 * background). Les `appliedColors` en dérivent en garantissant un ratio de
 * contraste ≥ 4.5:1 (WCAG AA texte normal) entre chaque couleur de premier plan
 * (primary, secondary) et le fond (background).
 *
 * Algorithme :
 *   1. Ratio = (L_clair + 0.05) / (L_sombre + 0.05) où L = luminance relative
 *      (WCAG : linéarisation sRGB + pondération 0.2126/0.7152/0.0722).
 *   2. Si le ratio ≥ 4.5, la couleur est conservée telle quelle.
 *   3. Sinon, on ajuste la LUMINOSITÉ (lightness HSL) de la couleur de premier
 *      plan par pas monotones — vers le noir si le fond est clair, vers le blanc
 *      si le fond est sombre — jusqu'à atteindre 4.5:1 (ou le point extrême, qui
 *      contre un fond médian garantit toujours ≥ 4.5:1 via noir ou blanc pur).
 *
 * Module pur, sans I/O — entièrement testable sur cas limites.
 *
 * @module
 */

/** Ratio de contraste WCAG AA minimal pour un texte normal. */
export const MIN_CONTRAST_RATIO = 4.5;

/** Composantes RGB 0..255. */
interface Rgb {
  /** Rouge 0..255. */
  r: number;
  /** Vert 0..255. */
  g: number;
  /** Bleu 0..255. */
  b: number;
}

/** Pas d'ajustement de la luminosité HSL (1 %). */
const LIGHTNESS_STEP = 0.01;

/**
 * Convertit une couleur hexadécimale `#RRGGBB` en composantes RGB.
 *
 * @param hex - Couleur `#RRGGBB` (insensible à la casse)
 * @returns Composantes RGB 0..255
 */
export function hexToRgb(hex: string): Rgb {
  const value = hex.replace("#", "");
  return {
    r: Number.parseInt(value.slice(0, 2), 16),
    g: Number.parseInt(value.slice(2, 4), 16),
    b: Number.parseInt(value.slice(4, 6), 16),
  };
}

/** Convertit une composante 0..255 en hex 2 caractères. */
function channelToHex(value: number): string {
  const clamped = Math.max(0, Math.min(255, Math.round(value)));
  return clamped.toString(16).padStart(2, "0");
}

/**
 * Convertit des composantes RGB en couleur hexadécimale `#RRGGBB`.
 *
 * @param rgb - Composantes RGB 0..255
 * @returns Couleur `#rrggbb` minuscule
 */
export function rgbToHex(rgb: Rgb): string {
  return `#${channelToHex(rgb.r)}${channelToHex(rgb.g)}${channelToHex(rgb.b)}`;
}

/**
 * Linéarise une composante sRGB (0..1) selon la formule WCAG.
 *
 * @param channel - Composante sRGB normalisée 0..1
 * @returns Composante linéaire
 */
function linearize(channel: number): number {
  return channel <= 0.03928
    ? channel / 12.92
    : Math.pow((channel + 0.055) / 1.055, 2.4);
}

/**
 * Calcule la luminance relative WCAG d'une couleur (0 = noir, 1 = blanc).
 *
 * @param rgb - Composantes RGB 0..255
 * @returns Luminance relative 0..1
 */
export function relativeLuminance(rgb: Rgb): number {
  const r = linearize(rgb.r / 255);
  const g = linearize(rgb.g / 255);
  const b = linearize(rgb.b / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Calcule le ratio de contraste WCAG entre deux couleurs.
 *
 * @param a - Première couleur `#RRGGBB`
 * @param b - Seconde couleur `#RRGGBB`
 * @returns Ratio de contraste (1.0 .. 21.0)
 */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(hexToRgb(a));
  const lb = relativeLuminance(hexToRgb(b));
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Convertit RGB 0..255 en HSL (h 0..360, s/l 0..1). */
function rgbToHsl(rgb: Rgb): { h: number; s: number; l: number } {
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const delta = max - min;
  if (delta === 0) return { h: 0, s: 0, l };
  const s = delta / (1 - Math.abs(2 * l - 1));
  const h = hueFromRgb(r, g, b, max, delta);
  return { h, s, l };
}

/** Calcule la teinte HSL (0..360) depuis les composantes normalisées. */
function hueFromRgb(
  r: number,
  g: number,
  b: number,
  max: number,
  delta: number
): number {
  let h: number;
  if (max === r) h = ((g - b) / delta) % 6;
  else if (max === g) h = (b - r) / delta + 2;
  else h = (r - g) / delta + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}

/** Convertit HSL (h 0..360, s/l 0..1) en RGB 0..255. */
function hslToRgb(h: number, s: number, l: number): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r1, g1, b1] = hslSector(h, c, x);
  return {
    r: (r1 + m) * 255,
    g: (g1 + m) * 255,
    b: (b1 + m) * 255,
  };
}

/** Retourne le triplet RGB (0..1) du secteur de teinte HSL. */
function hslSector(h: number, c: number, x: number): [number, number, number] {
  if (h < 60) return [c, x, 0];
  if (h < 120) return [x, c, 0];
  if (h < 180) return [0, c, x];
  if (h < 240) return [0, x, c];
  if (h < 300) return [x, 0, c];
  return [c, 0, x];
}

/**
 * Corrige une couleur de premier plan pour atteindre ≥ 4.5:1 contre le fond.
 *
 * On ajuste la luminosité HSL par pas monotones dans la direction qui offre le
 * MEILLEUR contraste au point extrême (vers le noir OU vers le blanc selon celui
 * des deux qui contraste le plus avec le fond). La boucle est bornée (100 pas) ;
 * le point extrême retenu (noir ou blanc pur) est celui de contraste maximal,
 * garantissant le meilleur ratio atteignable contre un fond médian.
 *
 * @param foreground - Couleur de premier plan `#RRGGBB`
 * @param background - Couleur de fond `#RRGGBB`
 * @returns Couleur corrigée `#rrggbb` (inchangée si déjà conforme)
 */
export function correctContrast(
  foreground: string,
  background: string
): string {
  if (contrastRatio(foreground, background) >= MIN_CONTRAST_RATIO) {
    return foreground.toLowerCase();
  }
  // Choisir la direction (noir vs blanc) qui maximise le contraste au bout.
  const towardBlack = contrastRatio("#000000", background);
  const towardWhite = contrastRatio("#ffffff", background);
  const darken = towardBlack >= towardWhite;
  const { h, s } = rgbToHsl(hexToRgb(foreground));
  let l = rgbToHsl(hexToRgb(foreground)).l;
  for (let step = 0; step < 100; step += 1) {
    l = darken ? Math.max(0, l - LIGHTNESS_STEP) : Math.min(1, l + LIGHTNESS_STEP);
    const candidate = rgbToHex(hslToRgb(h, s, l));
    if (contrastRatio(candidate, background) >= MIN_CONTRAST_RATIO) {
      return candidate;
    }
  }
  return darken ? "#000000" : "#ffffff";
}
