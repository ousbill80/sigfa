/**
 * MODEL-KIOSK-B — Tests TDD pour ManagersScreen.tsx
 * Écran « Voir mon conseiller » : liste NOMINATIVE des conseillers d'une agence
 * (GET /public/agencies/{id}/relationship-managers → { id, displayName, photoUrl? }).
 *
 * Écrits AVANT l'implémentation (phase rouge). Réutilise la grille/cartes v2
 * (mêmes tokens, cibles ≥ 72 px, zéro emoji). Avatar = photo si fournie, sinon
 * INITIALES dans un cercle --brand-soft (jamais d'image réseau externe rendue
 * en <img> quand photoUrl absente). Au clic → confirmation avec targetManagerId.
 *
 * Couvre les 5 états : loading, liste (nominal), empty (aucun conseiller),
 * error (500 + réessayer), offline (bandeau sur erreur réseau) + FR/EN.
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
  managersModelB: {
    title: "Quel conseiller souhaitez-vous voir ?",
    backButton: "Retour",
    accessibilityButton: "Accès prioritaire",
    loadingMessage: "Chargement des conseillers...",
    emptyTitle: "Aucun conseiller disponible",
    emptyMessage: "Rendez-vous à l'accueil — un agent vous aidera.",
    errorTitle: "Conseillers indisponibles",
    errorMessage: "Impossible de charger les conseillers. Réessayez ou adressez-vous à l'accueil.",
    retryButton: "Réessayer",
    offlineBanner: "Mode hors connexion",
    avatarAlt: "Photo de {name}",
  },
};

const enMessages = {
  managersModelB: {
    title: "Which advisor would you like to see?",
    backButton: "Back",
    accessibilityButton: "Priority access",
    loadingMessage: "Loading advisors...",
    emptyTitle: "No advisors available",
    emptyMessage: "Please go to reception — a staff member will assist you.",
    errorTitle: "Advisors unavailable",
    errorMessage: "Unable to load advisors. Retry or go to reception.",
    retryButton: "Retry",
    offlineBanner: "Offline mode",
    avatarAlt: "Photo of {name}",
  },
};

import { ManagersScreen } from "@/components/ManagersScreen";

const AGENCY_ID = "agt-001";

function managersResponse(count: number) {
  const managers = [
    { id: "rm-1", displayName: "Kofi A.", photoUrl: "/rm/kofi.jpg" },
    { id: "rm-2", displayName: "Awa Diallo" },
    { id: "rm-3", displayName: "Yao Kouassi", photoUrl: "/rm/yao.jpg" },
  ];
  return { data: managers.slice(0, count) };
}

function mockManagers(count: number) {
  server.use(
    http.get("*/public/agencies/:agencyId/relationship-managers", () =>
      HttpResponse.json(managersResponse(count), { status: 200 })
    )
  );
}

function renderScreen(locale = "fr", messages = frMessages) {
  return render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      <ManagersScreen agencyId={AGENCY_ID} />
    </NextIntlClientProvider>
  );
}

