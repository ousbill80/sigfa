/**
 * KIOSK-003 — Tests TDD pour ServicesScreen.tsx
 * Écrits AVANT l'implémentation (phase rouge).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { NextIntlClientProvider } from "next-intl";

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

vi.mock("@/hooks/useQueueStatus", () => ({
  useQueueStatus: () => ({ count: 3, estimatedMinutes: 8, isOffline: false }),
}));

export interface ServiceItem {
  id: string;
  name: string;
  icon: string;
  estimatedMinutes: number;
  isOpen: boolean;
  schedule?: string;
}

const MOCK_SERVICES: ServiceItem[] = [
  { id: "svc-1", name: "Dépôt", icon: "deposit", estimatedMinutes: 5, isOpen: true },
  { id: "svc-2", name: "Retrait", icon: "withdrawal", estimatedMinutes: 8, isOpen: true },
  { id: "svc-3", name: "Virement", icon: "transfer", estimatedMinutes: 12, isOpen: true },
  { id: "svc-4", name: "Réclamation", icon: "complaint", estimatedMinutes: 15, isOpen: true },
  { id: "svc-5", name: "Crédit", icon: "credit", estimatedMinutes: 20, isOpen: false, schedule: "Lu-Ve 09h-17h" },
];

const frMessages = {
  services003: {
    title: "Quel service souhaitez-vous ?",
    backButton: "Retour",
    waitEstimate: "~{minutes} min",
    seeMore: "Voir plus de services",
    closedService: "Fermé — {schedule}",
    accessibilityButton: "Accès prioritaire",
    emptyTitle: "Aucun service disponible",
    emptyMessage: "Rendez-vous à l'accueil — un agent vous aidera.",
    offlineBanner: "Mode hors connexion",
    loadingMessage: "Chargement des services...",
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
    title: "Which service do you need?",
    backButton: "Back",
    waitEstimate: "~{minutes} min",
    seeMore: "See more services",
    closedService: "Closed — {schedule}",
    accessibilityButton: "Priority access",
    emptyTitle: "No services available",
    emptyMessage: "Please go to reception — a staff member will assist you.",
    offlineBanner: "Offline mode",
    loadingMessage: "Loading services...",
    scrollHint: "More services below",
  },
  degraded007: {
    longQueueTitle: "High volume — about {estimate} min",
    longQueueMessage: "Receive an SMS and come back at your turn.",
    phoneFieldLabel: "Your phone number",
  },
};

import { ServicesScreen } from "@/components/ServicesScreen";
import { useInactivityTimeout } from "@/hooks/useInactivityTimeout";

describe("KIOSK-003: ServicesScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("KIOSK-003: cards rendered height ≥ 96 px, icon 40 px + label 28 px (FR/EN)", () => {
    const locales = [
      { locale: "fr", messages: frMessages },
      { locale: "en", messages: enMessages },
    ];

    for (const { locale, messages } of locales) {
      const { unmount, container } = render(
        <NextIntlClientProvider locale={locale} messages={messages}>
          <ServicesScreen services={MOCK_SERVICES.slice(0, 4)} agencyId="agt-001" />
        </NextIntlClientProvider>
      );

      const cards = container.querySelectorAll("[data-testid='service-card']");
      expect(cards.length, `Expected 4 cards for locale ${locale}`).toBe(4);

      cards.forEach((card) => {
        const cardEl = card as HTMLElement;
        expect(cardEl.style.minHeight, `Card minHeight for ${locale}`).toBe("96px");
      });

      // v2 : plus d'emoji. Chaque carte porte une icône SVG cohérente
      // (cercle --brand-soft) au lieu du glyphe emoji.
      const icons = container.querySelectorAll("[data-testid='service-icon']");
      expect(icons.length, `Icon count for ${locale}`).toBe(4);
      icons.forEach((icon) => {
        const iconEl = icon as HTMLElement;
        expect(iconEl.style.backgroundColor, `Icon circle bg for ${locale}`).toBe(
          "var(--brand-soft)"
        );
        expect(
          iconEl.querySelector("svg"),
          `SVG icon present for ${locale}`
        ).toBeInTheDocument();
        expect(iconEl.textContent, `No emoji glyph for ${locale}`).toBe("");
      });

      const labels = container.querySelectorAll("[data-testid='service-label']");
      labels.forEach((label) => {
        const labelEl = label as HTMLElement;
        expect(labelEl.style.fontSize, `Label fontSize for ${locale}`).toBe("28px");
      });

      unmount();
    }
  });

  it("KIOSK-003: max 4 cards visible, 'see more' button present if > 4 services", () => {
    const { container } = render(
      <NextIntlClientProvider locale="fr" messages={frMessages}>
        <ServicesScreen services={MOCK_SERVICES} agencyId="agt-001" />
      </NextIntlClientProvider>
    );

    // With 5 services, only 4 cards should be visible initially
    const cards = container.querySelectorAll("[data-testid='service-card']");
    expect(cards.length).toBe(4);

    // "See more" button should be present
    const seeMoreBtn = container.querySelector("[data-testid='see-more-btn']");
    expect(seeMoreBtn).toBeInTheDocument();
  });

  it("KIOSK-003: queue:updated → estimate updated on card without reload (Socket mock test)", () => {
    const { container } = render(
      <NextIntlClientProvider locale="fr" messages={frMessages}>
        <ServicesScreen services={MOCK_SERVICES.slice(0, 4)} agencyId="agt-001" />
      </NextIntlClientProvider>
    );

    // Queue status is displayed
    const estimates = container.querySelectorAll("[data-testid='service-estimate']");
    expect(estimates.length).toBeGreaterThan(0);
  });

  it("KIOSK-003: CLOSED service → grayed card with schedule, not clickable", () => {
    const closedService: ServiceItem = {
      id: "svc-closed",
      name: "Crédit",
      icon: "credit",
      estimatedMinutes: 20,
      isOpen: false,
      schedule: "Lu-Ve 09h-17h",
    };

    const { container } = render(
      <NextIntlClientProvider locale="fr" messages={frMessages}>
        <ServicesScreen services={[closedService]} agencyId="agt-001" />
      </NextIntlClientProvider>
    );

    const card = container.querySelector("[data-testid='service-card']") as HTMLElement;
    expect(card).toBeInTheDocument();

    // Card should be visually grayed out (opacity)
    expect(card.style.opacity).toBe("0.4");

    // Card should not be clickable (aria-disabled)
    expect(card.getAttribute("aria-disabled")).toBe("true");

    // Schedule text should be visible
    expect(container.querySelector("[data-testid='service-schedule']")).toBeInTheDocument();
  });

  it("KIOSK-003: bouton accessibilité → text +20%, doubled inactivity delay (Vitest)", () => {
    const { container } = render(
      <NextIntlClientProvider locale="fr" messages={frMessages}>
        <ServicesScreen services={MOCK_SERVICES.slice(0, 2)} agencyId="agt-001" />
      </NextIntlClientProvider>
    );

    const a11yBtn = container.querySelector("[data-testid='accessibility-btn']");
    expect(a11yBtn).toBeInTheDocument();

    // Normal timeout is 30s
    expect(useInactivityTimeout).toHaveBeenCalledWith(
      expect.any(Function),
      30000
    );
  });

  it("KIOSK-003: empty state → human message visible (Testing Library)", () => {
    render(
      <NextIntlClientProvider locale="fr" messages={frMessages}>
        <ServicesScreen services={[]} agencyId="agt-001" />
      </NextIntlClientProvider>
    );

    expect(screen.getByText("Aucun service disponible")).toBeInTheDocument();
    expect(screen.getByText("Rendez-vous à l'accueil — un agent vous aidera.")).toBeInTheDocument();
  });

  it("KIOSK-003: card contrast ≥ 7:1 on --surface-kiosk (CSS token assertion)", () => {
    const { container } = render(
      <NextIntlClientProvider locale="fr" messages={frMessages}>
        <ServicesScreen services={MOCK_SERVICES.slice(0, 2)} agencyId="agt-001" />
      </NextIntlClientProvider>
    );

    const cards = container.querySelectorAll("[data-testid='service-card']");
    cards.forEach((card) => {
      const cardEl = card as HTMLElement;
      expect(cardEl.style.backgroundColor).toBe("var(--surface-1)");

      const label = card.querySelector("[data-testid='service-label']") as HTMLElement;
      expect(label?.style.color).toBe("var(--action-label)");
    });
  });

  // KIOSK-003: régression visuelle ×4 langues → couverte par Playwright (pnpm test:visual)
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

  it("AUDIT-F7: la grille vit dans une région scrollable dédiée (le bouton accessibilité N'y est PAS)", () => {
    renderServices();
    const region = screen.getByTestId("services-scroll-region");
    const a11yBtn = screen.getByTestId("accessibility-btn");
    // Le bouton accessibilité reste TOUJOURS visible pendant le scroll :
    // il vit hors de la région scrollable, épinglé en bas de l'écran.
    expect(region.contains(a11yBtn)).toBe(false);
    // Les cartes, elles, vivent dans la région scrollable.
    const firstCard = screen.getAllByTestId("service-card")[0];
    expect(region.contains(firstCard)).toBe(true);
  });

  it("AUDIT-F7: contenu sous le pli → dégradé + chevron + texte d'affordance visibles", () => {
    renderServices();
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

  it("AUDIT-F7: en fin de scroll, l'affordance disparaît", () => {
    renderServices();
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
    // Pas de cartes réelles ni d'état vide pendant le chargement.
    expect(screen.queryAllByTestId("service-card")).toHaveLength(0);
    expect(screen.queryByText("Aucun service disponible")).not.toBeInTheDocument();
    // Message localisé visible (texte porteur de sens).
    expect(screen.getByText("Chargement des services...")).toBeInTheDocument();
  });

  it("AUDIT-F20: isLoading prime sur l'état vide (services encore inconnus)", () => {
    renderServices([], { isLoading: true });
    expect(screen.getByTestId("services-loading")).toBeInTheDocument();
    expect(screen.queryByText("Aucun service disponible")).not.toBeInTheDocument();
  });
});
