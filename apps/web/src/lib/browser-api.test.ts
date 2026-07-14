// @vitest-environment node
/**
 * Tests for lib/browser-api — base API navigateur + test de garde (S3/RT-003).
 *
 * Garde anti-régression du bug PO « /dashboard vide » : aucun composant client
 * ("use client") ne doit lire `process.env.NEXT_PUBLIC_API_URL` — un appel
 * navigateur direct vers l'API est cross-origin et son préflight OPTIONS
 * répond 404 (pas de CORS côté API). Seule exception documentée : le socket
 * temps réel (lib/socket-provider), qui doit connaître l'origine WebSocket.
 * @module lib/browser-api.test
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { BROWSER_API_BASE } from "./browser-api";

/** Racine des sources web (le test tourne depuis apps/web). */
const SRC_ROOT = resolve(__dirname, "..");

/** Directive "use client" seule sur sa ligne (pas une mention en commentaire). */
const USE_CLIENT_RE = /^\s*["']use client["'];?\s*$/m;

/** Lecture CODE de l'env API (accès point ou index — pas les commentaires). */
const ENV_USAGE_RE = /process\.env(?:\.|\[["'])NEXT_PUBLIC_API_URL/;

/**
 * Exception documentée : le socket temps réel parle à l'origine WebSocket de
 * l'API (io(url)) et ne peut pas traverser le proxy HTTP /api/rt.
 */
const ALLOWLIST = new Set(["lib/socket-provider.tsx"]);

/** Liste récursive des sources .ts/.tsx hors tests. */
function listSources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listSources(full));
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

describe("S3: browser-api — base API unique du navigateur", () => {
  it("S3: la base navigateur est le proxy same-origin /api/rt (URL relative)", () => {
    expect(BROWSER_API_BASE).toBe("/api/rt");
    expect(BROWSER_API_BASE.startsWith("/")).toBe(true);
    expect(BROWSER_API_BASE).not.toMatch(/^https?:\/\//);
  });

  it("GARDE S3: aucun composant client ne lit NEXT_PUBLIC_API_URL (hors socket)", () => {
    const offenders: string[] = [];
    for (const file of listSources(SRC_ROOT)) {
      const rel = relative(SRC_ROOT, file);
      if (ALLOWLIST.has(rel)) continue;
      const content = readFileSync(file, "utf8");
      if (USE_CLIENT_RE.test(content) && ENV_USAGE_RE.test(content)) {
        offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });
});
