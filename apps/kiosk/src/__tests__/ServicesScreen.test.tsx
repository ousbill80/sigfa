/**
 * KIOSK-BORNE — Tests de l'écran « Prise de ticket » groupé par familles.
 *
 * Refonte : une SECTION par service (famille) avec la grille des tuiles de ses
 * opérations (chargées en PARALLÈLE via @sigfa/contracts), bandeau d'en-tête
 * persistant (banque + agence + date/heure vivante), clic tuile → confirmation
 * DIRECTE. Service sans opération → tuile unique du service. 5 états conservés.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterEach, afterAll } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { NextIntlClientProvider } from "next-intl";
import { http, HttpResponse } from "msw";
import { server } from "@/mocks/server";

// Mock next/navigation
const mockPush = vi.fn();
const mockBack = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, back: mockBack }),
  useParams: () => ({ locale: "fr" }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/hooks/useInactivityTimeout", () => ({
  useInactivityTimeout: vi.fn(),
}));

vi.mock("@/hooks/useAccessibilityMode", () => ({
  useAccessibilityMode: () => ({
    isAccessibilityMode: false,
    toggleAccessibilityMode: vi.fn(),
  }),
}));

import { ServicesScreen, type ServiceItem } from "@/components/ServicesScreen";
import { useInactivityTimeout } from "@/hooks/useInactivityTimeout";

// Ids alignés sur le catalogue de démo BNI des handlers MSW : chaque famille
// reçoit SES opérations (filtrage par serviceId), jamais celles d'une autre.
const MOCK_SERVICES: ServiceItem[] = [
  { id: "svc-caisse", name: "Caisse", code: "cash", estimatedMinutes: 8, isOpen: true },
  { id: "svc-moyens-paiement", name: "Moyen de paiement", code: "card", estimatedMinutes: 10, isOpen: true },
];

const CLOSED_SERVICE: ServiceItem = {
  id: "svc-closed",
  name: "Crédit",
  code: "credit",
  estimatedMinutes: 20,
  isOpen: false,
  schedule: "Lu-Ve 09h-17h",
};

const frMessages = {
  services003: {
    title: "Prise de ticket",
    subtitle: "Touchez l'opération de votre choix",
    backButton: "Retour",
    closedService: "Fermé — {schedule}",
    accessibilityButton: "Accès prioritaire",
    emptyTitle: "Aucun service disponible",
    emptyMessage: "Rendez-vous à l'accueil — un agent vous aidera.",
    loadingMessage: "Chargement des opérations...",
    errorTitle: "Opérations indisponibles",
    errorMessage: "Impossible de charger les opérations. Réessayez ou adressez-vous à l'accueil.",
    retryButton: "Réessayer",
    offlineBanner: "Mode hors connexion",
    advisorCard: "Voir mon conseiller",
    advisorHint: "Rencontrer un chargé de clientèle",
    scrollHint: "Plus de services en bas",
  },
  degraded007: {
    longQueueTitle: "Forte affluence — environ {estimate} min",
    longQueueMessage: "Recevez un SMS et revenez à l'heure de votre passage.",
    phoneFieldLabel: "Votre numéro de téléphone",
  },
};

const enMessages = {
  services003: {
    title: "Take a ticket",
    subtitle: "Tap the operation of your choice",
    backButton: "Back",
    closedService: "Closed — {schedule}",
    accessibilityButton: "Priority access",
    emptyTitle: "No services available",
    emptyMessage: "Please go to reception — a staff member will assist you.",
    loadingMessage: "Loading operations...",
    errorTitle: "Operations unavailable",
    errorMessage: "Unable to load operations. Retry or go to reception.",
    retryButton: "Retry",
    offlineBanner: "Offline mode",
    advisorCard: "See my advisor",
    advisorHint: "Meet a relationship manager",
    scrollHint: "More services below",
  },
  degraded007: {
    longQueueTitle: "High volume — about {estimate} min",
    longQueueMessage: "Receive an SMS and come back at your turn.",
    phoneFieldLabel: "Your phone number",
  },
};

function renderScreen(
  services: ServiceItem[] = MOCK_SERVICES,
  { locale = "fr", messages = frMessages }: { locale?: string; messages?: typeof frMessages } = {}
) {
  return render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      <ServicesScreen
        services={services}
        agencyId="agt-001"
        agencyName="Cocody Angré"
        bankName="Banque Ivoire"
      />
    </NextIntlClientProvider>
  );
}

beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("KIOSK-BORNE: ServicesScreen — prise de ticket par familles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("KIOSK-BORNE: une section par famille, tuiles ≥ 96px, icône pastille --brand-soft, libellé ≥ 20px (FR/EN)", async () => {
    for (const { locale, messages } of [
      { locale: "fr", messages: frMessages },
      { locale: "en", messages: enMessages },
    ]) {
      const { unmount, container } = renderScreen(MOCK_SERVICES, { locale, messages });

      // Une section par service, dans l'ordre.
      const sections = await screen.findAllByTestId("family-section");
      expect(sections.length, `Sections for ${locale}`).toBe(2);
      const titles = screen.getAllByTestId("family-title");
      expect(titles.map((el) => el.textContent)).toEqual(["Caisse", "Moyen de paiement"]);

      // Tuiles d'opérations : catalogue BNI — 11 (Caisse) + 9 (Moyen de paiement).
      const tiles = screen.getAllByTestId("operation-tile");
      expect(tiles.length, `Tiles for ${locale}`).toBe(20);
      tiles.forEach((tile) => {
        expect((tile as HTMLElement).style.minHeight).toBe("96px");
      });

      // Icône SVG dans une pastille --brand-soft — zéro emoji.
      const icons = container.querySelectorAll("[data-testid='operation-tile-icon']");
      icons.forEach((icon) => {
        const iconEl = icon as HTMLElement;
        expect(iconEl.style.backgroundColor).toBe("var(--brand-soft)");
        expect(iconEl.querySelector("svg")).toBeInTheDocument();
        expect(iconEl.textContent).toBe("");
      });

      // Libellé lisible ≥ 20px, accents intacts (UTF-8).
      const labels = screen.getAllByTestId("operation-tile-label");
      labels.forEach((label) => {
        expect(parseInt((label as HTMLElement).style.fontSize, 10)).toBeGreaterThanOrEqual(20);
      });
      expect(screen.getAllByText("Retrait espèces").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Rechargement de carte prépayée").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Demande de chéquier").length).toBeGreaterThan(0);

      unmount();
    }
  });

  it("KIOSK-BORNE: chaque famille reçoit SES opérations (filtrage serviceId) — aucune duplication entre familles", async () => {
    renderScreen();
    const sections = await screen.findAllByTestId("family-section");
    expect(sections.length).toBe(2);

    const labelsOf = (section: HTMLElement) =>
      Array.from(section.querySelectorAll("[data-testid='operation-tile-label']")).map(
        (el) => el.textContent ?? ""
      );
    const caisse = labelsOf(sections[0] as HTMLElement);
    const paiement = labelsOf(sections[1] as HTMLElement);

    // Volumes du catalogue BNI, opérations distinctes par famille.
    expect(caisse.length).toBe(11);
    expect(paiement.length).toBe(9);
    expect(caisse).toContain("Transfert Orange Money");
    expect(paiement).toContain("Demande d'opposition carte/chèque");
    // Régression « mêmes 4 ops partout » : intersection VIDE entre familles.
    const overlap = caisse.filter((label) => paiement.includes(label));
    expect(overlap).toEqual([]);
  });

  it("KIOSK-BORNE: bandeau d'en-tête persistant — banque (pastille brand), agence, date + heure vivante", async () => {
    renderScreen();
    await screen.findAllByTestId("family-section");

    const banner = screen.getByTestId("kiosk-header-banner");
    expect(banner).toBeInTheDocument();
    expect(screen.getByTestId("kiosk-header-bank").textContent).toBe("Banque Ivoire");
    expect(screen.getByTestId("kiosk-header-agency").textContent).toBe("Cocody Angré");
    // Pastille brand avec l'initiale de la banque (texte, jamais d'image).
    const badge = screen.getByTestId("kiosk-header-bank-badge");
    expect(badge.textContent).toBe("B");
    expect((badge as HTMLElement).style.backgroundColor).toBe("var(--brand)");
    // Date + heure présentes (formats localisés).
    expect(screen.getByTestId("kiosk-header-time").textContent).toMatch(/\d/);
    expect(screen.getByTestId("kiosk-header-date").textContent).toMatch(/\d{4}/);
  });

  it("KIOSK-BORNE: clic tuile opération → navigation DIRECTE vers la confirmation (serviceId + operationId + libellé)", async () => {
    renderScreen();
    const tiles = await screen.findAllByTestId("operation-tile");
    fireEvent.click(tiles[0]); // « Retrait espèces » (op-retrait-especes) de la famille Caisse.

    expect(mockPush).toHaveBeenCalledTimes(1);
    const target = mockPush.mock.calls[0][0] as string;
    expect(target).toContain("/fr/confirmation?");
    expect(target).toContain("serviceId=svc-caisse");
    expect(target).toContain("operationId=op-retrait-especes");
    expect(target).toContain("agencyId=agt-001");
    expect(target).toContain(
      new URLSearchParams({ operationLabel: "Retrait espèces" }).toString()
    );
  });

  it("KIOSK-BORNE: service SANS opération → tuile unique du service lui-même (confirmation sans operationId)", async () => {
    server.use(
      http.get("*/public/agencies/:agencyId/operations", () =>
        HttpResponse.json({ data: [] }, { status: 200 })
      )
    );
    renderScreen([MOCK_SERVICES[0]]);

    const tile = await screen.findByTestId("service-tile");
    expect(tile).toBeInTheDocument();
    expect(screen.queryAllByTestId("operation-tile").length).toBe(0);

    fireEvent.click(tile);
    const target = mockPush.mock.calls[0][0] as string;
    expect(target).toContain("serviceId=svc-caisse");
    expect(target).not.toContain("operationId=");
    expect(target).toContain(`operationLabel=${encodeURIComponent("Caisse")}`);
  });

  it("KIOSK-BORNE: carte « Voir mon conseiller » en fin de page — style distinct + navigation /managers (FR/EN)", async () => {
    for (const { locale, messages, label } of [
      { locale: "fr", messages: frMessages, label: "Voir mon conseiller" },
      { locale: "en", messages: enMessages, label: "See my advisor" },
    ]) {
      const { unmount } = renderScreen(MOCK_SERVICES, { locale, messages });
      await screen.findAllByTestId("family-section");

      const card = screen.getByTestId("advisor-access-card");
      expect(card).toBeInTheDocument();
      expect(screen.getByTestId("advisor-access-label").textContent).toBe(label);
      // Style DISTINCT des tuiles d'opération : contour or, fond transparent.
      expect((card as HTMLElement).style.backgroundColor).toBe("transparent");
      expect((card as HTMLElement).style.border).toContain("var(--gold-soft)");
      // Icône personne (SVG, zéro emoji) dans la pastille.
      expect(
        screen.getByTestId("advisor-access-icon").querySelector("svg")
      ).toBeInTheDocument();
      // La carte vient APRÈS les sections de familles dans le DOM.
      const sections = screen.getAllByTestId("family-section");
      const lastSection = sections[sections.length - 1];
      expect(
        lastSection.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();

      // useParams est mocké sur « fr » : la navigation cible /fr/managers.
      fireEvent.click(card);
      expect(mockPush).toHaveBeenCalledWith("/fr/managers");

      mockPush.mockClear();
      unmount();
    }
  });

  it("KIOSK-003: service FERMÉ → tuile grisée avec horaire, non cliquable", async () => {
    renderScreen([CLOSED_SERVICE]);

    const tile = await screen.findByTestId("service-tile");
    expect(tile.getAttribute("aria-disabled")).toBe("true");
    expect((tile as HTMLElement).style.opacity).toBe("0.4");
    expect(screen.getByTestId("service-schedule").textContent).toContain("Lu-Ve 09h-17h");

    fireEvent.click(tile);
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("KIOSK-BORNE: état loading pendant le chargement parallèle des familles", () => {
    renderScreen();
    expect(screen.getByTestId("services-loading")).toBeInTheDocument();
  });

  it("KIOSK-BORNE: échec réseau TOTAL → état error + bandeau offline + bouton réessayer qui recharge", async () => {
    server.use(
      http.get("*/public/agencies/:agencyId/operations", () => HttpResponse.error())
    );
    renderScreen();

    expect(await screen.findByTestId("services-error")).toBeInTheDocument();
    expect(screen.getByTestId("offline-banner")).toBeInTheDocument();

    // Réessayer : le réseau revient → sections rendues.
    server.resetHandlers();
    fireEvent.click(screen.getByTestId("services-retry"));
    expect(await screen.findAllByTestId("family-section")).toHaveLength(2);
  });

  it("KIOSK-003: aucune famille → empty state humain visible", () => {
    renderScreen([]);
    expect(screen.getByText("Aucun service disponible")).toBeInTheDocument();
    expect(screen.getByText("Rendez-vous à l'accueil — un agent vous aidera.")).toBeInTheDocument();
  });

  it("KIOSK-003: bouton accessibilité présent + délai d'inactivité nominal 30 s (×2 en mode accessibilité)", async () => {
    renderScreen();
    await screen.findAllByTestId("family-section");

    expect(screen.getByTestId("accessibility-btn")).toBeInTheDocument();
    expect(useInactivityTimeout).toHaveBeenCalledWith(expect.any(Function), 30000);
  });

  it("KIOSK-003: contraste — tuiles sur --surface-1, libellés --action-label (tokens uniquement)", async () => {
    renderScreen();
    const tiles = await screen.findAllByTestId("operation-tile");
    tiles.forEach((tile) => {
      expect((tile as HTMLElement).style.backgroundColor).toBe("var(--surface-1)");
    });
    screen.getAllByTestId("operation-tile-label").forEach((label) => {
      expect((label as HTMLElement).style.color).toBe("var(--action-label)");
    });
  });

  it("KIOSK-BORNE: retour — le bouton back appelle router.back()", async () => {
    renderScreen();
    await screen.findAllByTestId("family-section");
    fireEvent.click(screen.getByTestId("back-btn"));
    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});

/**
 * AUDIT-F7 — Affordance de scroll + accessibilité toujours visible.
 * AUDIT-F20 — État loading = skeleton de tuiles (plus d'écran figé).
 */
describe("AUDIT-F7/F20: ServicesScreen — affordance de scroll + skeleton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function renderServices(services = MOCK_SERVICES, extraProps = {}) {
    return render(
      <NextIntlClientProvider locale="fr" messages={frMessages}>
        <ServicesScreen services={services} agencyId="agt-001" {...extraProps} />
      </NextIntlClientProvider>
    );
  }

  /** Simule les métriques de scroll (jsdom ne mesure pas la mise en page). */
  function setScrollMetrics(
    el: HTMLElement,
    metrics: { scrollHeight: number; clientHeight: number; scrollTop: number }
  ) {
    Object.defineProperty(el, "scrollHeight", {
      value: metrics.scrollHeight,
      configurable: true,
    });
    Object.defineProperty(el, "clientHeight", {
      value: metrics.clientHeight,
      configurable: true,
    });
    Object.defineProperty(el, "scrollTop", {
      value: metrics.scrollTop,
      writable: true,
      configurable: true,
    });
  }

  it("AUDIT-F7: la grille vit dans une région scrollable dédiée (le bouton accessibilité N'y est PAS)", async () => {
    renderServices();
    await screen.findAllByTestId("family-section");
    const region = screen.getByTestId("services-scroll-region");
    const a11yBtn = screen.getByTestId("accessibility-btn");
    // Le bouton accessibilité reste TOUJOURS visible pendant le scroll :
    // il vit hors de la région scrollable, épinglé en bas de l'écran.
    expect(region.contains(a11yBtn)).toBe(false);
    // Les tuiles, elles, vivent dans la région scrollable.
    const firstTile = screen.getAllByTestId("operation-tile")[0];
    expect(region.contains(firstTile)).toBe(true);
  });

  it("AUDIT-F7: contenu sous le pli → dégradé + chevron + texte d'affordance visibles", async () => {
    renderServices();
    await screen.findAllByTestId("family-section");
    const region = screen.getByTestId("services-scroll-region");
    expect(screen.queryByTestId("services-scroll-hint")).not.toBeInTheDocument();

    setScrollMetrics(region, { scrollHeight: 1600, clientHeight: 700, scrollTop: 0 });
    act(() => {
      fireEvent.scroll(region);
    });

    const hint = screen.getByTestId("services-scroll-hint");
    expect(hint).toBeInTheDocument();
    // Affordance décorative : ne doit pas être annoncée par le lecteur d'écran.
    expect(hint).toHaveAttribute("aria-hidden", "true");
    // Icône + texte appariés (règle DS) — texte porteur de sens ≥ 24px.
    expect(hint.querySelector("svg")).toBeInTheDocument();
    expect(hint.textContent).toContain("Plus de services en bas");
    // Le dégradé n'intercepte JAMAIS le toucher (cibles sous-jacentes ≥ 72px).
    expect((hint as HTMLElement).style.pointerEvents).toBe("none");
  });

  it("AUDIT-F7: en fin de scroll, l'affordance disparaît", async () => {
    renderServices();
    await screen.findAllByTestId("family-section");
    const region = screen.getByTestId("services-scroll-region");
    setScrollMetrics(region, { scrollHeight: 1600, clientHeight: 700, scrollTop: 0 });
    act(() => {
      fireEvent.scroll(region);
    });
    expect(screen.getByTestId("services-scroll-hint")).toBeInTheDocument();

    setScrollMetrics(region, { scrollHeight: 1600, clientHeight: 700, scrollTop: 900 });
    act(() => {
      fireEvent.scroll(region);
    });
    expect(screen.queryByTestId("services-scroll-hint")).not.toBeInTheDocument();
  });

  it("AUDIT-F20: isLoading → skeleton de tuiles animé, aucune carte service", () => {
    renderServices(MOCK_SERVICES, { isLoading: true });
    const loading = screen.getByTestId("services-loading");
    expect(loading).toBeInTheDocument();
    expect(loading).toHaveAttribute("role", "status");
    // Tuiles squelettes (shimmer DS, reduced-motion géré par @sigfa/ui).
    expect(screen.getAllByTestId("skeleton-tile").length).toBeGreaterThanOrEqual(4);
    expect(document.querySelectorAll(".sig-skeleton").length).toBeGreaterThan(0);
    // Pas de tuiles réelles ni d'état vide pendant le chargement.
    expect(screen.queryAllByTestId("operation-tile")).toHaveLength(0);
    expect(screen.queryByText("Aucun service disponible")).not.toBeInTheDocument();
    // Message localisé visible (texte porteur de sens).
    expect(screen.getByText("Chargement des opérations...")).toBeInTheDocument();
  });

  it("AUDIT-F20: isLoading prime sur l'état vide (services encore inconnus)", () => {
    renderServices([], { isLoading: true });
    expect(screen.getByTestId("services-loading")).toBeInTheDocument();
    expect(screen.queryByText("Aucun service disponible")).not.toBeInTheDocument();
  });
});
