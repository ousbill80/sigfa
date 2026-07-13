/**
 * Tests unitaires — NET-003 : lint des dashboards as-code + couverture des domaines.
 *
 * Critère : dashboards Grafana provisionnés (as-code) — API / temps réel / infra /
 * parc bornes présents (test/lint des définitions dashboard). Les artefacts JSON
 * réels de `ops/monitoring/dashboards/` sont chargés et lintés ici.
 *
 * @module
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { lintDashboard, lintDashboardSet } from "src/observability/dashboard-lint.js";

const DASHBOARD_DIR = resolve(
  import.meta.dirname,
  "../../../../ops/monitoring/dashboards"
);

function loadDashboards(): unknown[] {
  const files = readdirSync(DASHBOARD_DIR).filter((f) => f.endsWith(".json"));
  return files.map((f) => JSON.parse(readFileSync(resolve(DASHBOARD_DIR, f), "utf8")));
}

describe("NET-003: dashboards Grafana as-code — lint structurel des définitions", () => {
  it("NET-003: chaque dashboard réel de ops/monitoring est structurellement valide", () => {
    for (const dash of loadDashboards()) {
      const res = lintDashboard(dash);
      expect(res.errors).toEqual([]);
      expect(res.valid).toBe(true);
    }
  });

  it("NET-003: l'ensemble couvre les 4 domaines API / temps réel / infra / parc bornes", () => {
    const res = lintDashboardSet(loadDashboards());
    expect(res.errors).toEqual([]);
    expect(res.valid).toBe(true);
  });
});

describe("NET-003: lint rejette les définitions invalides (garde-fou)", () => {
  it("NET-003: non-objet → invalide", () => {
    expect(lintDashboard("nope").valid).toBe(false);
    expect(lintDashboard(null).valid).toBe(false);
    expect(lintDashboard([]).valid).toBe(false);
  });

  it("NET-003: uid/title/domain manquants → erreurs", () => {
    const res = lintDashboard({ panels: [] });
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes("uid"))).toBe(true);
    expect(res.errors.some((e) => e.includes("title"))).toBe(true);
    expect(res.errors.some((e) => e.includes("domain"))).toBe(true);
  });

  it("NET-003: domaine hors liste → erreur", () => {
    const res = lintDashboard({
      uid: "x",
      title: "X",
      domain: "unknown",
      panels: [{ title: "p", type: "stat", targets: [{ expr: "up" }] }],
    });
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes("domain"))).toBe(true);
  });

  it("NET-003: panneau sans cible / expr vide → erreur", () => {
    const noTargets = lintDashboard({
      uid: "x",
      title: "X",
      domain: "api",
      panels: [{ title: "p", type: "stat", targets: [] }],
    });
    expect(noTargets.valid).toBe(false);

    const emptyExpr = lintDashboard({
      uid: "x",
      title: "X",
      domain: "api",
      panels: [{ title: "p", type: "stat", targets: [{ expr: "" }] }],
    });
    expect(emptyExpr.valid).toBe(false);
  });

  it("NET-003: aucun panneau → erreur", () => {
    const res = lintDashboard({ uid: "x", title: "X", domain: "api", panels: [] });
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes("panneau"))).toBe(true);
  });

  it("NET-003: set incomplet (domaine manquant) → erreur de couverture", () => {
    const partial = [
      { uid: "a", title: "A", domain: "api", panels: [{ title: "p", type: "stat", targets: [{ expr: "up" }] }] },
    ];
    const res = lintDashboardSet(partial);
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes("realtime"))).toBe(true);
    expect(res.errors.some((e) => e.includes("infra"))).toBe(true);
    expect(res.errors.some((e) => e.includes("kiosks"))).toBe(true);
  });
});
