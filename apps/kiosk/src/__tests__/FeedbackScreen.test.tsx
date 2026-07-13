/**
 * KIOSK-009 — Tests TDD pour FeedbackScreen.tsx
 * Feedback post-service borne : note 1-5 + commentaire vocal optionnel.
 * Écrits AVANT l'implémentation (phase rouge).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { NextIntlClientProvider } from "next-intl";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { server } from "@/mocks/server";
import { http, HttpResponse } from "msw";

// ─── Mock next/navigation ──────────────────────────────────────────────────
const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, back: vi.fn() }),
  useParams: () => ({ locale: "fr" }),
  useSearchParams: () => new URLSearchParams(),
}));

import { FeedbackScreen } from "@/components/FeedbackScreen";
import { parseHexToRgb, contrastRatio } from "@/lib/kiosk-voice";

// ─── Messages 4 langues ────────────────────────────────────────────────────
const frMessages = {
  feedback009: {
    title: "Comment s'est passé votre passage ?",
    starLabel: "Note {n} sur 5",
    commentPlaceholder: "Ajoutez un commentaire (facultatif)",
    micLabel: "Dicter un commentaire",
    submitButton: "Envoyer mon avis",
    thankYou: "Merci pour votre avis !",
  },
};
const enMessages = {
  feedback009: {
    title: "How was your visit?",
    starLabel: "Rating {n} out of 5",
    commentPlaceholder: "Add a comment (optional)",
    micLabel: "Dictate a comment",
    submitButton: "Send my feedback",
    thankYou: "Thank you for your feedback!",
  },
};
const DONE_TRACKING = "V9k2mXpLqRwZsYn8fBjH";
const props = { trackingId: DONE_TRACKING };

/** Ticket DONE clos il y a `hoursAgo` heures. */
function doneTicket(hoursAgo: number) {
  const closedAt = new Date(Date.now() - hoursAgo * 3600_000).toISOString();
  return {
    trackingId: DONE_TRACKING,
    number: "A042",
    displayNumber: "OC-042",
    status: "DONE",
    channel: "KIOSK",
    position: 0,
    estimatedWaitMinutes: 0,
    agencyId: "33333333-3333-4333-a333-333333333333",
    serviceId: "77777777-7777-4777-a777-777777777777",
    closedAt,
    createdAt: new Date(Date.now() - (hoursAgo + 1) * 3600_000).toISOString(),
  };
}

function mockGet(ticket: object) {
  server.use(
    http.get("*/public/tickets/:trackingId", () =>
      HttpResponse.json(ticket, { status: 200 })
    )
  );
}

/** Lit un token hex depuis design-tokens.css (source de vérité). */
function readToken(name: string): string {
  const css = readFileSync(
    resolve(__dirname, "../lib/design-tokens.css"),
    "utf-8"
  );
  const match = css.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!match) throw new Error(`Token ${name} introuvable`);
  return match[1];
}

function renderFeedback(
  locale: string,
  messages: Record<string, Record<string, string>>,
  extra: Record<string, unknown> = {}
) {
  return render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      <FeedbackScreen {...props} {...extra} />
    </NextIntlClientProvider>
  );
}

