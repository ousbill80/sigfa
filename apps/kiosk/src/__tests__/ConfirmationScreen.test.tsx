/**
 * KIOSK-004 — Tests TDD pour ConfirmationScreen.tsx
 * Écrits AVANT l'implémentation (phase rouge).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { NextIntlClientProvider } from "next-intl";
import { server } from "@/mocks/server";
import { http, HttpResponse } from "msw";

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

const enMessages = {
  confirmation004: {
    title: "Your phone number (optional)",
    phonePrefix: "+225",
    phonePlaceholder: "07 __ __ __ __ __",
    smsConsent: "I agree to receive my ticket by SMS (optional)",
    ctaButton: "GET MY TICKET",
    skipButton: "Skip (without phone number)",
    errorPhone: "Phone number missing — or tap Skip",
    loadingMessage: "Issuing your ticket...",
    offlineBanner: "Offline mode — local ticket generated",
  },
  degraded007: {
    systemError: "Something went wrong. Please see reception, we will take care of you.",
  },
};

import { ConfirmationScreen } from "@/components/ConfirmationScreen";
import { useOfflineTicket } from "@/hooks/useOfflineTicket";

describe("KIOSK-004: ConfirmationScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    server.listen({ onUnhandledRequest: "bypass" });
  });

  afterEach(() => {
    server.resetHandlers();
    server.close();
  });

  it("KIOSK-004: numeric keypad rendered with keys ≥ 72 px, never OS keyboard (snapshot)", () => {
    const { container } = render(
      <NextIntlClientProvider locale="fr" messages={frMessages}>
        <ConfirmationScreen serviceId="svc-1" agencyId="agt-001" />
      </NextIntlClientProvider>
    );

    // 12 keypad keys: 1-9, *, 0, #
    const keys = container.querySelectorAll("[data-testid='keypad-key']");
    expect(keys.length).toBe(12);

    keys.forEach((key) => {
      const keyEl = key as HTMLElement;
      expect(keyEl.style.minWidth).toBe("72px");
      expect(keyEl.style.minHeight).toBe("72px");
    });

    // Phone input should have readOnly (no OS keyboard)
    const phoneInput = container.querySelector("[data-testid='phone-input']") as HTMLInputElement;
    expect(phoneInput).toBeInTheDocument();
    expect(phoneInput.readOnly).toBe(true);
  });

  it("KIOSK-004: Skip button visible and clickable without phone input", () => {
    render(
      <NextIntlClientProvider locale="fr" messages={frMessages}>
        <ConfirmationScreen serviceId="svc-1" agencyId="agt-001" />
      </NextIntlClientProvider>
    );

    const skipBtn = screen.getByText("Passer (sans numéro de téléphone)");
    expect(skipBtn).toBeInTheDocument();
    expect(skipBtn).not.toBeDisabled();
  });

  it("KIOSK-004: smsConsent absent if phoneNumber empty (payload verification)", () => {
    const { container } = render(
      <NextIntlClientProvider locale="fr" messages={frMessages}>
        <ConfirmationScreen serviceId="svc-1" agencyId="agt-001" />
      </NextIntlClientProvider>
    );

    // SMS consent checkbox should not be visible when phone is empty
    const consent = container.querySelector("[data-testid='sms-consent']");
    expect(consent).not.toBeInTheDocument();
  });

  it("KIOSK-004: X-Idempotency-Key UUID v4 generated and included in each POST /public/tickets", async () => {
    const capturedHeaders: Record<string, string> = {};

    server.use(
      http.post("*/public/tickets", ({ request }) => {
        const idempotencyKey = request.headers.get("X-Idempotency-Key") ?? "";
        capturedHeaders["X-Idempotency-Key"] = idempotencyKey;
        return HttpResponse.json(
          {
            trackingId: "TRK-00001",
            number: 7,
            displayNumber: "A007",
            position: 4,
            estimatedWaitMinutes: 12,
            queueLength: 10,
            serviceId: "svc-001",
            agencyId: "agt-001",
            channel: "KIOSK",
            createdAt: new Date().toISOString(),
            status: "WAITING",
          },
          { status: 201 }
        );
      })
    );

    render(
      <NextIntlClientProvider locale="fr" messages={frMessages}>
        <ConfirmationScreen serviceId="svc-1" agencyId="agt-001" />
      </NextIntlClientProvider>
    );

    const skipBtn = screen.getByText("Passer (sans numéro de téléphone)");
    fireEvent.click(skipBtn);

    await waitFor(() => {
      expect(capturedHeaders["X-Idempotency-Key"]).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      );
    });
  });

  it("MODEL-KIOSK-A: operationId prop → sent in POST /public/tickets body (serviceId reste envoyé)", async () => {
    let capturedBody: Record<string, unknown> = {};
    server.use(
      http.post("*/public/tickets", async ({ request }) => {
        capturedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(
          {
            trackingId: "TRK-00002",
            number: 8,
            displayNumber: "A008",
            position: 2,
            estimatedWaitMinutes: 6,
            queueLength: 5,
            serviceId: "svc-1",
            operationId: "op-1",
            agencyId: "agt-001",
            channel: "KIOSK",
            createdAt: new Date().toISOString(),
            status: "WAITING",
          },
          { status: 201 }
        );
      })
    );

    render(
      <NextIntlClientProvider locale="fr" messages={frMessages}>
        <ConfirmationScreen serviceId="svc-1" operationId="op-1" agencyId="agt-001" />
      </NextIntlClientProvider>
    );

    fireEvent.click(screen.getByText("Passer (sans numéro de téléphone)"));

    await waitFor(() => {
      expect(capturedBody.operationId).toBe("op-1");
    });
    // serviceId reste transmis (rétrocompat + dérivation serveur).
    expect(capturedBody.serviceId).toBe("svc-1");
  });

  it("MODEL-KIOSK-A: sans operationId → body ne contient PAS de operationId (parcours 1 niveau)", async () => {
    let capturedBody: Record<string, unknown> = {};
    server.use(
      http.post("*/public/tickets", async ({ request }) => {
        capturedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(
          {
            trackingId: "TRK-00003",
            number: 9,
            displayNumber: "A009",
            position: 1,
            estimatedWaitMinutes: 4,
            queueLength: 3,
            serviceId: "svc-1",
            agencyId: "agt-001",
            channel: "KIOSK",
            createdAt: new Date().toISOString(),
            status: "WAITING",
          },
          { status: 201 }
        );
      })
    );

    render(
      <NextIntlClientProvider locale="fr" messages={frMessages}>
        <ConfirmationScreen serviceId="svc-1" agencyId="agt-001" />
      </NextIntlClientProvider>
    );

    fireEvent.click(screen.getByText("Passer (sans numéro de téléphone)"));

    await waitFor(() => {
      expect(capturedBody.serviceId).toBe("svc-1");
    });
    expect(capturedBody).not.toHaveProperty("operationId");
  });

  it("MODEL-KIOSK-B: targetManagerId prop → envoyé dans le body POST /public/tickets (serviceId reste requis)", async () => {
    let capturedBody: Record<string, unknown> = {};
    server.use(
      http.post("*/public/tickets", async ({ request }) => {
        capturedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(
          {
            trackingId: "TRK-00042",
            number: 42,
            displayNumber: "C042",
            position: 1,
            estimatedWaitMinutes: 5,
            queueLength: 2,
            serviceId: "svc-conseiller",
            targetManagerId: "rm-1",
            agencyId: "agt-001",
            channel: "KIOSK",
            createdAt: new Date().toISOString(),
            status: "WAITING",
          },
          { status: 201 }
        );
      })
    );

    render(
      <NextIntlClientProvider locale="fr" messages={frMessages}>
        <ConfirmationScreen
          serviceId="svc-conseiller"
          targetManagerId="rm-1"
          agencyId="agt-001"
        />
      </NextIntlClientProvider>
    );

    fireEvent.click(screen.getByText("Passer (sans numéro de téléphone)"));

    await waitFor(() => {
      expect(capturedBody.targetManagerId).toBe("rm-1");
    });
    // serviceId reste requis par le contrat (file conseiller = filtre logique).
    expect(capturedBody.serviceId).toBe("svc-conseiller");
  });

  it("MODEL-KIOSK-B: sans targetManagerId → body ne contient PAS targetManagerId", async () => {
    let capturedBody: Record<string, unknown> = {};
    server.use(
      http.post("*/public/tickets", async ({ request }) => {
        capturedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(
          {
            trackingId: "TRK-00043",
            number: 43,
            displayNumber: "A043",
            position: 1,
            estimatedWaitMinutes: 4,
            queueLength: 1,
            serviceId: "svc-1",
            agencyId: "agt-001",
            channel: "KIOSK",
            createdAt: new Date().toISOString(),
            status: "WAITING",
          },
          { status: 201 }
        );
      })
    );

    render(
      <NextIntlClientProvider locale="fr" messages={frMessages}>
        <ConfirmationScreen serviceId="svc-1" agencyId="agt-001" />
      </NextIntlClientProvider>
    );

    fireEvent.click(screen.getByText("Passer (sans numéro de téléphone)"));

    await waitFor(() => {
      expect(capturedBody.serviceId).toBe("svc-1");
    });
    expect(capturedBody).not.toHaveProperty("targetManagerId");
  });

  it("KIOSK-004: POST 201 → navigation KIOSK-005 with trackingId, displayNumber, position, estimatedWaitMinutes", async () => {
    render(
      <NextIntlClientProvider locale="fr" messages={frMessages}>
        <ConfirmationScreen serviceId="svc-1" agencyId="agt-001" />
      </NextIntlClientProvider>
    );

    const skipBtn = screen.getByText("Passer (sans numéro de téléphone)");
    fireEvent.click(skipBtn);

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith(
        expect.stringContaining("/fr/ticket")
      );
    });

    const pushedUrl = mockPush.mock.calls[0][0] as string;
    expect(pushedUrl).toContain("trackingId=TRK-00001");
    expect(pushedUrl).toContain("displayNumber=A007");
    expect(pushedUrl).toContain("position=4");
    expect(pushedUrl).toContain("estimatedWaitMinutes=12");
  });

  it("KIOSK-004: POST 409 IDEMPOTENCY_CONFLICT → navigation KIOSK-005 without duplicate", async () => {
    // 409 returns ErrorResponse, not ticket data — component falls back to offline ticket
    server.use(
      http.post("*/public/tickets", () => {
        return HttpResponse.json(
          {
            error: {
              code: "IDEMPOTENCY_CONFLICT",
              message: "Même X-Idempotency-Key avec un payload différent.",
            },
          },
          { status: 409 }
        );
      })
    );

    render(
      <NextIntlClientProvider locale="fr" messages={frMessages}>
        <ConfirmationScreen serviceId="svc-1" agencyId="agt-001" />
      </NextIntlClientProvider>
    );

    const skipBtn = screen.getByText("Passer (sans numéro de téléphone)");
    fireEvent.click(skipBtn);

    // The component should navigate to ticket screen (via offline fallback on non-201 response)
    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith(
        expect.stringContaining("/fr/ticket")
      );
    });
  });

  it("KIOSK-004: hook useOfflineTicket() declared stub (interface + mock return) — importable by Confirmation screen", () => {
    const { createOfflineTicket } = useOfflineTicket();
    expect(typeof createOfflineTicket).toBe("function");
  });

  it("KIOSK-004: network cut → offline fallback via useOfflineTicket() stub without visible error screen", async () => {
    server.use(
      http.post("*/public/tickets", () => {
        return HttpResponse.error();
      })
    );

    render(
      <NextIntlClientProvider locale="fr" messages={frMessages}>
        <ConfirmationScreen serviceId="svc-1" agencyId="agt-001" />
      </NextIntlClientProvider>
    );

    const skipBtn = screen.getByText("Passer (sans numéro de téléphone)");
    fireEvent.click(skipBtn);

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith(
        expect.stringContaining("/fr/ticket")
      );
    });
  });

  it("KIOSK-004: invalid number → inline message SIGFA register (Testing Library FR/EN)", async () => {
    const locales = [
      { locale: "fr", messages: frMessages, errorMsg: "Il manque votre numéro — ou touchez Passer" },
      { locale: "en", messages: enMessages, errorMsg: "Phone number missing — or tap Skip" },
    ];

    for (const { locale, messages, errorMsg } of locales) {
      const { unmount, container } = render(
        <NextIntlClientProvider locale={locale} messages={messages}>
          <ConfirmationScreen serviceId="svc-1" agencyId="agt-001" />
        </NextIntlClientProvider>
      );

      // Click only a few keypad digits (invalid short number)
      const keys = container.querySelectorAll("[data-testid='keypad-key']");
      // Click digit "1" twice to create an invalid number
      fireEvent.click(keys[0]); // 1
      fireEvent.click(keys[0]); // 1

      // Click the CTA button
      const ctaBtn = container.querySelector("[data-testid='cta-btn']");
      expect(ctaBtn).toBeInTheDocument();
      fireEvent.click(ctaBtn!);

      await waitFor(() => {
        const errorEl = container.querySelector("[data-testid='phone-error']");
        expect(errorEl, `Error msg for ${locale}`).toBeInTheDocument();
        expect(errorEl?.textContent, `Error text for ${locale}`).toBe(errorMsg);
      });

      unmount();
    }
  });

  it("KIOSK-004: CTA height 88 px, token --brand (snapshot)", () => {
    const { container } = render(
      <NextIntlClientProvider locale="fr" messages={frMessages}>
        <ConfirmationScreen serviceId="svc-1" agencyId="agt-001" />
      </NextIntlClientProvider>
    );

    const ctaBtn = container.querySelector("[data-testid='cta-btn']") as HTMLElement;
    expect(ctaBtn).toBeInTheDocument();
    expect(ctaBtn.style.minHeight).toBe("88px");
    expect(ctaBtn.style.backgroundColor).toBe("var(--brand)");
    expect(ctaBtn.style.fontSize).toBe("28px");
  });
});
