/**
 * Stockage & validation du logo banque — ADM-001a (CONTRACT-013).
 *
 * `POST /banks/:id/theme/logo` accepte un upload multipart et le stocke dans un
 * bucket objet. En F8 le stockage réel R2 n'est PAS branché : ce module fournit
 * un stockage MOCK/local déterministe (aucun I/O réseau), tout en appliquant les
 * validations de sécurité RÉELLES exigées par LA LOI :
 *
 *  - Type MIME reconnu par les MAGIC BYTES du contenu (jamais par le nom de
 *    fichier ni l'en-tête client, falsifiables) : PNG, SVG, JPEG.
 *  - Taille ≤ 512 Ko (borne stricte).
 *  - Dimensions ≥ 200×200 px (lues dans l'en-tête binaire PNG/JPEG ; pour un SVG
 *    on lit `width`/`height` ou `viewBox`).
 *  - SANITISATION SVG : aucun contenu exécutable (`<script>`, `on*=`, `javascript:`,
 *    entités/`<!ENTITY>`…) n'est conservé — le SVG stocké est expurgé.
 *
 * Toute violation lève `InvalidLogoError` → 422 `INVALID_LOGO` opaque et
 * déterministe côté route.
 *
 * @module
 */

/** Taille maximale du logo (LA LOI : ≤ 512 Ko). */
export const MAX_LOGO_BYTES = 512_000;

/** Dimension minimale (px) sur chaque axe (LA LOI : ≥ 200×200). */
export const MIN_LOGO_DIMENSION = 200;

/** Types MIME de logo acceptés (reconnus par magic bytes). */
export type LogoMime = "image/png" | "image/svg+xml" | "image/jpeg";

/** Erreur de logo invalide (format / taille / dimensions) → 422 INVALID_LOGO. */
export class InvalidLogoError extends Error {
  constructor(reason: string) {
    super(`Logo invalide : ${reason}`);
    this.name = "InvalidLogoError";
  }
}

/** Dimensions en pixels d'une image. */
interface Dimensions {
  /** Largeur en pixels. */
  width: number;
  /** Hauteur en pixels. */
  height: number;
}

/** Résultat d'une validation réussie : type reconnu + octets à stocker. */
export interface ValidatedLogo {
  /** Type MIME reconnu par le contenu. */
  mime: LogoMime;
  /** Extension de fichier canonique (png/svg/jpg). */
  extension: "png" | "svg" | "jpg";
  /** Octets prêts à stocker (SVG assaini le cas échéant). */
  bytes: Uint8Array;
}

/** Vrai si les octets débutent par la signature PNG (89 50 4E 47 0D 0A 1A 0A). */
function isPng(bytes: Uint8Array): boolean {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  return sig.every((b, i) => bytes[i] === b);
}

/** Vrai si les octets débutent par la signature JPEG (FF D8 FF). */
function isJpeg(bytes: Uint8Array): boolean {
  return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

/**
 * Vrai si le contenu est un SVG : on cherche `<svg` dans les premiers octets
 * décodés en UTF-8 (tolère un BOM / une déclaration XML / des espaces).
 */
function isSvg(bytes: Uint8Array): boolean {
  const head = new TextDecoder("utf-8").decode(bytes.subarray(0, 512)).toLowerCase();
  return head.includes("<svg");
}

/** Lit les dimensions d'un PNG depuis l'IHDR (octets 16..23, big-endian). */
function pngDimensions(bytes: Uint8Array): Dimensions {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/** Lit les dimensions d'un JPEG en parcourant ses marqueurs SOF. */
function jpegDimensions(bytes: Uint8Array): Dimensions {
  let offset = 2; // saute SOI (FF D8)
  while (offset + 1 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1] ?? 0;
    // Marqueurs SOF0..SOF3, SOF5..SOF7, SOF9..SOF11, SOF13..SOF15.
    const isSof =
      marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (isSof && offset + 9 <= bytes.length) {
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const height = view.getUint16(offset + 5);
      const width = view.getUint16(offset + 7);
      return { width, height };
    }
    // Longueur du segment (2 octets big-endian) après le marqueur.
    if (offset + 4 > bytes.length) break;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const segLen = view.getUint16(offset + 2);
    offset += 2 + Math.max(segLen, 1);
  }
  throw new InvalidLogoError("dimensions JPEG illisibles.");
}

/** Extrait un nombre depuis une chaîne de dimension SVG (`200`, `200px`…). */
function parseSvgLength(raw: string | null): number | null {
  if (!raw) return null;
  const match = /([\d.]+)/.exec(raw);
  if (!match) return null;
  const value = Number.parseFloat(match[1] as string);
  return Number.isFinite(value) ? value : null;
}

/** Lit les dimensions d'un SVG via `width`/`height` ou, à défaut, `viewBox`. */
function svgDimensions(svg: string): Dimensions {
  const width = parseSvgLength(/\bwidth\s*=\s*["']([^"']+)["']/i.exec(svg)?.[1] ?? null);
  const height = parseSvgLength(/\bheight\s*=\s*["']([^"']+)["']/i.exec(svg)?.[1] ?? null);
  if (width !== null && height !== null) return { width, height };
  const viewBox = /\bviewBox\s*=\s*["']([^"']+)["']/i.exec(svg)?.[1];
  if (viewBox) {
    const parts = viewBox.trim().split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
      return { width: parts[2] as number, height: parts[3] as number };
    }
  }
  throw new InvalidLogoError("dimensions SVG illisibles.");
}