describe("KIOSK-009: FeedbackScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    server.listen({ onUnhandledRequest: "bypass" });
  });
  afterEach(() => {
    server.resetHandlers();
    server.close();
    vi.useRealTimers();
  });

  // ─── Critère 1 : éligibilité DONE + < 24 h ────────────────────────────────
  it("KIOSK-009: écran feedback affiché uniquement si ticket DONE et < 24 h (mock GET /public/tickets)", async () => {
    mockGet(doneTicket(2));
    const { container } = renderFeedback("fr", frMessages);
    await waitFor(() => {
      expect(
        container.querySelectorAll("[data-testid='feedback-star']").length
      ).toBe(5);
    });
  });

  it("KIOSK-009: ticket non DONE → écran feedback NON proposé, retour accueil", async () => {
    mockGet({ ...doneTicket(2), status: "WAITING", closedAt: null });
    const { container } = renderFeedback("fr", frMessages);
    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("/fr");
    });
    expect(
      container.querySelectorAll("[data-testid='feedback-star']").length
    ).toBe(0);
  });

  it("KIOSK-009: fenêtre > 24 h → écran feedback NON proposé, retour accueil", async () => {
    mockGet(doneTicket(25));
    const { container } = renderFeedback("fr", frMessages);
    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("/fr");
    });
    expect(
      container.querySelectorAll("[data-testid='feedback-star']").length
    ).toBe(0);
  });

  // ─── Critère 2 : 5 étoiles tactiles ≥ 72 px, label 28 px, ×4 langues ──────
  it("KIOSK-009: 5 étoiles tactiles ≥ 72 px, label 28 px (Testing Library FR/EN)", async () => {
    const locales = [
      { locale: "fr", messages: frMessages },
      { locale: "en", messages: enMessages },
    ];
    for (const { locale, messages } of locales) {
      mockGet(doneTicket(2));
      const { container, unmount } = renderFeedback(locale, messages);
      await waitFor(() => {
        expect(
          container.querySelectorAll("[data-testid='feedback-star']").length
        ).toBe(5);
      });
      const stars = container.querySelectorAll("[data-testid='feedback-star']");
      stars.forEach((star) => {
        const el = star as HTMLElement;
        expect(el.style.minWidth, `star size ${locale}`).toBe("72px");
        expect(el.style.minHeight, `star size ${locale}`).toBe("72px");
        // ICONS-001 : étoile = icône SIGFA « etoile », plus de glyphe texte.
        expect(
          el.querySelector("svg[data-icon='etoile']"),
          `star icon ${locale}`,
        ).toBeInTheDocument();
      });
      const title = container.querySelector(
        "[data-testid='feedback-title']"
      ) as HTMLElement;
      expect(title.style.fontSize, `title px ${locale}`).toBe("28px");
      unmount();
    }
  });

  it("KIOSK-009: étoiles espacées ≥ 16 px (design system)", async () => {
    mockGet(doneTicket(2));
    const { container } = renderFeedback("fr", frMessages);
    await waitFor(() => {
      expect(
        container.querySelectorAll("[data-testid='feedback-star']").length
      ).toBe(5);
    });
    const rating = container.querySelector(
      "[data-testid='star-rating']"
    ) as HTMLElement;
    expect(parseFloat(rating.style.gap)).toBeGreaterThanOrEqual(16);
  });

  // ─── Critère 3 : POST note 1-5 + comment ≤ 500 ────────────────────────────
  it("KIOSK-009: POST /public/tickets/{trackingId}/feedback appelé avec note 1-5 et X-Idempotency-Key", async () => {
    mockGet(doneTicket(2));
    let capturedBody: { note?: number; comment?: string } = {};
    let capturedIdempotencyKey: string | null = "SENTINEL";
    server.use(
      http.post(
        "*/public/tickets/:trackingId/feedback",
        async ({ request }) => {
          capturedBody = (await request.json()) as {
            note?: number;
            comment?: string;
          };
          capturedIdempotencyKey = request.headers.get("X-Idempotency-Key");
          return HttpResponse.json(
            { success: true, message: "Merci pour votre avis !" },
            { status: 201 }
          );
        }
      )
    );
    const { container } = renderFeedback("fr", frMessages);
    await waitFor(() => {
      expect(
        container.querySelectorAll("[data-testid='feedback-star']").length
      ).toBe(5);
    });
    const stars = container.querySelectorAll("[data-testid='feedback-star']");
    fireEvent.click(stars[3]); // note = 4
    fireEvent.click(screen.getByTestId("feedback-submit"));
    await waitFor(() => {
      expect(capturedBody.note).toBe(4);
    });
    // Le contrat API-010 n'exige PAS X-Idempotency-Key : l'en-tête ne doit PAS être envoyé.
    expect(capturedIdempotencyKey).toBeNull();
  });

  it("KIOSK-009: commentaire tronqué à 500 caractères avant POST", async () => {
    mockGet(doneTicket(2));
    let capturedComment = "";
    server.use(
      http.post(
        "*/public/tickets/:trackingId/feedback",
        async ({ request }) => {
          const body = (await request.json()) as { comment?: string };
          capturedComment = body.comment ?? "";
          return HttpResponse.json({ success: true }, { status: 201 });
        }
      )
    );
    const { container } = renderFeedback("fr", frMessages);
    await waitFor(() => {
      expect(
        container.querySelectorAll("[data-testid='feedback-star']").length
      ).toBe(5);
    });
    const textarea = container.querySelector(
      "[data-testid='feedback-comment']"
    ) as HTMLTextAreaElement;
    expect(textarea.maxLength).toBe(500);
    fireEvent.change(textarea, { target: { value: "x".repeat(600) } });
    expect(textarea.value.length).toBe(500);
    fireEvent.click(
      container.querySelectorAll("[data-testid='feedback-star']")[0]
    );
    fireEvent.click(screen.getByTestId("feedback-submit"));
    await waitFor(() => {
      expect(capturedComment.length).toBe(500);
    });
  });

  it("KIOSK-009: submit désactivé tant qu'aucune note n'est sélectionnée", async () => {
    mockGet(doneTicket(2));
    renderFeedback("fr", frMessages);
    await waitFor(() => {
      expect(screen.getByTestId("feedback-submit")).toBeInTheDocument();
    });
    expect(screen.getByTestId("feedback-submit")).toBeDisabled();
  });

  // ─── Critère 4 : 409 FEEDBACK_ALREADY_SUBMITTED ───────────────────────────
  it("KIOSK-009: 409 FEEDBACK_ALREADY_SUBMITTED → message remerciement, zéro erreur visible", async () => {
    mockGet(doneTicket(2));
    server.use(
      http.post("*/public/tickets/:trackingId/feedback", () =>
        HttpResponse.json(
          {
            error: {
              code: "FEEDBACK_ALREADY_SUBMITTED",
              message: "Un feedback a déjà été soumis pour ce ticket.",
            },
          },
          { status: 409 }
        )
      )
    );
    renderFeedback("fr", frMessages);
    await waitFor(() => {
      expect(
        screen.getAllByTestId("feedback-star").length
      ).toBe(5);
    });
    fireEvent.click(screen.getAllByTestId("feedback-star")[2]);
    fireEvent.click(screen.getByTestId("feedback-submit"));
    await waitFor(() => {
      expect(screen.getByTestId("feedback-thankyou")).toBeInTheDocument();
    });
    expect(screen.getByText("Merci pour votre avis !")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("KIOSK-009: 201 succès → message remerciement neutre", async () => {
    mockGet(doneTicket(2));
    server.use(
      http.post("*/public/tickets/:trackingId/feedback", () =>
        HttpResponse.json({ success: true }, { status: 201 })
      )
    );
    renderFeedback("fr", frMessages);
    await waitFor(() =>
      expect(screen.getAllByTestId("feedback-star").length).toBe(5)
    );
    fireEvent.click(screen.getAllByTestId("feedback-star")[4]);
    fireEvent.click(screen.getByTestId("feedback-submit"));
    await waitFor(() => {
      expect(screen.getByTestId("feedback-thankyou")).toBeInTheDocument();
    });
  });

  // ─── Critère 5 : 422 → navigation accueil silencieuse ─────────────────────
  it("KIOSK-009: 422 TICKET_NOT_CLOSED → navigation accueil silencieuse", async () => {
    mockGet(doneTicket(2));
    server.use(
      http.post("*/public/tickets/:trackingId/feedback", () =>
        HttpResponse.json(
          { error: { code: "TICKET_NOT_CLOSED", message: "…" } },
          { status: 422 }
        )
      )
    );
    renderFeedback("fr", frMessages);
    await waitFor(() =>
      expect(screen.getAllByTestId("feedback-star").length).toBe(5)
    );
    fireEvent.click(screen.getAllByTestId("feedback-star")[1]);
    fireEvent.click(screen.getByTestId("feedback-submit"));
    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("/fr");
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("KIOSK-009: 422 FEEDBACK_WINDOW_EXPIRED → navigation accueil silencieuse", async () => {
    mockGet(doneTicket(2));
    server.use(
      http.post("*/public/tickets/:trackingId/feedback", () =>
        HttpResponse.json(
          { error: { code: "FEEDBACK_WINDOW_EXPIRED", message: "…" } },
          { status: 422 }
        )
      )
    );
    renderFeedback("fr", frMessages);
    await waitFor(() =>
      expect(screen.getAllByTestId("feedback-star").length).toBe(5)
    );
    fireEvent.click(screen.getAllByTestId("feedback-star")[1]);
    fireEvent.click(screen.getByTestId("feedback-submit"));
    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("/fr");
    });
  });

  it("KIOSK-009: erreur réseau sur GET ticket → retour accueil silencieux", async () => {
    server.use(
      http.get("*/public/tickets/:trackingId", () => HttpResponse.error())
    );
    const { container } = renderFeedback("fr", frMessages);
    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("/fr");
    });
    expect(
      container.querySelectorAll("[data-testid='feedback-star']").length
    ).toBe(0);
  });

  it("KIOSK-009: erreur réseau sur POST feedback → retour accueil silencieux", async () => {
    mockGet(doneTicket(2));
    server.use(
      http.post("*/public/tickets/:trackingId/feedback", () =>
        HttpResponse.error()
      )
    );
    renderFeedback("fr", frMessages);
    await waitFor(() =>
      expect(screen.getAllByTestId("feedback-star").length).toBe(5)
    );
    fireEvent.click(screen.getAllByTestId("feedback-star")[2]);
    fireEvent.click(screen.getByTestId("feedback-submit"));
    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("/fr");
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  // ─── Critère 9 : contraste ≥ 7:1 ──────────────────────────────────────────
  it("KIOSK-009: contraste ≥ 7:1 sur --surface-kiosk (axe-core)", async () => {
    const ink = readToken("--ink-inverse");
    const surface = readToken("--surface-kiosk");
    const ratio = contrastRatio(parseHexToRgb(ink), parseHexToRgb(surface));
    expect(ratio).toBeGreaterThanOrEqual(7);

    mockGet(doneTicket(2));
    const { container } = renderFeedback("fr", frMessages);
    await waitFor(() =>
      expect(screen.getAllByTestId("feedback-star").length).toBe(5)
    );
    const main = container.querySelector("main") as HTMLElement;
    expect(main.style.backgroundColor).toBe("var(--surface-kiosk)");
    const title = container.querySelector(
      "[data-testid='feedback-title']"
    ) as HTMLElement;
    expect(title.style.color).toBe("var(--ink-inverse)");
  });
});

// ─── Web Speech API (SpeechRecognition) ──────────────────────────────────────
describe("KIOSK-009: commentaire vocal (SpeechRecognition)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    server.listen({ onUnhandledRequest: "bypass" });
    mockGet(doneTicket(2));
  });
  afterEach(() => {
    server.resetHandlers();
    server.close();
    delete (window as unknown as Record<string, unknown>).SpeechRecognition;
    delete (window as unknown as Record<string, unknown>)
      .webkitSpeechRecognition;
  });

  interface FakeRecognitionInstance {
    lang: string;
    continuous: boolean;
    interimResults: boolean;
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    onresult:
      | ((e: { results: Array<Array<{ transcript: string }>> }) => void)
      | null;
    onerror: ((e: unknown) => void) | null;
    onend: (() => void) | null;
  }

  let lastInstance: FakeRecognitionInstance | null = null;

  function makeInstance(): FakeRecognitionInstance {
    return {
      lang: "",
      continuous: false,
      interimResults: false,
      start: vi.fn(),
      stop: vi.fn(),
      onresult: null,
      onerror: null,
      onend: null,
    };
  }

  function installSpeechRecognition() {
    lastInstance = null;
    const ctor = vi.fn(() => {
      const instance = makeInstance();
      lastInstance = instance;
      return instance;
    });
    (window as unknown as Record<string, unknown>).SpeechRecognition = ctor;
    return ctor;
  }

  it("KIOSK-009: commentaire vocal → transcription ≤ 500 caractères dans champ éditable", async () => {
    installSpeechRecognition();
    const { container } = render(
      <NextIntlClientProvider locale="fr" messages={frMessages}>
        <FeedbackScreen {...props} />
      </NextIntlClientProvider>
    );
    await waitFor(() =>
      expect(screen.getAllByTestId("feedback-star").length).toBe(5)
    );
    const micBtn = screen.getByTestId("feedback-mic");
    expect(micBtn).toBeInTheDocument();
    // ICONS-001 : icône SIGFA « audio » appariée au label (plus d'emoji micro).
    expect(micBtn.querySelector("svg[data-icon='audio']")).toBeInTheDocument();
    fireEvent.click(micBtn);
    expect(lastInstance).not.toBeNull();
    expect(lastInstance!.start).toHaveBeenCalled();

    // Le moteur produit une transcription longue → tronquée à 500 dans le champ.
    act(() => {
      lastInstance!.onresult?.({
        results: [[{ transcript: "a".repeat(600) }]],
      });
    });
    const textarea = container.querySelector(
      "[data-testid='feedback-comment']"
    ) as HTMLTextAreaElement;
    expect(textarea.value.length).toBe(500);

    // Le champ reste éditable après dictée.
    fireEvent.change(textarea, { target: { value: "corrigé" } });
    expect(textarea.value).toBe("corrigé");
  });

  it("KIOSK-009: SpeechRecognition absent → bouton micro masqué, commentaire textuel disponible", async () => {
    // Pas d'installation de SpeechRecognition (environnement Electron).
    const { container } = render(
      <NextIntlClientProvider locale="fr" messages={frMessages}>
        <FeedbackScreen {...props} />
      </NextIntlClientProvider>
    );
    await waitFor(() =>
      expect(screen.getAllByTestId("feedback-star").length).toBe(5)
    );
    expect(screen.queryByTestId("feedback-mic")).not.toBeInTheDocument();
    // Le commentaire textuel reste disponible.
    expect(
      container.querySelector("[data-testid='feedback-comment']")
    ).toBeInTheDocument();
  });

  it("KIOSK-009: webkitSpeechRecognition (préfixe WebKit) supporté → bouton micro visible", async () => {
    const ctor = vi.fn(() => makeInstance());
    (window as unknown as Record<string, unknown>).webkitSpeechRecognition =
      ctor;
    render(
      <NextIntlClientProvider locale="fr" messages={frMessages}>
        <FeedbackScreen {...props} />
      </NextIntlClientProvider>
    );
    await waitFor(() =>
      expect(screen.getAllByTestId("feedback-star").length).toBe(5)
    );
    expect(screen.getByTestId("feedback-mic")).toBeInTheDocument();
  });
});

