/**
 * Tests unitaires — résolution IP cliente & TRUST_PROXY (Boucle 3 F3, SEC).
 *
 * LA LOI de sécurité : `X-Forwarded-For` / `X-Real-IP` ne sont pris en compte
 * QUE si `TRUST_PROXY` est activé. Sinon, ils sont ignorés (un attaquant ne peut
 * pas réinitialiser sa fenêtre de rate-limit ni usurper une IP d'audit).
 *
 * @module
 */

import { describe, it, expect, afterEach } from "vitest";
import { Hono } from "hono";
import { resolveClientIp, isProxyTrusted } from "src/lib/client-ip.js";

/** App minimale exposant l'IP résolue pour un ensemble d'en-têtes donné. */
function appExposingIp(): Hono {
  const app = new Hono();
  app.get("/ip", (c) => c.json({ ip: resolveClientIp(c) }));
  return app;
}

async function fetchIp(headers: Record<string, string>): Promise<string> {
  const res = await appExposingIp().request("/ip", { headers });
  return ((await res.json()) as { ip: string }).ip;
}

afterEach(() => {
  delete process.env["TRUST_PROXY"];
});

describe("SEC-F3: resolveClientIp respecte TRUST_PROXY", () => {
  it("SEC-F3: TRUST_PROXY off (défaut) → X-Forwarded-For IGNORÉ", async () => {
    delete process.env["TRUST_PROXY"];
    // Deux XFF différents mais aucune connexion réelle (test) → même valeur repli,
    // JAMAIS l'IP falsifiée du header.
    const a = await fetchIp({ "x-forwarded-for": "1.1.1.1" });
    const b = await fetchIp({ "x-forwarded-for": "2.2.2.2" });
    expect(a).not.toBe("1.1.1.1");
    expect(b).not.toBe("2.2.2.2");
    expect(a).toBe(b);
  });

  it("SEC-F3: TRUST_PROXY off → X-Real-IP IGNORÉ", async () => {
    delete process.env["TRUST_PROXY"];
    const ip = await fetchIp({ "x-real-ip": "203.0.113.5" });
    expect(ip).not.toBe("203.0.113.5");
  });

  it("SEC-F3: TRUST_PROXY on → 1er hop de X-Forwarded-For utilisé", async () => {
    process.env["TRUST_PROXY"] = "true";
    const ip = await fetchIp({ "x-forwarded-for": "198.51.100.9, 10.0.0.1" });
    expect(ip).toBe("198.51.100.9");
  });

  it("SEC-F3: TRUST_PROXY on → X-Real-IP à défaut de X-Forwarded-For", async () => {
    process.env["TRUST_PROXY"] = "1";
    const ip = await fetchIp({ "x-real-ip": "203.0.113.5" });
    expect(ip).toBe("203.0.113.5");
  });

  it("SEC-F3: isProxyTrusted — off par défaut, on sur 1/true", () => {
    delete process.env["TRUST_PROXY"];
    expect(isProxyTrusted()).toBe(false);
    process.env["TRUST_PROXY"] = "false";
    expect(isProxyTrusted()).toBe(false);
    process.env["TRUST_PROXY"] = "TRUE";
    expect(isProxyTrusted()).toBe(true);
    process.env["TRUST_PROXY"] = "1";
    expect(isProxyTrusted()).toBe(true);
  });
});