/**
 * Assainit un SVG : supprime tout contenu exécutable (jamais de rendu de script).
 * Retire `<script>`, `<foreignObject>`, les attributs d'évènement `on*`, les URI
 * `javascript:`, et toute déclaration `<!DOCTYPE>`/`<!ENTITY>` (anti-XXE/billion-laughs).
 *
 * @param svg - Source SVG brute
 * @returns SVG expurgé de tout contenu actif
 */
export function sanitizeSvg(svg: string): string {
  return svg
    .replace(/<!DOCTYPE[^>]*>/gi, "")
    .replace(/<!ENTITY[^>]*>/gi, "")
    .replace(/<script[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<script[^>]*\/?>/gi, "")
    .replace(/<foreignObject[\s\S]*?<\/foreignObject\s*>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|xlink:href)\s*=\s*("javascript:[^"]*"|'javascript:[^']*')/gi, "");
}

/** Vrai si un SVG contient encore un contenu actif après (ou avant) assainissement. */
export function svgHasActiveContent(svg: string): boolean {
  return (
    /<script[\s>]/i.test(svg) ||
    /\son\w+\s*=/i.test(svg) ||
    /javascript:/i.test(svg) ||
    /<!ENTITY/i.test(svg)
  );
}

/**
 * Valide et normalise un logo uploadé (magic bytes → type ; taille ; dimensions ;
 * assainissement SVG). Ne fait AUCUN I/O.
 *
 * @param bytes - Octets bruts du fichier uploadé
 * @returns Logo validé (type reconnu + octets à stocker)
 * @throws {InvalidLogoError} Si format/taille/dimensions non conformes
 */
export function validateLogo(bytes: Uint8Array): ValidatedLogo {
  if (bytes.length === 0) {
    throw new InvalidLogoError("fichier vide.");
  }
  if (bytes.length > MAX_LOGO_BYTES) {
    throw new InvalidLogoError(`taille > ${MAX_LOGO_BYTES} octets.`);
  }
  if (isPng(bytes)) {
    assertDimensions(pngDimensions(bytes));
    return { mime: "image/png", extension: "png", bytes };
  }
  if (isJpeg(bytes)) {
    assertDimensions(jpegDimensions(bytes));
    return { mime: "image/jpeg", extension: "jpg", bytes };
  }
  if (isSvg(bytes)) {
    const raw = new TextDecoder("utf-8").decode(bytes);
    assertDimensions(svgDimensions(raw));
    const sanitized = sanitizeSvg(raw);
    if (svgHasActiveContent(sanitized)) {
      throw new InvalidLogoError("contenu SVG actif non assainissable.");
    }
    return {
      mime: "image/svg+xml",
      extension: "svg",
      bytes: new TextEncoder().encode(sanitized),
    };
  }
  throw new InvalidLogoError("format non supporté (PNG, SVG ou JPEG attendu).");
}

/** Lève si une dimension est sous le minimum requis. */
function assertDimensions({ width, height }: Dimensions): void {
  if (width < MIN_LOGO_DIMENSION || height < MIN_LOGO_DIMENSION) {
    throw new InvalidLogoError(
      `dimensions < ${MIN_LOGO_DIMENSION}×${MIN_LOGO_DIMENSION} px.`
    );
  }
}

/**
 * Magasin d'objets abstrait — implémentation MOCK/local en F8 (pas de R2 réel).
 * `put` retourne l'URL publique du logo stocké.
 */
export interface LogoObjectStore {
  /**
   * Stocke les octets sous la clé donnée et retourne l'URL publique.
   *
   * @param key   - Clé objet (`logos/<bankId>/logo.<ext>`)
   * @param bytes - Octets à stocker
   * @param mime  - Type MIME de l'objet
   * @returns URL publique du logo
   */
  put(key: string, bytes: Uint8Array, mime: LogoMime): Promise<string>;
}

/** Préfixe d'URL publique du magasin mock (déterministe, testable). */
export const MOCK_LOGO_BASE_URL = "https://mock-storage.sigfa.local";

/**
 * Magasin d'objets MOCK en mémoire : conserve les octets et sert une URL
 * déterministe. Aucun I/O réseau — remplace R2 en F8. Le contenu stocké est
 * inspectable (`get`) pour les tests d'assainissement.
 */
export class InMemoryLogoStore implements LogoObjectStore {
  private readonly objects = new Map<string, { bytes: Uint8Array; mime: LogoMime }>();

  put(key: string, bytes: Uint8Array, mime: LogoMime): Promise<string> {
    this.objects.set(key, { bytes, mime });
    return Promise.resolve(`${MOCK_LOGO_BASE_URL}/${key}`);
  }

  /** Lit un objet stocké (support de test). */
  get(key: string): { bytes: Uint8Array; mime: LogoMime } | undefined {
    return this.objects.get(key);
  }
}

/** Magasin mock partagé par défaut (F8) — injectable/remplaçable en test. */
export const defaultLogoStore = new InMemoryLogoStore();

/**
 * Construit la clé objet du logo d'une banque (déterministe, 1 logo par banque).
 *
 * @param bankId    - Identifiant de la banque
 * @param extension - Extension du fichier (png/svg/jpg)
 * @returns Clé objet `logos/<bankId>/logo.<ext>`
 */
export function logoObjectKey(bankId: string, extension: string): string {
  return `logos/${bankId}/logo.${extension}`;
}
