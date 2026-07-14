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
    availablePill: "Présent",
    absentPill: "Absent aujourd'hui",
    absentHint:
      "De retour bientôt — choisissez un autre conseiller ou continuez sans rendez-vous.",
    continueWithout: "Continuer sans conseiller",
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
    availablePill: "Present",
    absentPill: "Away today",
    absentHint:
      "Back soon — choose another advisor or continue without an appointment.",
    continueWithout: "Continue without an advisor",
  },
};

import { ManagersScreen } from "@/components/ManagersScreen";
import {
  storeTicketOperationLabel,
  readTicketOperationLabel,
} from "@/lib/ticket-operation-store";

const AGENCY_ID = "agt-001";

function managersResponse(count: number) {
  // CONTRACT-014 : `available` requis sur PublicRelationshipManager —
  // Awa (rm-2) est ABSENTE aujourd'hui (audit F14 : les deux états visibles).
  const managers = [
    { id: "rm-1", displayName: "Kofi A.", photoUrl: "/rm/kofi.jpg", available: true },
    { id: "rm-2", displayName: "Awa Diallo", available: false },
    { id: "rm-3", displayName: "Yao Kouassi", photoUrl: "/rm/yao.jpg", available: true },
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

  it("AUDIT-F20: loading → skeleton de tuiles animé (plus d'icône statique figée)", () => {
    mockManagers(3);
    renderScreen();
    const loading = screen.getByTestId("managers-loading");
    expect(loading).toHaveAttribute("role", "status");
    // Tuiles squelettes en grille (shimmer DS .sig-skeleton, reduced-motion
    // géré par @sigfa/ui) — la borne ne paraît plus figée.
    expect(screen.getAllByTestId("skeleton-tile").length).toBeGreaterThanOrEqual(4);
    expect(document.querySelectorAll(".sig-skeleton").length).toBeGreaterThan(0);
    // Message localisé toujours visible (texte porteur de sens).
    expect(screen.getByText("Chargement des conseillers...")).toBeInTheDocument();
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

  it("KIOSK-005b (audit F8): parcours conseiller → purge du libellé d'opération périmé", async () => {
    // Un parcours opération abandonné a laissé un libellé dans le store.
    storeTicketOperationLabel("Retrait espèces");
    mockManagers(3);
    renderScreen();
    await waitFor(() => {
      expect(screen.getAllByTestId("manager-card").length).toBe(3);
    });
    screen.getAllByTestId("manager-card")[0].click();
    // Le Moment Ticket du chemin conseiller n'affichera JAMAIS l'opération
    // d'un client précédent.
    expect(readTicketOperationLabel()).toBeNull();
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
    // ICONS-001 : icône SIGFA « retour » appariée au texte (plus de flèche glyphe).
    expect(back.querySelector("svg[data-icon='retour']")).toBeInTheDocument();
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

  // ── CONTRACT-014 / AUDIT-F14 : disponibilité des conseillers ────────────────

  it("CONTRACT-014 (audit F14): conseiller disponible → pill « Présent » icône+texte, ton succès inverse ≥ 7:1", async () => {
    mockManagers(3);
    const { container } = renderScreen();
    await waitFor(() => {
      expect(screen.getAllByTestId("manager-card").length).toBe(3);
    });
    const pills = container.querySelectorAll("[data-testid='manager-available-pill']");
    // Kofi + Yao présents → 2 pills « Présent ».
    expect(pills.length).toBe(2);
    pills.forEach((pill) => {
      const el = pill as HTMLElement;
      expect(el.textContent).toContain("Présent");
      // Icône SIGFA appariée au texte (jamais de couleur seule).
      expect(el.querySelector("svg[data-icon='valider']")).toBeInTheDocument();
      // Ton succès inverse (audit F6/F14) : --success-inv sur --night = 10.6:1.
      expect(el.style.color).toBe("var(--success-inv)");
      expect(el.style.backgroundColor).toBe("var(--night)");
      // Texte porteur de sens ≥ 24px (règle kiosque).
      expect(parseInt(el.style.fontSize, 10)).toBeGreaterThanOrEqual(24);
    });
  });

  it("CONTRACT-014 (audit F14): conseiller absent → pill « Absent aujourd'hui » en encre douce, icône+texte", async () => {
    mockManagers(3);
    const { container } = renderScreen();
    await waitFor(() => {
      expect(screen.getAllByTestId("manager-card").length).toBe(3);
    });
    const pills = container.querySelectorAll("[data-testid='manager-absent-pill']");
    // Awa absente → 1 pill « Absent aujourd'hui ».
    expect(pills.length).toBe(1);
    const pill = pills[0] as HTMLElement;
    expect(pill.textContent).toContain("Absent aujourd'hui");
    expect(pill.querySelector("svg[data-icon='horloge']")).toBeInTheDocument();
    // Encre douce — l'absence est une information calme, jamais une alerte.
    expect(pill.style.color).toBe("var(--ink-soft)");
    expect(parseInt(pill.style.fontSize, 10)).toBeGreaterThanOrEqual(24);
  });

  it("CONTRACT-014 (audit F14): conseiller absent → carte NON sélectionnable, jamais de file morte", async () => {
    mockManagers(3);
    renderScreen();
    await waitFor(() => {
      expect(screen.getAllByTestId("manager-card").length).toBe(3);
    });
    // Awa (rm-2) est absente : sa carte est désactivée.
    const awaCard = screen.getAllByTestId("manager-card")[1] as HTMLButtonElement;
    expect(awaCard).toBeDisabled();
    expect(awaCard).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(awaCard);
    // Aucune navigation : le client n'est JAMAIS envoyé dans une file morte.
    expect(mockPush).not.toHaveBeenCalled();
    // Explication courte à hauteur de client (jamais un cul-de-sac muet).
    expect(
      screen.getByText(
        "De retour bientôt — choisissez un autre conseiller ou continuez sans rendez-vous."
      )
    ).toBeInTheDocument();
  });

  it("CONTRACT-014 (audit F14): chemin « continuer sans conseiller » évident → /services, cible ≥ 72px", async () => {
    mockManagers(3);
    renderScreen();
    await waitFor(() => {
      expect(screen.getAllByTestId("manager-card").length).toBe(3);
    });
    const cta = screen.getByTestId("managers-continue-without") as HTMLButtonElement;
    expect(cta.textContent).toContain("Continuer sans conseiller");
    expect(parseInt(cta.style.minHeight, 10)).toBeGreaterThanOrEqual(72);
    fireEvent.click(cta);
    expect(mockPush).toHaveBeenCalledWith("/fr/services");
  });

  it("CONTRACT-014 (audit F14): EN — Present / Away today + hint localisés", async () => {
    mockManagers(3);
    renderScreen("en", enMessages);
    await waitFor(() => {
      expect(screen.getAllByTestId("manager-card").length).toBe(3);
    });
    expect(screen.getAllByText("Present").length).toBe(2);
    expect(screen.getByText("Away today")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Back soon — choose another advisor or continue without an appointment."
      )
    ).toBeInTheDocument();
  });

  it("CONTRACT-014: rétrocompat — réponse sans champ available → conseiller traité PRÉSENT (jamais bloqué à tort)", async () => {
    server.use(
      http.get("*/public/agencies/:agencyId/relationship-managers", () =>
        HttpResponse.json(
          { data: [{ id: "rm-legacy", displayName: "Kofi A." }] },
          { status: 200 }
        )
      )
    );
    renderScreen();
    await waitFor(() => {
      expect(screen.getAllByTestId("manager-card").length).toBe(1);
    });
    const card = screen.getByTestId("manager-card") as HTMLButtonElement;
    expect(card).not.toBeDisabled();
    card.click();
    expect(mockPush).toHaveBeenCalledWith(
      `/fr/confirmation?targetManagerId=rm-legacy&agencyId=${AGENCY_ID}&managerName=${encodeURIComponent("Kofi A.")}`
    );
  });
});
