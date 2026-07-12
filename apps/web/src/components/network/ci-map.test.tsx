/**
 * Tests for CiMap (WEB-004) — static Côte d'Ivoire SVG, zero Leaflet.
 * @module components/network/ci-map.test
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CiMap } from "./ci-map";
import type { NetworkAgency } from "@/lib/network-state";

function agency(over: Partial<NetworkAgency> = {}): NetworkAgency {
  return {
    agencyId: "a1",
    agencyName: "Agence Plateau",
    city: "Abidjan",
    tma: 9,
    tauxSLA: 92,
    offline: false,
    ...over,
  };
}

describe("WEB-004: carte SVG statique Côte d'Ivoire", () => {
  it("WEB-004: carte SVG statique Côte d'Ivoire commité dans le repo — rendu SVG inline", () => {
    render(<CiMap agencies={[agency()]} slaMinutes={15} />);
    const svg = screen.getByTestId("ci-map-svg");
    expect(svg.tagName.toLowerCase()).toBe("svg");
    // Le tracé du pays est inline dans le SVG (path committé).
    expect(svg.querySelector("path")).not.toBeNull();
  });

  it("WEB-004: marqueur positionné sur agency.city avec la couleur de badge", () => {
    render(
      <CiMap
        agencies={[
          agency({ agencyId: "s", city: "Abidjan", tma: 9 }),
          agency({ agencyId: "w", city: "Bouaké", tma: 20 }),
          agency({ agencyId: "d", city: "Korhogo", tma: 40 }),
        ]}
        slaMinutes={15}
      />,
    );
    expect(screen.getByTestId("marker-s").getAttribute("fill")).toBe("var(--success)");
    expect(screen.getByTestId("marker-w").getAttribute("fill")).toBe("var(--warning)");
    expect(screen.getByTestId("marker-d").getAttribute("fill")).toBe("var(--danger)");
  });

  it("WEB-004: agency:offline → marqueur carte en --info", () => {
    render(<CiMap agencies={[agency({ agencyId: "o", offline: true, tma: 40 })]} slaMinutes={15} />);
    expect(screen.getByTestId("marker-o").getAttribute("fill")).toBe("var(--info)");
  });

  it("WEB-004: ville hors carte → aucun marqueur fantôme", () => {
    render(<CiMap agencies={[agency({ agencyId: "ghost", city: "Paris" })]} slaMinutes={15} />);
    expect(screen.queryByTestId("marker-ghost")).toBeNull();
  });

  it("WEB-004: carte tokens uniquement — aucune couleur hexadécimale en dur", () => {
    const { container } = render(<CiMap agencies={[agency()]} slaMinutes={15} />);
    expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{6}/);
  });
});
