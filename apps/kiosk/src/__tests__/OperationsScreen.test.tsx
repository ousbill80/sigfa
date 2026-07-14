/**
 * MODEL-KIOSK-A — Tests TDD pour OperationsScreen.tsx
 * Parcours borne 2 niveaux : SERVICE → OPÉRATION (grille v2, icônes SVG).
 * Écrits AVANT l'implémentation (phase rouge). Réutilise la grille v2 et
 * `ServiceIcon` — mêmes tokens, zéro emoji, cibles ≥ 72 px.
 *
 * Couvre les 5 états : nominal (grille), loading, empty, error, offline (banner)
 * + le SAUT « opération unique » (une seule opération → confirmation directe,
 * on ne force pas un choix inutile) + FR/EN + création avec operationId.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { NextIntlClientProvider } from "next-intl";
import { server } from "@/mocks/server";
import { http, HttpResponse } from "msw";

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

const frMessages = {
  operationsModelA: {
    title: "Quelle opération souhaitez-vous ?",
    backButton: "Retour",
    waitEstimate: "~{minutes} min",
    accessibilityButton: "Accès prioritaire",
    loadingMessage: "Chargement des opérations...",
    emptyTitle: "Aucune opération disponible",
    emptyMessage: "Rendez-vous à l'accueil — un agent vous aidera.",
    errorTitle: "Opérations indisponibles",
    errorMessage: "Impossible de charger les opérations. Réessayez ou adressez-vous à l'accueil.",
    retryButton: "Réessayer",
    offlineBanner: "Mode hors connexion",
  },
};

const enMessages = {
  operationsModelA: {
    title: "Which operation do you need?",
    backButton: "Back",
    waitEstimate: "~{minutes} min",
    accessibilityButton: "Priority access",
    loadingMessage: "Loading operations...",
    emptyTitle: "No operations available",
    emptyMessage: "Please go to reception — a staff member will assist you.",
    errorTitle: "Operations unavailable",
    errorMessage: "Unable to load operations. Retry or go to reception.",
    retryButton: "Retry",
    offlineBanner: "Offline mode",
  },
};

import { OperationsScreen } from "@/components/OperationsScreen";
import {
  readTicketOperationLabel,
  purgeTicketOperationLabel,
} from "@/lib/ticket-operation-store";

const AGENCY_ID = "agt-001";
const SERVICE_ID = "svc-1";

function operationsResponse(count: number) {
  const ops = [
    { id: "op-1", code: "DEP", name: "Dépôt espèces", slaMinutes: 8, iconKey: "deposit" },
    { id: "op-2", code: "RET", name: "Retrait espèces", slaMinutes: 10 },
    { id: "op-3", code: "VIR", name: "Virement", slaMinutes: 12, iconKey: "transfer" },
  ];
  return { data: ops.slice(0, count) };
}

function mockOperations(count: number) {
  server.use(
    http.get("*/public/agencies/:agencyId/operations", () =>
      HttpResponse.json(operationsResponse(count), { status: 200 })
    )
  );
}

function renderScreen(locale = "fr", messages = frMessages) {
  return render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      <OperationsScreen serviceId={SERVICE_ID} agencyId={AGENCY_ID} />
    </NextIntlClientProvider>
  );
}