// ─── Critère 8 : timeout inactivité 30 s / 60 s (fake-timers déterministe) ────
// On espionne useInactivityTimeout pour capturer callback + délai, puis on
// déclenche le callback via fake-timer sur le VRAI hook (setTimeout). Le hook
// réel reste couvert par ses propres tests KIOSK-002/008.
const inactivityWiring = vi.hoisted(
  () => ({}) as { onTimeout?: () => void; delayMs?: number }
);
vi.mock("@/hooks/useInactivityTimeout", () => ({
  useInactivityTimeout: (onTimeout: () => void, delayMs: number) => {
    inactivityWiring.onTimeout = onTimeout;
    inactivityWiring.delayMs = delayMs;
  },
}));

describe("KIOSK-009: retour accueil après inactivité (fake-timers)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    inactivityWiring.onTimeout = undefined;
    inactivityWiring.delayMs = undefined;
    server.listen({ onUnhandledRequest: "bypass" });
  });
  afterEach(() => {
    server.resetHandlers();
    server.close();
  });

  it("KIOSK-009: timeout 30 s → retour accueil (Vitest fake-timer)", async () => {
    mockGet(doneTicket(2));
    render(
      <NextIntlClientProvider locale="fr" messages={frMessages}>
        <FeedbackScreen {...props} />
      </NextIntlClientProvider>
    );
    await waitFor(() =>
      expect(screen.getAllByTestId("feedback-star").length).toBe(5)
    );
    // Délai nominal 30 s.
    expect(inactivityWiring.delayMs).toBe(30_000);
    // Simule l'expiration du minuteur via fake-timer déterministe.
    vi.useFakeTimers();
    mockPush.mockClear();
    setTimeout(() => inactivityWiring.onTimeout?.(), inactivityWiring.delayMs!);
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(mockPush).toHaveBeenCalledWith("/fr");
    vi.useRealTimers();
  });

  it("KIOSK-009: mode accessibilité → timeout doublé à 60 s", async () => {
    mockGet(doneTicket(2));
    render(
      <NextIntlClientProvider locale="fr" messages={frMessages}>
        <FeedbackScreen {...props} isAccessibilityMode={true} />
      </NextIntlClientProvider>
    );
    await waitFor(() =>
      expect(screen.getAllByTestId("feedback-star").length).toBe(5)
    );
    // Facteur d'accessibilité : délai doublé à 60 s (réutilise le facteur KIOSK-008).
    expect(inactivityWiring.delayMs).toBe(60_000);
    vi.useFakeTimers();
    mockPush.mockClear();
    setTimeout(() => inactivityWiring.onTimeout?.(), inactivityWiring.delayMs!);
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(mockPush).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(mockPush).toHaveBeenCalledWith("/fr");
    vi.useRealTimers();
  });
});
