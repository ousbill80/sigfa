/**
 * KIOSK-007 — File longue + service fermé sur l'écran « Prise de ticket »
 * groupé par familles (refonte KIOSK-BORNE).
 * File longue → message affluence + champ téléphone mis en avant.
 * Service CLOSED → tuile grisée avec horaire, non cliquable (snapshot FR/EN).
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
// KIOSK-007 : on étend `expect` avec les matchers jest-dom directement depuis
// l'instance vitest du runner (via `import * as matchers` + `expect.extend`),
// au lieu de `import "@testing-library/jest-dom/vitest"`. Ce dernier appelle
// `expect.extend` sur une COPIE dupliquée de vitest présente dans le store pnpm,
// ce qui casse l'initialisation du SnapshotClient et fait échouer tout
// `toMatchSnapshot` de ce fichier (« The snapshot state ... is not found »).
import * as jestDomMatchers from "@testing-library/jest-dom/matchers";
import { NextIntlClientProvider } from "next-intl";
import { server } from "@/mocks/server";

expect.extend(jestDomMatchers);

const mockPush = vi.fn();
const mockBack = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, back: mockBack }),
  useParams: () => ({ locale: "fr" }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/hooks/useInactivityTimeout", () => ({ useInactivityTimeout: vi.fn() }));
vi.mock("@/hooks/useAccessibilityMode", () => ({
  useAccessibilityMode: () => ({ isAccessibilityMode: false, toggleAccessibilityMode: vi.fn() }),
}));

function makeMessages(services003: Record<string, string>, degraded007: Record<string, string>) {
  return { services003, degraded007 };
}

const frMessages = makeMessages(
  {
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
  },
  {
    longQueueTitle: "Forte affluence — environ {estimate} min",
    longQueueMessage: "Recevez un SMS et revenez à l'heure de votre passage.",
    phoneFieldLabel: "Votre numéro de téléphone",
  }
);

const enMessages = makeMessages(
  {
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
  },
  {
    longQueueTitle: "High volume — about {estimate} min",
    longQueueMessage: "Receive an SMS and come back at your turn.",
    phoneFieldLabel: "Your phone number",
  }
);

import { ServicesScreen } from "@/components/ServicesScreen";
import type { ServiceItem } from "@/components/ServicesScreen";

const AGENCY_ID = "33333333-3333-4333-a333-333333333333";

const openService: ServiceItem = {
  id: "svc-1",
  name: "Retrait / Dépôt",
  estimatedMinutes: 45,
  isOpen: true,
};

const closedService: ServiceItem = {
  id: "svc-2",
  name: "Virement international",
  estimatedMinutes: 0,
  isOpen: false,
  schedule: "lundi 08h00",
};

function renderServices(
  services: ServiceItem[],
  messages: ReturnType<typeof makeMessages> = frMessages,
  locale = "fr"
) {
  return render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      <ServicesScreen
        services={services}
        agencyId={AGENCY_ID}
        agencyName="Cocody Angré"
        bankName="Banque Ivoire"
      />
    </NextIntlClientProvider>
  );
}

beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
afterAll(() => server.close());

describe("KIOSK-007: ServicesScreen file longue + service fermé", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Horloge du bandeau figée pour des rendus déterministes (snapshots).
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-07-13T10:30:00"));
  });
  afterEach(() => {
    vi.useRealTimers();
    server.resetHandlers();
  });

  it("KIOSK-007: estimatedWaitMinutes ≥ seuil → message affluence + champ tel mis en avant (Testing Library)", async () => {
    renderServices([openService]);
    const banner = await screen.findByTestId("long-queue-banner");
    expect(banner).toBeInTheDocument();
    expect(banner.textContent).toContain("affluence");
    // Champ téléphone mis en avant dans ce contexte.
    expect(screen.getByTestId("long-queue-phone-cta")).toBeInTheDocument();
  });

  it("KIOSK-007 (audit F5): le CTA file longue PORTE le serviceId — jamais de POST invalide", async () => {
    renderServices([openService]);
    fireEvent.click(await screen.findByTestId("long-queue-phone-cta"));
    expect(mockPush).toHaveBeenCalledTimes(1);
    const url = mockPush.mock.calls[0][0] as string;
    // Le repli « ticket local 0 min » en pleine affluence venait d'une
    // confirmation SANS serviceId (audit F5).
    expect(url).toContain("/fr/confirmation");
    expect(url).toContain(`serviceId=${openService.id}`);
    expect(url).toContain(`agencyId=${AGENCY_ID}`);
  });

  it("KIOSK-007 (audit F5): le CTA file longue vise le service OUVERT à la plus longue attente", async () => {
    const busiest: ServiceItem = {
      id: "svc-9",
      name: "Crédit",
      estimatedMinutes: 60,
      isOpen: true,
    };
    const closedButLonger: ServiceItem = {
      id: "svc-10",
      name: "International",
      estimatedMinutes: 90,
      isOpen: false,
    };
    renderServices([openService, busiest, closedButLonger]);
    fireEvent.click(await screen.findByTestId("long-queue-phone-cta"));
    const url = mockPush.mock.calls[0][0] as string;
    // Service fermé ignoré ; c'est la file la plus chargée OUVERTE qui porte le CTA.
    expect(url).toContain("serviceId=svc-9");
  });

  it("KIOSK-007: attente sous le seuil → aucune bannière affluence", async () => {
    renderServices([{ ...openService, estimatedMinutes: 10 }]);
    await screen.findAllByTestId("family-section");
    expect(screen.queryByTestId("long-queue-banner")).not.toBeInTheDocument();
  });

  it("KIOSK-007: service CLOSED → tuile grisée avec horaire, non cliquable", async () => {
    renderServices([closedService]);
    const closedTile = await screen.findByTestId("service-tile");
    expect(closedTile).toHaveAttribute("aria-disabled", "true");
    expect(closedTile.style.opacity).toBe("0.4");
    expect(screen.getByTestId("service-schedule").textContent).toContain("lundi 08h00");
    // Non cliquable : la sélection ne navigue pas.
    fireEvent.click(closedTile);
    expect(mockPush).not.toHaveBeenCalled();
  });

  it.each([
    { locale: "fr", messages: frMessages },
    { locale: "en", messages: enMessages },
  ])(
    "KIOSK-007: service CLOSED → tuile grisée avec horaire, non cliquable (snapshot $locale)",
    async ({ locale, messages }) => {
      const { container } = renderServices([closedService], messages, locale);
      await screen.findByTestId("service-tile");
      expect(container.firstChild).toMatchSnapshot();
    }
  );
});