describe("MODEL-KIOSK-A: OperationsScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    server.listen({ onUnhandledRequest: "bypass" });
  });

  afterEach(() => {
    server.resetHandlers();
    server.close();
  });

  it("MODEL-KIOSK-A: loading state → spinner/message before operations arrive", () => {
    mockOperations(3);
    renderScreen();
    // Avant résolution du fetch, l'état loading est visible.
    expect(screen.getByTestId("operations-loading")).toBeInTheDocument();
  });

  it("AUDIT-F20: loading → skeleton de tuiles animé (plus d'icône statique figée)", () => {
    mockOperations(3);
    renderScreen();
    const loading = screen.getByTestId("operations-loading");
    expect(loading).toHaveAttribute("role", "status");
    // Tuiles squelettes en grille (shimmer DS .sig-skeleton, reduced-motion
    // géré par @sigfa/ui) — la borne ne paraît plus figée.
    expect(screen.getAllByTestId("skeleton-tile").length).toBeGreaterThanOrEqual(4);
    expect(document.querySelectorAll(".sig-skeleton").length).toBeGreaterThan(0);
    // Message localisé toujours visible (texte porteur de sens).
    expect(screen.getByText("Chargement des opérations...")).toBeInTheDocument();
  });

  it("MODEL-KIOSK-A: nominal → grille d'opérations (cartes ≥ 96 px, icône SVG, SLA en pill) FR/EN", async () => {
    for (const { locale, messages } of [
      { locale: "fr", messages: frMessages },
      { locale: "en", messages: enMessages },
    ]) {
      mockOperations(3);
      const { unmount, container } = renderScreen(locale, messages);

      await waitFor(() => {
        expect(container.querySelectorAll("[data-testid='operation-card']").length).toBe(3);
      });

      const cards = container.querySelectorAll("[data-testid='operation-card']");
      cards.forEach((card) => {
        expect((card as HTMLElement).style.minHeight, `card minHeight ${locale}`).toBe("96px");
      });

      // Icônes SVG (mêmes que services), aucun emoji.
      const icons = container.querySelectorAll("[data-testid='operation-icon']");
      expect(icons.length).toBe(3);
      icons.forEach((icon) => {
        expect((icon as HTMLElement).querySelector("svg")).toBeInTheDocument();
        expect((icon as HTMLElement).textContent).toBe("");
        expect((icon as HTMLElement).style.backgroundColor).toBe("var(--brand-soft)");
      });

      // SLA résolu en pill (mot "min").
      const estimates = container.querySelectorAll("[data-testid='operation-estimate']");
      expect(estimates.length).toBe(3);
      expect(estimates[0].textContent).toContain("8");

      unmount();
    }
  });

  it("MODEL-KIOSK-A: clic sur une opération → confirmation avec serviceId ET operationId", async () => {
    mockOperations(3);
    renderScreen();

    await waitFor(() => {
      expect(screen.getAllByTestId("operation-card").length).toBe(3);
    });

    screen.getAllByTestId("operation-card")[0].click();

    // KIOSK-BORNE : le libellé public de l'opération est porté jusqu'au ticket
    // imprimé via `operationLabel` (non-PII).
    const expectedQuery = new URLSearchParams({
      serviceId: SERVICE_ID,
      operationId: "op-1",
      agencyId: AGENCY_ID,
      operationLabel: "Dépôt espèces",
    }).toString();
    expect(mockPush).toHaveBeenCalledWith(`/fr/confirmation?${expectedQuery}`);
  });

  it("KIOSK-005b (audit F8): clic sur une opération → libellé stocké pour le Moment Ticket", async () => {
    purgeTicketOperationLabel();
    mockOperations(3);
    renderScreen();

    await waitFor(() => {
      expect(screen.getAllByTestId("operation-card").length).toBe(3);
    });

    screen.getAllByTestId("operation-card")[1].click();

    // Le Moment Ticket relira ce libellé (vérification du choix d'un coup d'œil).
    expect(readTicketOperationLabel()).toBe("Retrait espèces");
  });

  it("MODEL-KIOSK-A: SAUT opération unique → confirmation directe (pas de choix inutile)", async () => {
    purgeTicketOperationLabel();
    mockOperations(1);
    renderScreen();

    // Une seule opération → on ne montre PAS la grille, on navigue direct.
    const expectedQuery = new URLSearchParams({
      serviceId: SERVICE_ID,
      operationId: "op-1",
      agencyId: AGENCY_ID,
      operationLabel: "Dépôt espèces",
    }).toString();
    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith(`/fr/confirmation?${expectedQuery}`);
    });
    // Aucune carte affichée : l'écran a été sauté.
    expect(screen.queryByTestId("operation-card")).not.toBeInTheDocument();
    // KIOSK-005b (audit F8) : le saut stocke AUSSI le libellé pour le ticket.
    expect(readTicketOperationLabel()).toBe("Dépôt espèces");
  });

  it("MODEL-KIOSK-A: empty → message humain, jamais d'écran mort", async () => {
    mockOperations(0);
    renderScreen();

    await waitFor(() => {
      expect(screen.getByText("Aucune opération disponible")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("operation-card")).not.toBeInTheDocument();
    // Pas de saut : aucune navigation quand il n'y a aucune opération.
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("MODEL-KIOSK-A: error 500 → état erreur avec message + bouton réessayer", async () => {
    server.use(
      http.get("*/public/agencies/:agencyId/operations", () =>
        HttpResponse.json(
          { error: { code: "INTERNAL_SERVER_ERROR", message: "boom" } },
          { status: 500 }
        )
      )
    );
    renderScreen();

    await waitFor(() => {
      expect(screen.getByTestId("operations-error")).toBeInTheDocument();
    });
    expect(screen.getByText("Opérations indisponibles")).toBeInTheDocument();
    expect(screen.getByTestId("operations-retry")).toBeInTheDocument();
  });

  it("MODEL-KIOSK-A: réseau coupé → état erreur (offline banner), pas de crash", async () => {
    server.use(
      http.get("*/public/agencies/:agencyId/operations", () => HttpResponse.error())
    );
    renderScreen();

    await waitFor(() => {
      expect(screen.getByTestId("operations-error")).toBeInTheDocument();
    });
    // Bandeau offline présent dans l'état d'erreur réseau.
    expect(screen.getByTestId("operations-offline-banner")).toBeInTheDocument();
  });

  it("MODEL-KIOSK-A: bouton accès prioritaire présent et cliquable (a11y)", async () => {
    mockOperations(3);
    const { container } = renderScreen();
    await waitFor(() => {
      expect(screen.getAllByTestId("operation-card").length).toBe(3);
    });
    const a11y = container.querySelector(
      "[data-testid='operations-accessibility-btn']"
    ) as HTMLElement;
    expect(a11y).toBeInTheDocument();
    expect(a11y.style.minHeight).toBe("72px");
    fireEvent.click(a11y);
  });

  it("MODEL-KIOSK-A: icône via nom quand ni iconKey ni code (fallback mot-clé)", async () => {
    server.use(
      http.get("*/public/agencies/:agencyId/operations", () =>
        HttpResponse.json(
          {
            data: [
              { id: "op-a", code: "", name: "Épargne libre", slaMinutes: 7 },
              { id: "op-b", code: "", name: "Ouverture de compte", slaMinutes: 9 },
            ],
          },
          { status: 200 }
        )
      )
    );
    const { container } = renderScreen();
    await waitFor(() => {
      expect(screen.getAllByTestId("operation-card").length).toBe(2);
    });
    const icons = container.querySelectorAll("[data-testid='operation-icon'] svg");
    // Résolution par mot-clé sur le nom : épargne → savings, compte → account.
    expect(icons[0].getAttribute("data-icon")).toBe("savings");
    expect(icons[1].getAttribute("data-icon")).toBe("account");
  });

  it("MODEL-KIOSK-A: réponse 200 sans champ data → empty (jamais de crash)", async () => {
    server.use(
      http.get("*/public/agencies/:agencyId/operations", () =>
        HttpResponse.json({}, { status: 200 })
      )
    );
    renderScreen();
    await waitFor(() => {
      expect(screen.getByText("Aucune opération disponible")).toBeInTheDocument();
    });
  });

  it("MODEL-KIOSK-A: error 500 → réessayer relance le fetch et affiche la grille", async () => {
    let calls = 0;
    server.use(
      http.get("*/public/agencies/:agencyId/operations", () => {
        calls += 1;
        if (calls === 1) {
          return HttpResponse.json(
            { error: { code: "INTERNAL_SERVER_ERROR", message: "boom" } },
            { status: 500 }
          );
        }
        return HttpResponse.json(operationsResponse(3), { status: 200 });
      })
    );
    renderScreen();

    await waitFor(() => {
      expect(screen.getByTestId("operations-retry")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("operations-retry"));

    await waitFor(() => {
      expect(screen.getAllByTestId("operation-card").length).toBe(3);
    });
  });

  it("MODEL-KIOSK-A: back button ≥ 72 px présent (retour service ↔ opération)", async () => {
    mockOperations(3);
    const { container } = renderScreen();
    await waitFor(() => {
      expect(screen.getAllByTestId("operation-card").length).toBe(3);
    });
    const back = container.querySelector("[data-testid='operations-back-btn']") as HTMLElement;
    expect(back).toBeInTheDocument();
    expect(back.style.minHeight).toBe("72px");
    // ICONS-001 : icône SIGFA « retour » appariée au texte (plus de flèche glyphe).
    expect(back.querySelector("svg[data-icon='retour']")).toBeInTheDocument();
    back.click();
    expect(mockBack).toHaveBeenCalled();
  });
});
