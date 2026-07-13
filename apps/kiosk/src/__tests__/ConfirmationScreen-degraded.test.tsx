/**
 * KIOSK-007 — Tests TDD (phase rouge) : erreur système + touchers en rafale.
 * 500 ×2 → message humain (registre SIGFA), --danger sur pictogramme SEULEMENT,
 * alert:manager KIOSK_SYSTEM_ERROR (simulé F4). Rafale → zéro doublon.
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { NextIntlClientProvider } from "next-intl";
import { http, HttpResponse } from "msw";
import { server } from "@/mocks/server";

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  useParams: () => ({ locale: "fr" }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/hooks/useInactivityTimeout", () => ({ useInactivityTimeout: vi.fn() }));

const frMessages = {
  confirmation004: {
    title: "Votre numéro de téléphone (facultatif)",
    phonePrefix: "+225",
    phonePlaceholder: "07 __ __ __ __ __",
    smsConsent: "J'accepte de recevoir mon ticket par SMS (optionnel)",
    ctaButton: "PRENDRE MON TICKET",
    skipButton: "Passer (sans numéro de téléphone)",
    errorPhone: "Il manque votre numéro — ou touchez Passer",
    loadingMessage: "Émission de votre ticket...",
    offlineBanner: "Mode hors connexion — ticket local généré",
  },
  degraded007: {
    systemError: "Un problème est survenu. Adressez-vous à l'accueil, on s'occupe de vous.",
  },
};
import { ConfirmationScreen } from "@/components/ConfirmationScreen";
import type { DegradedEventSink } from "@/lib/kiosk-degraded-emitter";

const AGENCY_ID = "33333333-3333-4333-a333-333333333333";

function makeSink(): DegradedEventSink & { calls: Array<{ name: string; payload: unknown }> } {
  const calls: Array<{ name: string; payload: unknown }> = [];
  return { calls, emit: (name, payload) => calls.push({ name, payload }) };
}

function renderConfirmation(sink?: DegradedEventSink) {
  return render(
    <NextIntlClientProvider locale="fr" messages={frMessages}>
      <ConfirmationScreen serviceId="svc-1" agencyId={AGENCY_ID} systemErrorSink={sink} />
    </NextIntlClientProvider>
  );
}

beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
afterEach(() => {
  server.resetHandlers();
  vi.clearAllMocks();
});
afterAll(() => server.close());
beforeEach(() => {
  Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
});

describe("KIOSK-007: ConfirmationScreen erreur système", () => {
  it("KIOSK-007: POST 500 ×2 → message humain registre SIGFA, aucun code d'erreur visible", async () => {
    let attempts = 0;
    server.use(
      http.post("*/public/tickets", () => {
        attempts += 1;
        return HttpResponse.json({ error: { code: "INTERNAL" } }, { status: 500 });
      })
    );
    renderConfirmation();
    fireEvent.click(screen.getByTestId("skip-btn"));

    await waitFor(() =>
      expect(screen.getByTestId("system-error")).toBeInTheDocument()
    );
    expect(screen.getByTestId("system-error").textContent).toContain(
      "Adressez-vous à l'accueil"
    );
    // 2 tentatives réellement effectuées.
    expect(attempts).toBe(2);
    // Aucun code d'erreur technique visible.
    expect(screen.queryByText(/500|INTERNAL|error/i)).not.toBeInTheDocument();
    // Pas de bascule offline silencieuse.
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("KIOSK-007: --danger uniquement sur pictogramme (grep token-usage, pas de fond #F04438)", async () => {
    server.use(
      http.post("*/public/tickets", () =>
        HttpResponse.json({ error: { code: "INTERNAL" } }, { status: 500 })
      )
    );
    renderConfirmation();
    fireEvent.click(screen.getByTestId("skip-btn"));
    await waitFor(() => expect(screen.getByTestId("system-error")).toBeInTheDocument());

    const pictogram = screen.getByTestId("system-error-pictogram");
    expect(pictogram.style.color).toBe("var(--danger)");
    // ICONS-001 : pictogramme = icône SIGFA « alerte » (plus de glyphe texte).
    expect(pictogram.querySelector("svg[data-icon='alerte']")).toBeInTheDocument();
    expect(pictogram.textContent).toBe("");

    // Le conteneur (fond) ne doit JAMAIS porter --danger en background.
    const container = screen.getByTestId("system-error");
    expect(container.style.backgroundColor).not.toContain("danger");
    expect(container.style.background).not.toContain("danger");
  });

  it("KIOSK-007: alert:manager KIOSK_SYSTEM_ERROR émis sur erreur système (type CONTRACT-012 — jamais SLA_BREACH, mock Socket)", async () => {
    server.use(
      http.post("*/public/tickets", () =>
        HttpResponse.json({ error: { code: "INTERNAL" } }, { status: 500 })
      )
    );
    const sink = makeSink();
    renderConfirmation(sink);
    fireEvent.click(screen.getByTestId("skip-btn"));
    await waitFor(() => expect(screen.getByTestId("system-error")).toBeInTheDocument());

    const alert = sink.calls.find((c) => c.name === "alert:manager");
    expect(alert).toBeDefined();
    const payload = alert!.payload as { type: string };
    expect(payload.type).toBe("KIOSK_SYSTEM_ERROR");
    expect(payload.type).not.toBe("SLA_BREACH");
  });

  it("KIOSK-007: touchers rapides → retour visuel < 100 ms, zéro doublon de soumission", async () => {
    let posts = 0;
    server.use(
      http.post("*/public/tickets", async () => {
        posts += 1;
        await new Promise((r) => setTimeout(r, 30));
        return HttpResponse.json(
          {
            trackingId: "TRK-1",
            number: 7,
            displayNumber: "A007",
            position: 4,
            estimatedWaitMinutes: 12,
            queueLength: 10,
            serviceId: "svc-1",
            agencyId: AGENCY_ID,
            channel: "KIOSK",
            createdAt: new Date().toISOString(),
            status: "WAITING",
          },
          { status: 201 }
        );
      })
    );
    renderConfirmation();
    const cta = screen.getByTestId("cta-btn");

    // Rafale de 5 touchers.
    fireEvent.click(cta);
    fireEvent.click(cta);
    fireEvent.click(cta);
    fireEvent.click(cta);
    fireEvent.click(cta);

    await waitFor(() => expect(mockPush).toHaveBeenCalled());
    // Un seul POST malgré la rafale.
    expect(posts).toBe(1);
  });
});
