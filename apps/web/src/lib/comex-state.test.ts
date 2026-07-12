/**
 * Tests for comex-state (WEB-005) — pure derivation of the 3 COMEX KPIs from the
 * canonical network aggregate, TMA SLA colouring, NPS danger rule, partial-data
 * detection and month-over-month deltas.
 * @module lib/comex-state.test
 */
import { describe, it, expect } from "vitest";
import {
  deriveComexKpis,
  tmaSlaColor,
  npsColor,
  volumeDeltaPct,
  COMEX_KPI_COUNT,
  type NetworkAggregate,
} from "./comex-state";

const SLA = 15;

function agg(over: Partial<NetworkAggregate> = {}): NetworkAggregate {
  return { avgTma: 12, totalTickets: 45000, avgTauxSLA: 85, agencyCount: 42, nps: 40, ...over };
}

describe("WEB-005: comex-state — dérivation des 3 KPIs", () => {
  it("WEB-005: 3 KPIs rendus — NPS, TMA, Volume — exactement 3 sections", () => {
    // Le modèle expose exactement 3 KPIs, jamais un de plus (règle DS).
    expect(COMEX_KPI_COUNT).toBe(3);
    const kpis = deriveComexKpis(agg(), agg({ avgTma: 14, totalTickets: 40000, nps: 30 }), SLA);
    expect(kpis.nps).not.toBeUndefined();
    expect(kpis.tma).not.toBeUndefined();
    expect(kpis.volume).not.toBeUndefined();
    // Aucun 4e KPI n'est exposé.
    expect(Object.keys(kpis).sort()).toEqual(["nps", "tma", "volume"]);
  });

  it("WEB-005: NPS delta vs mois précédent calculé", () => {
    const kpis = deriveComexKpis(agg({ nps: 40 }), agg({ nps: 30 }), SLA);
    expect(kpis.nps.value).toBe(40);
    expect(kpis.nps.delta).toBe(10);
  });

  it("WEB-005: Volume clients servis — delta % mois courant vs précédent", () => {
    const kpis = deriveComexKpis(agg({ totalTickets: 45000 }), agg({ totalTickets: 40000 }), SLA);
    expect(kpis.volume.value).toBe(45000);
    expect(kpis.volume.deltaPct).toBe(volumeDeltaPct(45000, 40000));
    expect(kpis.volume.deltaPct).toBeCloseTo(12.5, 1);
  });
});

describe("WEB-005: TMA coloré success/warning/danger selon SLA — --danger réservé alertes", () => {
  it("WEB-005: TMA ≤ SLA → --success", () => {
    expect(tmaSlaColor(10, SLA)).toBe("var(--success)");
  });
  it("WEB-005: TMA entre SLA et 2×SLA → --warning", () => {
    expect(tmaSlaColor(20, SLA)).toBe("var(--warning)");
  });
  it("WEB-005: TMA > 2×SLA → --danger (alerte réelle, jamais décoratif)", () => {
    expect(tmaSlaColor(40, SLA)).toBe("var(--danger)");
  });
});

describe("WEB-005: NPS négatif → --danger sur valeur", () => {
  it("WEB-005: NPS < 0 → --danger", () => {
    expect(npsColor(-5)).toBe("var(--danger)");
  });
  it("WEB-005: NPS ≥ 0 → couleur neutre (ink-strong), --danger jamais décoratif", () => {
    expect(npsColor(0)).toBe("var(--ink-strong)");
    expect(npsColor(40)).toBe("var(--ink-strong)");
  });
  it("WEB-005: NPS null → couleur neutre (pas de --danger sur donnée absente)", () => {
    expect(npsColor(null)).toBe("var(--ink-strong)");
  });
});

describe("WEB-005: données partielles → annotation, pas de 0 brut", () => {
  it("WEB-005: NPS null (aucun feedback) → KPI marqué partiel", () => {
    const kpis = deriveComexKpis(agg({ nps: null }), agg({ nps: 30 }), SLA);
    expect(kpis.nps.value).toBeNull();
    expect(kpis.nps.partial).toBe(true);
  });

  it("WEB-005: volume à 0 non brut — marqué partiel pour annotation contextuelle", () => {
    const kpis = deriveComexKpis(agg({ totalTickets: 0 }), agg({ totalTickets: 40000 }), SLA);
    expect(kpis.volume.value).toBe(0);
    expect(kpis.volume.partial).toBe(true);
  });

  it("WEB-005: données complètes → aucun marqueur partiel", () => {
    const kpis = deriveComexKpis(agg(), agg(), SLA);
    expect(kpis.nps.partial).toBe(false);
    expect(kpis.tma.partial).toBe(false);
    expect(kpis.volume.partial).toBe(false);
  });

  it("WEB-005: aucun mois précédent → deltas null (pas de comparaison inventée)", () => {
    const kpis = deriveComexKpis(agg({ nps: 40, totalTickets: 45000 }), null, SLA);
    expect(kpis.nps.delta).toBeNull();
    expect(kpis.volume.deltaPct).toBeNull();
  });
});

describe("WEB-005: volumeDeltaPct — bornes", () => {
  it("WEB-005: base précédente à 0 → delta% null (pas de division par zéro)", () => {
    expect(volumeDeltaPct(100, 0)).toBeNull();
  });
});
