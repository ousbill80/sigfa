/**
 * Tests for the network direction dashboard state model (WEB-004).
 * @module lib/network-state.test
 */
import { describe, it, expect } from "vitest";
import {
  benchmarkBadge,
  cityCoordinate,
  CI_CITY_COORDINATES,
  networkReducer,
  initialNetworkState,
  paginate,
  PAGE_SIZE,
  type NetworkAgency,
  type NetworkAction,
} from "./network-state";

const SLA = 15;

/** Valid UUIDs — agency:offline payload is contract-validated (uuid required). */
const UUID_A1 = "11111111-1111-4111-a111-111111111111";

function agency(over: Partial<NetworkAgency> = {}): NetworkAgency {
  return {
    agencyId: "33333333-3333-4333-a333-333333333333",
    agencyName: "Agence Plateau",
    city: "Abidjan",
    tma: 9,
    tauxSLA: 92,
    offline: false,
    ...over,
  };
}

describe("WEB-004: badges classement selon seuils SLA", () => {
  it("WEB-004: classement trié par TMA — badge --success si TMA ≤ SLA", () => {
    expect(benchmarkBadge(9, SLA, false)).toBe("var(--success)");
    expect(benchmarkBadge(15, SLA, false)).toBe("var(--success)");
  });

  it("WEB-004: badge --warning si TMA ≤ 2×SLA", () => {
    expect(benchmarkBadge(16, SLA, false)).toBe("var(--warning)");
    expect(benchmarkBadge(30, SLA, false)).toBe("var(--warning)");
  });

  it("WEB-004: --danger uniquement si TMA > 2×SLA — zéro usage décoratif", () => {
    expect(benchmarkBadge(31, SLA, false)).toBe("var(--danger)");
    expect(benchmarkBadge(60, SLA, false)).toBe("var(--danger)");
    // À exactement 2×SLA ce n'est PAS danger (jamais décoratif).
    expect(benchmarkBadge(30, SLA, false)).not.toBe("var(--danger)");
  });

  it("WEB-004: agency:offline → badge --info (état dégradé, jamais danger)", () => {
    // Même une agence en dépassement, une fois hors ligne, passe en --info.
    expect(benchmarkBadge(99, SLA, true)).toBe("var(--info)");
    expect(benchmarkBadge(9, SLA, true)).toBe("var(--info)");
  });
});

describe("WEB-004: carte SVG — coordonnées par ville CI", () => {
  it("WEB-004: cityCoordinate mappe agency.city sur un point du SVG CI", () => {
    const abidjan = cityCoordinate("Abidjan");
    expect(abidjan).not.toBeNull();
    expect(typeof abidjan?.x).toBe("number");
    expect(typeof abidjan?.y).toBe("number");
  });

  it("WEB-004: villes principales de Côte d'Ivoire présentes dans la carte", () => {
    for (const city of ["Abidjan", "Yamoussoukro", "Bouaké", "Korhogo", "San-Pédro"]) {
      expect(CI_CITY_COORDINATES[city]).toBeDefined();
    }
  });

  it("WEB-004: ville inconnue → null (pas de marqueur fantôme)", () => {
    expect(cityCoordinate("Paris")).toBeNull();
  });

  it("WEB-004: cityCoordinate insensible à la casse / accents de saisie", () => {
    expect(cityCoordinate("abidjan")).toEqual(CI_CITY_COORDINATES["Abidjan"]);
  });
});

describe("WEB-004: pagination >20 agences — tri conservé", () => {
  const many: NetworkAgency[] = Array.from({ length: 45 }, (_, i) =>
    agency({ agencyId: `a-${i}`, tma: 45 - i }),
  );

  it("WEB-004: PAGE_SIZE vaut 20", () => {
    expect(PAGE_SIZE).toBe(20);
  });

  it("WEB-004: pagination > 20 agences — 20 par page, tri décroissant conservé", () => {
    const page1 = paginate(many, 1);
    const page2 = paginate(many, 2);
    const page3 = paginate(many, 3);
    expect(page1).toHaveLength(20);
    expect(page2).toHaveLength(20);
    expect(page3).toHaveLength(5);
    // Tri TMA décroissant conservé entre pages.
    expect(page1[0]?.tma).toBe(45);
    expect(page1[19]?.tma).toBeGreaterThan(page2[0]!.tma);
    expect(page2[0]?.tma).toBe(25);
  });

  it("WEB-004: page hors borne → tableau vide", () => {
    expect(paginate(many, 99)).toHaveLength(0);
  });
});

describe("WEB-004: reducer événements simulés", () => {
  it("WEB-004: seed trie les agences par TMA décroissant", () => {
    const state = networkReducer(initialNetworkState, {
      type: "seed",
      agencies: [agency({ agencyId: "low", tma: 5 }), agency({ agencyId: "high", tma: 40 })],
      slaMinutes: SLA,
    });
    expect(state.agencies[0]?.agencyId).toBe("high");
    expect(state.agencies[1]?.agencyId).toBe("low");
  });

  it("WEB-004: agency:offline → marqueur + ligne classement passent hors ligne", () => {
    const seeded = networkReducer(initialNetworkState, {
      type: "seed",
      agencies: [agency({ agencyId: UUID_A1 })],
      slaMinutes: SLA,
    });
    const next = networkReducer(seeded, {
      type: "agency:offline",
      payload: { agencyId: UUID_A1, since: "2026-07-12T09:00:00Z" },
    });
    expect(next.agencies[0]?.offline).toBe(true);
  });

  it("WEB-004: agency:offline payload invalide → état inchangé", () => {
    const seeded = networkReducer(initialNetworkState, {
      type: "seed",
      agencies: [agency({ agencyId: UUID_A1 })],
      slaMinutes: SLA,
    });
    const next = networkReducer(seeded, { type: "agency:offline", payload: { nope: true } });
    expect(next.agencies[0]?.offline).toBe(false);
  });

  it("WEB-004: alert:manager d'une agence → panneau alertes, source agence identifiée", () => {
    const seeded = networkReducer(initialNetworkState, {
      type: "seed",
      agencies: [agency({ agencyId: "a1", agencyName: "Agence Cocody" })],
      slaMinutes: SLA,
    });
    const next = networkReducer(seeded, {
      type: "alert:manager",
      payload: { type: "SLA_BREACH", payload: {} },
      agencyId: "a1",
      id: "alert-1",
    });
    expect(next.alerts).toHaveLength(1);
    expect(next.alerts[0]?.agencyId).toBe("a1");
    expect(next.alerts[0]?.agencyName).toBe("Agence Cocody");
    expect(next.alerts[0]?.type).toBe("SLA_BREACH");
  });

  it("WEB-004: alert:manager payload invalide → état inchangé", () => {
    const next = networkReducer(initialNetworkState, {
      type: "alert:manager",
      payload: { type: "NOT_A_REAL_TYPE", payload: {} },
      agencyId: "a1",
      id: "x",
    });
    expect(next.alerts).toHaveLength(0);
  });

  it("WEB-004: reconnexion resync — connection repasse connected", () => {
    const off = networkReducer(initialNetworkState, { type: "connection", status: "offline" });
    expect(off.connection).toBe("offline");
    const back = networkReducer(off, { type: "connection", status: "connected" });
    expect(back.connection).toBe("connected");
  });

  it("WEB-004: action inconnue → état inchangé", () => {
    const next = networkReducer(initialNetworkState, { type: "unknown" } as unknown as NetworkAction);
    expect(next).toBe(initialNetworkState);
  });
});
