/**
 * Tests for /tv/[agencyId] page — rend l'affichage TV premium par agence.
 *
 * La page consomme le contexte socket (câblé par le layout via TvRealtime) et
 * délègue le rendu à TvDisplay. En l'absence de provider actif (repli offline),
 * elle rend l'écran d'attente sans crasher (l'un des 5 états requis).
 *
 * @module app/tv/[agencyId]/page.test
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import TvAgencyPage from "./page";
import { DEFAULT_AGENCY_NAME } from "@/lib/bank-branding";

describe("RT-003: /tv/[agencyId] page", () => {
  it("RT-003: rend l'écran TV (repli offline, aucun provider) sans crash", async () => {
    const element = await TvAgencyPage({
      params: Promise.resolve({ agencyId: "33333333-3333-4333-a333-333333333333" }),
    });
    const { getByTestId } = render(element);
    // Écran rendu : racine + surface TV présentes (état d'attente par défaut).
    expect(getByTestId("tv-root")).toBeTruthy();
    expect(getByTestId("tv-screen")).toBeTruthy();
  });

  it("TV-LOGO: bandeau — pastille + agence via provisionnement (pas de littéral page)", async () => {
    const element = await TvAgencyPage({
      params: Promise.resolve({ agencyId: "33333333-3333-4333-a333-333333333333" }),
    });
    const { getByTestId, queryByTestId } = render(element);
    // Convention lib/bank-branding : sans logo provisionné, pastille + initiale.
    expect(getByTestId("tv-brand-mark").textContent).toBe("S");
    expect(queryByTestId("tv-brand-logo")).toBeNull();
    expect(getByTestId("tv-agency-name").textContent).toBe(DEFAULT_AGENCY_NAME);
  });
});
