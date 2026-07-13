/**
 * IA-002 — Tests du routeur GET /ai/forecast (CONTRACT-008), SANS conteneur.
 *
 * On monte le routeur sur un mini-app Hono en injectant le `tenant` (comme le fait
 * le middleware global) et un `ForecastDataProvider` synthétique. Aucun accès DB :
 * le runtime réel est GATED, mais le contrat de la route est testable maintenant.
 *
 * Couvre les critères ⊛ :
 *  - 200 : série horaire conforme + drivers[] + lowConfidence + meta (AiMeta) ;
 *  - 422 INSUFFICIENT_HISTORY { requiredDays:90, availableDays } si < 90 j ;
 *  - 400 sur agencyId/date invalides ; 403 hors scope agence ;
 *  - provider par défaut (aucune matérialisation) → 422 (gated).
 *
 * Nommage strict : `IA-002: <description>`.
 *
 * @module
 */

import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import {
  createAiForecastRouter,
  emptyForecastDataProvider,
  type ForecastDataProvider,
} from "src/routes/ai-forecast.js";
import type { TenantContext } from "src/middleware/tenant.js";
import { makeDay, makeFeature, FX_BANK, FX_AGENCY } from "src/ai/forecast-fixtures.js";
import type { FeatureRecord } from "src/ai/feature-engine.js";

/** Construit un tenant AGENCY_DIRECTOR ayant accès à l'agence de test. */
function tenant(overrides: Partial<TenantContext> = {}): TenantContext {
  return {
    requestId: "req-test",
    userId: "user-1",
    bankId: FX_BANK,
    role: "AGENCY_DIRECTOR",
    agencyIds: [FX_AGENCY],
    ...overrides,
  };
}

/** Env du mini-app de test (injecte le `tenant` comme le middleware global). */
interface TestEnv {
  Variables: { tenant: TenantContext };
}

/** Monte le routeur avec un tenant injecté et un provider donné. */
function appWith(provider: ForecastDataProvider, tctx: TenantContext): Hono<TestEnv> {
  const app = new Hono<TestEnv>();
  app.use("*", async (c, next) => {
    c.set("tenant", tctx);
    await next();
  });
  app.route("/api/v1", createAiForecastRouter({ provider }));
  return app;
}

/** Provider synthétique renvoyant des records fixes. */
function providerOf(records: readonly FeatureRecord[]): ForecastDataProvider {
  return async () => ({ records });
}

/** Fabrique ≥ 90 jours civils distincts d'historique (suffisant pour l'agence). */
function sufficientHistory(): FeatureRecord[] {
  const recs: FeatureRecord[] = [];
  let n = 0;
  for (let m = 1; m <= 4 && n < 90; m += 1) {
    for (let day = 1; day <= 28 && n < 90; day += 1) {
      const date = `2026-0${m}-${String(day).padStart(2, "0")}`;
      recs.push(makeFeature({ date }));
      n += 1;
    }
  }
  return recs;
}