describe("MODEL-KIOSK-B: ManagersScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    server.listen({ onUnhandledRequest: "bypass" });
  });

  afterEach(() => {
    server.resetHandlers();
    server.close();
  });

  it("MODEL-KIOSK-B: loading → message d'attente avant l'arrivée des conseillers", () => {
    mockManagers(3);
    renderScreen();
    expect(screen.getByTestId("managers-loading")).toBeInTheDocument();
  });

  it("MODEL-KIOSK-B: nominal → cartes conseiller (nom + avatar) ≥ 96 px, FR/EN", async () => {
    for (const { locale, messages } of [
      { locale: "fr", messages: frMessages },
      { locale: "en", messages: enMessages },
    ]) {
      mockManagers(3);
      const { unmount, container } = renderScreen(locale, messages);
      await waitFor(() => {
        expect(container.querySelectorAll("[data-testid='manager-card']").length).toBe(3);
      });
      const cards = container.querySelectorAll("[data-testid='manager-card']");
      cards.forEach((card) => {
        expect((card as HTMLElement).style.minHeight, `card minHeight ${locale}`).toBe("96px");
      });
      // Noms affichés.
      expect(screen.getByText("Kofi A.")).toBeInTheDocument();
      expect(screen.getByText("Awa Diallo")).toBeInTheDocument();
      unmount();
    }
  });

  it("MODEL-KIOSK-B: avatar = photo (img) quand photoUrl fournie", async () => {
    mockManagers(3);
    const { container } = renderScreen();
    await waitFor(() => {
      expect(container.querySelectorAll("[data-testid='manager-card']").length).toBe(3);
    });
    const imgs = container.querySelectorAll("[data-testid='manager-avatar-photo']");
    // rm-1 et rm-3 ont une photo → 2 images.
    expect(imgs.length).toBe(2);
    imgs.forEach((img) => {
      expect((img as HTMLImageElement).getAttribute("src")).toBeTruthy();
    });
  });

  it("MODEL-KIOSK-B: avatar = INITIALES dans un cercle --brand-soft quand pas de photo", async () => {
    mockManagers(3);
    const { container } = renderScreen();
    await waitFor(() => {
      expect(container.querySelectorAll("[data-testid='manager-card']").length).toBe(3);
    });
    // rm-2 (Awa Diallo) sans photo → initiales « AD ».
    const initials = container.querySelectorAll("[data-testid='manager-avatar-initials']");
    expect(initials.length).toBe(1);
    const badge = initials[0] as HTMLElement;
    expect(badge.textContent).toBe("AD");
    expect(badge.style.backgroundColor).toBe("var(--brand-soft)");
    // Aucune <img> réseau externe pour ce conseiller.
    expect(badge.querySelector("img")).toBeNull();
  });

  it("MODEL-KIOSK-B: photoUrl qui échoue (onError) → repli initiales, jamais d'image cassée", async () => {
    mockManagers(3);
    const { container } = renderScreen();
    await waitFor(() => {
      expect(container.querySelectorAll("[data-testid='manager-card']").length).toBe(3);
    });
    // rm-1 (Kofi A.) a une photoUrl → <img> rendue au départ.
    const imgs = container.querySelectorAll("[data-testid='manager-avatar-photo']");
    expect(imgs.length).toBe(2);
    // Simule un échec de chargement (404/réseau) sur la photo de rm-1.
    fireEvent.error(imgs[0]);
    await waitFor(() => {
      // La <img> de rm-1 disparaît, remplacée par les initiales « KA ».
      expect(container.querySelectorAll("[data-testid='manager-avatar-photo']").length).toBe(1);
    });
    const initials = container.querySelectorAll("[data-testid='manager-avatar-initials']");
    // Awa Diallo (déjà sans photo) + Kofi A. (repli) → 2 badges initiales.
    expect(initials.length).toBe(2);
    const texts = Array.from(initials).map((el) => (el as HTMLElement).textContent);
    expect(texts).toContain("KA");
  });

  it("MODEL-KIOSK-B: clic sur un conseiller → confirmation avec targetManagerId + displayName + agencyId", async () => {
    mockManagers(3);
    renderScreen();
    await waitFor(() => {
      expect(screen.getAllByTestId("manager-card").length).toBe(3);
    });
    screen.getAllByTestId("manager-card")[0].click();
    expect(mockPush).toHaveBeenCalledWith(
      `/fr/confirmation?targetManagerId=rm-1&agencyId=${AGENCY_ID}&managerName=${encodeURIComponent("Kofi A.")}`
    );
  });

  it("MODEL-KIOSK-B: empty → message humain « aucun conseiller disponible », jamais d'écran mort", async () => {
    mockManagers(0);
    renderScreen();
    await waitFor(() => {
      expect(screen.getByText("Aucun conseiller disponible")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("manager-card")).not.toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("MODEL-KIOSK-B: error 500 → état erreur + bouton réessayer", async () => {
    server.use(
      http.get("*/public/agencies/:agencyId/relationship-managers", () =>
        HttpResponse.json(
          { error: { code: "INTERNAL_SERVER_ERROR", message: "boom" } },
          { status: 500 }
        )
      )
    );
    renderScreen();
    await waitFor(() => {
      expect(screen.getByTestId("managers-error")).toBeInTheDocument();
    });
    expect(screen.getByText("Conseillers indisponibles")).toBeInTheDocument();
    expect(screen.getByTestId("managers-retry")).toBeInTheDocument();
  });

  it("MODEL-KIOSK-B: réseau coupé → état erreur + bandeau offline", async () => {
    server.use(
      http.get("*/public/agencies/:agencyId/relationship-managers", () =>
        HttpResponse.error()
      )
    );
    renderScreen();
    await waitFor(() => {
      expect(screen.getByTestId("managers-error")).toBeInTheDocument();
    });
    expect(screen.getByTestId("managers-offline-banner")).toBeInTheDocument();
  });

  it("MODEL-KIOSK-B: error 500 → réessayer relance le fetch et affiche la liste", async () => {
    let calls = 0;
    server.use(
      http.get("*/public/agencies/:agencyId/relationship-managers", () => {
        calls += 1;
        if (calls === 1) {
          return HttpResponse.json(
            { error: { code: "INTERNAL_SERVER_ERROR", message: "boom" } },
            { status: 500 }
          );
        }
        return HttpResponse.json(managersResponse(3), { status: 200 });
      })
    );
    renderScreen();
    await waitFor(() => {
      expect(screen.getByTestId("managers-retry")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("managers-retry"));
    await waitFor(() => {
      expect(screen.getAllByTestId("manager-card").length).toBe(3);
    });
  });

  it("MODEL-KIOSK-B: réponse 200 sans data → empty (jamais de crash)", async () => {
    server.use(
      http.get("*/public/agencies/:agencyId/relationship-managers", () =>
        HttpResponse.json({}, { status: 200 })
      )
    );
    renderScreen();
    await waitFor(() => {
      expect(screen.getByText("Aucun conseiller disponible")).toBeInTheDocument();
    });
  });

  it("MODEL-KIOSK-B: back button ≥ 72 px → router.back()", async () => {
    mockManagers(3);
    const { container } = renderScreen();
    await waitFor(() => {
      expect(screen.getAllByTestId("manager-card").length).toBe(3);
    });
    const back = container.querySelector("[data-testid='managers-back-btn']") as HTMLElement;
    expect(back).toBeInTheDocument();
    expect(back.style.minHeight).toBe("72px");
    back.click();
    expect(mockBack).toHaveBeenCalled();
  });

  it("MODEL-KIOSK-B: bouton accès prioritaire présent et cliquable (a11y)", async () => {
    mockManagers(3);
    const { container } = renderScreen();
    await waitFor(() => {
      expect(screen.getAllByTestId("manager-card").length).toBe(3);
    });
    const a11y = container.querySelector(
      "[data-testid='managers-accessibility-btn']"
    ) as HTMLElement;
    expect(a11y).toBeInTheDocument();
    expect(a11y.style.minHeight).toBe("72px");
    fireEvent.click(a11y);
  });

  it("MODEL-KIOSK-B: aucun emoji dans le rendu (avatar = photo ou initiales)", async () => {
    mockManagers(3);
    const { container } = renderScreen();
    await waitFor(() => {
      expect(screen.getAllByTestId("manager-card").length).toBe(3);
    });
    const emojiRegex = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
    expect(emojiRegex.test(container.textContent ?? "")).toBe(false);
  });
});
