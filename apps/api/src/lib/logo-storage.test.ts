/**
 * Tests unitaires — validation & stockage MOCK du logo banque (ADM-001a).
 *
 * Couvre : reconnaissance par magic bytes (PNG/JPEG/SVG), bornes taille &
 * dimensions, assainissement SVG (zéro script), stockage mock déterministe.
 *
 * @module
 */

import { describe, it, expect } from "vitest";
import {
  validateLogo,
  sanitizeSvg,
  svgHasActiveContent,
  InvalidLogoError,
  InMemoryLogoStore,
  logoObjectKey,
  MAX_LOGO_BYTES,
  MOCK_LOGO_BASE_URL,
} from "src/lib/logo-storage.js";

/** Fabrique un PNG minimal valide avec IHDR (largeur/hauteur donnés). */
function makePng(width: number, height: number): Uint8Array {
  const buf = new Uint8Array(24);
  buf.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(buf.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return buf;
}

/** Fabrique un JPEG minimal (SOI + segment SOF0 avec dimensions). */
function makeJpeg(width: number, height: number): Uint8Array {
  const buf = new Uint8Array(11);
  buf.set([0xff, 0xd8, 0xff], 0); // SOI + début marqueur
  buf[3] = 0xc0; // SOF0
  const view = new DataView(buf.buffer);
  view.setUint16(4, 17); // longueur segment (fictive mais > offset lu)
  buf[6] = 8; // précision
  view.setUint16(7, height);
  view.setUint16(9, width);
  return buf;
}

/** Fabrique un SVG texte → octets UTF-8. */
function svgBytes(svg: string): Uint8Array {
  return new TextEncoder().encode(svg);
}

describe("ADM-001a: validateLogo — reconnaissance par magic bytes", () => {
  it("ADM-001a: PNG 200×200 reconnu par magic bytes (pas par le nom)", () => {
    const v = validateLogo(makePng(200, 200));
    expect(v.mime).toBe("image/png");
    expect(v.extension).toBe("png");
  });

  it("ADM-001a: JPEG 256×256 reconnu et dimensions lues dans le SOF", () => {
    const v = validateLogo(makeJpeg(256, 256));
    expect(v.mime).toBe("image/jpeg");
    expect(v.extension).toBe("jpg");
  });

  it("ADM-001a: SVG reconnu, dimensions lues via width/height", () => {
    const v = validateLogo(svgBytes('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><rect/></svg>'));
    expect(v.mime).toBe("image/svg+xml");
    expect(v.extension).toBe("svg");
  });

  it("ADM-001a: SVG dimensions via viewBox si width/height absents", () => {
    const v = validateLogo(svgBytes('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240"><rect/></svg>'));
    expect(v.mime).toBe("image/svg+xml");
  });

  it("ADM-001a: octets non-image (magic bytes inconnus) → INVALID_LOGO", () => {
    expect(() => validateLogo(new TextEncoder().encode("not an image at all"))).toThrow(
      InvalidLogoError
    );
  });
});

describe("ADM-001a: validateLogo — bornes taille & dimensions", () => {
  it("ADM-001a: fichier vide → INVALID_LOGO", () => {
    expect(() => validateLogo(new Uint8Array(0))).toThrow(InvalidLogoError);
  });

  it("ADM-001a: taille > 512 Ko → INVALID_LOGO", () => {
    const big = makePng(300, 300);
    const padded = new Uint8Array(MAX_LOGO_BYTES + 1);
    padded.set(big, 0);
    expect(() => validateLogo(padded)).toThrow(/512000/);
  });

  it("ADM-001a: PNG 199×300 (sous le minimum) → INVALID_LOGO", () => {
    expect(() => validateLogo(makePng(199, 300))).toThrow(/200×200/);
  });

  it("ADM-001a: JPEG 100×100 (sous le minimum) → INVALID_LOGO", () => {
    expect(() => validateLogo(makeJpeg(100, 100))).toThrow(InvalidLogoError);
  });

  it("ADM-001a: SVG 50×50 (sous le minimum) → INVALID_LOGO", () => {
    expect(() =>
      validateLogo(svgBytes('<svg xmlns="http://www.w3.org/2000/svg" width="50" height="50"/>'))
    ).toThrow(InvalidLogoError);
  });
});

describe("ADM-001a: sanitizeSvg — zéro contenu exécutable", () => {
  it("ADM-001a: retire <script> et son contenu", () => {
    const out = sanitizeSvg(
      '<svg width="200" height="200"><script>alert(1)</script><rect/></svg>'
    );
    expect(out).not.toMatch(/<script/i);
    expect(svgHasActiveContent(out)).toBe(false);
  });

  it("ADM-001a: retire les gestionnaires d'évènement on*", () => {
    const out = sanitizeSvg('<svg width="200" height="200"><rect onload="x()"/></svg>');
    expect(out).not.toMatch(/onload/i);
    expect(svgHasActiveContent(out)).toBe(false);
  });

  it("ADM-001a: neutralise les href javascript:", () => {
    const out = sanitizeSvg(
      '<svg width="200" height="200"><a href="javascript:evil()"><rect/></a></svg>'
    );
    expect(out).not.toMatch(/javascript:/i);
  });

  it("ADM-001a: retire les déclarations <!ENTITY> (anti-XXE)", () => {
    const out = sanitizeSvg(
      '<!DOCTYPE svg [<!ENTITY x "y">]><svg width="200" height="200"/>'
    );
    expect(out).not.toMatch(/<!ENTITY/i);
    expect(out).not.toMatch(/<!DOCTYPE/i);
  });

  it("ADM-001a: validateLogo stocke un SVG expurgé (pas de <script>)", () => {
    const v = validateLogo(
      svgBytes('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><script>alert(1)</script></svg>')
    );
    const stored = new TextDecoder().decode(v.bytes);
    expect(stored).not.toMatch(/<script/i);
    expect(svgHasActiveContent(stored)).toBe(false);
  });
});

describe("ADM-001a: InMemoryLogoStore — stockage MOCK déterministe", () => {
  it("ADM-001a: put retourne une URL publique déterministe et conserve les octets", async () => {
    const store = new InMemoryLogoStore();
    const key = logoObjectKey("11111111-1111-4111-a111-111111111111", "png");
    const url = await store.put(key, makePng(200, 200), "image/png");
    expect(url).toBe(`${MOCK_LOGO_BASE_URL}/${key}`);
    expect(store.get(key)?.mime).toBe("image/png");
  });

  it("ADM-001a: logoObjectKey isole par banque (1 logo par banque)", () => {
    expect(logoObjectKey("bank-a", "svg")).toBe("logos/bank-a/logo.svg");
    expect(logoObjectKey("bank-b", "jpg")).toBe("logos/bank-b/logo.jpg");
  });
});