describe("ai-forecast route", () => {
  it("IA-002: 200 — série horaire conforme CONTRACT-008 (drivers[], lowConfidence, meta AiMeta)", async () => {
    // ≥ 90 jours distincts d'historique + buckets de la date cible.
    const recs: FeatureRecord[] = sufficientHistory();
    const target = "2026-07-15";
    recs.push(...makeDay(target, [
      { hour: 8, roll: 12 },
      { hour: 9, roll: 25 },
      { hour: 10, roll: 38 },
    ]));

    const app = appWith(providerOf(recs), tenant());
    const res = await app.request(`/api/v1/ai/forecast?agencyId=${FX_AGENCY}&date=${target}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      agencyId: string;
      date: string;
      contextualFactors: string[];
      forecast: Array<{ hour: string; expectedTickets: number; confidence: number; drivers: unknown[]; lowConfidence: boolean }>;
      meta: { modelVersion: string; computedAt: string; dataWindow: string; featureSetVersion: string; availableDays: number };
    };
    expect(body.agencyId).toBe(FX_AGENCY);
    expect(body.date).toBe(target);
    expect(body.forecast.map((h) => h.hour)).toEqual(["08:00", "09:00", "10:00"]);
    for (const h of body.forecast) {
      expect(Array.isArray(h.drivers)).toBe(true);
      expect(h.drivers.length).toBeGreaterThan(0);
      expect(typeof h.lowConfidence).toBe("boolean");
    }
    expect(body.meta.modelVersion).toBe("forecast-ia002-v1");
    expect(body.meta.availableDays).toBeGreaterThanOrEqual(90);
    expect(body.meta.featureSetVersion).toBeDefined();
    expect(body.meta.dataWindow).toMatch(/^\d{4}-\d{2}-\d{2}\/\d{4}-\d{2}-\d{2}$/);
  });

  it("IA-002: 422 INSUFFICIENT_HISTORY { requiredDays:90, availableDays } si historique < 90 j", async () => {
    const recs = makeDay("2026-07-15", [{ hour: 9, roll: 20 }]); // 1 jour seulement
    const app = appWith(providerOf(recs), tenant());
    const res = await app.request(`/api/v1/ai/forecast?agencyId=${FX_AGENCY}&date=2026-07-15`);
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string; details: { requiredDays: number; availableDays: number } } };
    expect(body.error.code).toBe("INSUFFICIENT_HISTORY");
    expect(body.error.details.requiredDays).toBe(90);
    expect(body.error.details.availableDays).toBe(1);
  });

  it("IA-002: provider par défaut (aucune matérialisation) → 422 (runtime GATED)", async () => {
    const app = appWith(emptyForecastDataProvider, tenant());
    const res = await app.request(`/api/v1/ai/forecast?agencyId=${FX_AGENCY}&date=2026-07-15`);
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string; details: { availableDays: number } } };
    expect(body.error.code).toBe("INSUFFICIENT_HISTORY");
    expect(body.error.details.availableDays).toBe(0);
  });

  it("IA-002: 400 BAD_REQUEST si agencyId n'est pas un UUID", async () => {
    const app = appWith(emptyForecastDataProvider, tenant());
    const res = await app.request(`/api/v1/ai/forecast?agencyId=not-a-uuid&date=2026-07-15`);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("BAD_REQUEST");
  });

  it("IA-002: 400 BAD_REQUEST si date mal formée", async () => {
    const app = appWith(emptyForecastDataProvider, tenant());
    const res = await app.request(`/api/v1/ai/forecast?agencyId=${FX_AGENCY}&date=15-07-2026`);
    expect(res.status).toBe(400);
  });

  it("IA-002: 400 BAD_REQUEST si agencyId absent (query manquante)", async () => {
    const app = appWith(emptyForecastDataProvider, tenant());
    const res = await app.request(`/api/v1/ai/forecast?date=2026-07-15`);
    expect(res.status).toBe(400);
  });

  it("IA-002: 400 BAD_REQUEST si date absente (query manquante)", async () => {
    const app = appWith(emptyForecastDataProvider, tenant());
    const res = await app.request(`/api/v1/ai/forecast?agencyId=${FX_AGENCY}`);
    expect(res.status).toBe(400);
  });

  it("IA-002: routeur SANS deps utilise le provider par défaut (aucune matérialisation) → 422 gated", async () => {
    // Couvre le comportement de production réel (route montée par le registre).
    const app = new Hono<TestEnv>();
    app.use("*", async (c, next) => {
      c.set("tenant", tenant());
      await next();
    });
    app.route("/api/v1", createAiForecastRouter());
    const res = await app.request(`/api/v1/ai/forecast?agencyId=${FX_AGENCY}&date=2026-07-15`);
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INSUFFICIENT_HISTORY");
  });

  it("IA-002: dataWindow reflète l'étendue réelle (min/max) même avec dates en désordre", async () => {
    // Records volontairement en ordre décroissant → exerce les deux bornes min/max.
    const recs: FeatureRecord[] = sufficientHistory().reverse();
    const target = "2026-07-15";
    recs.push(...makeDay(target, [{ hour: 9, roll: 20 }]));
    const app = appWith(providerOf(recs), tenant());
    const res = await app.request(`/api/v1/ai/forecast?agencyId=${FX_AGENCY}&date=${target}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { meta: { dataWindow: string } };
    // min = plus ancienne date d'historique, max = date cible (2026-07-15).
    expect(body.meta.dataWindow.endsWith("/2026-07-15")).toBe(true);
    expect(body.meta.dataWindow.startsWith("2026-01-01/")).toBe(true);
  });

  it("IA-002: 403 FORBIDDEN si l'agence est hors du scope du JWT", async () => {
    const app = appWith(emptyForecastDataProvider, tenant({ agencyIds: [] }));
    const res = await app.request(`/api/v1/ai/forecast?agencyId=${FX_AGENCY}&date=2026-07-15`);
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("IA-002: 403 FORBIDDEN si le tenant n'a pas de bankId", async () => {
    const app = appWith(emptyForecastDataProvider, tenant({ bankId: null }));
    const res = await app.request(`/api/v1/ai/forecast?agencyId=${FX_AGENCY}&date=2026-07-15`);
    expect(res.status).toBe(403);
  });
});
