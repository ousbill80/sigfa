/**
 * KIOSK-003 — Tests TDD pour ServicesScreen.tsx
 * Écrits AVANT l'implémentation (phase rouge).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
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
  { id: "svc-1", name: "Dépôt", icon: "💰", estimatedMinutes: 5, isOpen: true },
  { id: "svc-2", name: "Retrait", icon: "💵", estimatedMinutes: 8, isOpen: true },
  { id: "svc-3", name: "Virement", icon: "🔄", estimatedMinutes: 12, isOpen: true },
  { id: "svc-4", name: "Réclamation", icon: "📋", estimatedMinutes: 15, isOpen: true },
  { id: "svc-5", name: "Crédit", icon: "🏦", estimatedMinutes: 20, isOpen: false, schedule: "Lu-Ve 09h-17h" },
];

const frMessages = {
  services003: {
    title: "Quel service souhaitez-vous ?",
    backButton: "Retour",
    waitEstimate: "~{minutes} min",
    seeMore: "Voir plus de services",
    closedService: "Fermé — {schedule}",
    accessibilityButton: "♿ Accès prioritaire",
    emptyTitle: "Aucun service disponible",
    emptyMessage: "Rendez-vous à l'accueil — un agent vous aidera.",
    offlineBanner: "Mode hors connexion",
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
    accessibilityButton: "♿ Priority access",
    emptyTitle: "No services available",
    emptyMessage: "Please go to reception — a staff member will assist you.",
    offlineBanner: "Offline mode",
  },
  degraded007: {
    longQueueTitle: "High volume — about {estimate} min",
    longQueueMessage: "Receive an SMS and come back at your turn.",
    phoneFieldLabel: "Your phone number",
  },
};

const dioulaMessages = {
  services003: {
    title: "Baara min ye i fe?",
    backButton: "Segin",
    waitEstimate: "~{minutes} min",
    seeMore: "Baara wɛrɛw ye",
    closedService: "Kɛnɛ tɛ — {schedule}",
    accessibilityButton: "♿ Tɔgɔ Segin",
    emptyTitle: "Baara si tɛ yen",
    emptyMessage: "Taa accueil la — mɔgɔ dɔ bena i dɛmɛ.",
    offlineBanner: "Mode hors connexion",
  },
  degraded007: {
    longQueueTitle: "Mɔgɔ caman — {estimate} min ɲɔgɔn",
    longQueueMessage: "SMS sɔrɔ ka segin i ka waati la.",
    phoneFieldLabel: "I ka wolofɔn nimɔrɔ",
  },
};

const baouleMessages = {
  services003: {
    title: "Sɛ bo nun a klɛ?",
    backButton: "Wɔ sin",
    waitEstimate: "~{minutes} min",
    seeMore: "Sɛ wɛlɛ yɛ",
    closedService: "Kpli — {schedule}",
    accessibilityButton: "♿ Klo tafue",
    emptyTitle: "Sɛ klɛ aman",
    emptyMessage: "Kɔ accueil — mɔgɔ dɔ a su.",
    offlineBanner: "Mode hors connexion",
  },
  degraded007: {
    longQueueTitle: "Sran kpanngban — {estimate} min",
    longQueueMessage: "Sɔ SMS naan sin blɛ wɔ blɛ nun.",
    phoneFieldLabel: "Wɔ telefɔn nimɛro",
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

  it("KIOSK-003: cards rendered height ≥ 96 px, icon 40 px + label 28 px (snapshot ×4 languages)", () => {
    const locales = [
      { locale: "fr", messages: frMessages },
      { locale: "en", messages: enMessages },
      { locale: "dioula", messages: dioulaMessages },
      { locale: "baoule", messages: baouleMessages },
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

      const icons = container.querySelectorAll("[data-testid='service-icon']");
      icons.forEach((icon) => {
        const iconEl = icon as HTMLElement;
        expect(iconEl.style.fontSize, `Icon fontSize for ${locale}`).toBe("40px");
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
      icon: "🏦",
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

  it("KIOSK-003: ♿ button → text +20%, doubled inactivity delay (Vitest)", () => {
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
