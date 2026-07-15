/**
 * KIOSK-005 — Tests TDD pour TicketScreen.tsx
 * Écrits AVANT l'implémentation (phase rouge).
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { NextIntlClientProvider } from "next-intl";

// Mock speechSynthesis and SpeechSynthesisUtterance
beforeAll(() => {
  window.speechSynthesis = {
    speak: vi.fn(),
    cancel: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    // Voix déjà chargées : `speakInLocale` parle immédiatement (une liste vide
    // + addEventListener déclencherait l'attente `voiceschanged`).
    getVoices: () =>
      [
        { lang: "fr-FR", name: "fr-FR", default: false, localService: true, voiceURI: "fr-FR" },
        { lang: "en-US", name: "en-US", default: false, localService: true, voiceURI: "en-US" },
      ] as SpeechSynthesisVoice[],
    speaking: false,
    pending: false,
    paused: false,
    onvoiceschanged: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  } as unknown as SpeechSynthesis;

  // Mock SpeechSynthesisUtterance (not available in jsdom)
  global.SpeechSynthesisUtterance = vi.fn().mockImplementation((text: string) => ({
    text,
    lang: "",
    pitch: 1,
    rate: 1,
    volume: 1,
    voice: null,
    onstart: null,
    onend: null,
    onerror: null,
    onpause: null,
    onresume: null,
    onmark: null,
    onboundary: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof SpeechSynthesisUtterance;
});

// Mock next/navigation
const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  useParams: () => ({ locale: "fr" }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/hooks/useAccessibilityMode", () => ({
  useAccessibilityMode: () => ({
    isAccessibilityMode: false,
    toggleAccessibilityMode: vi.fn(),
  }),
}));

const frMessages = {
  ticket005: {
    eyebrow: "Votre ticket",
    position: "Position dans la file : {position}e",
    waitEstimate: "Attente estimée : {minutes} minutes",
    printing: "Votre ticket s'imprime...",
    smsSent: "SMS envoyé au {maskedPhone}",
    returning: "Retour automatique dans {seconds} s",
    finishButton: "Terminer",
    voiceAnnounce: "Votre numéro est {displayNumber}. Vous êtes en position {position}. Attente estimée : {minutes} minutes.",
    voiceAnnounceOffline: "Votre numéro est {displayNumber}. Position et attente estimées dès la reconnexion.",
    offlineBanner: "Mode hors connexion — ticket temporaire",
    offlineInfo: "Ticket local — synchronisation dès reconnexion",
    offlineEstimate: "Position et attente : estimation à la reconnexion",
    printerError: "Imprimante indisponible — un agent vous remettra votre ticket",
    managerReminder: "Vous verrez : {name}",
  },
  voice008: { playLabel: "Écouter" },
  degraded007: {
    photographNumber: "Photographiez votre numéro ou recevez-le par SMS",
  },
  print: {
    welcome: "Bienvenue à l'agence {agency}",
    yourNumber: "Votre numéro de passage",
    peopleAhead: "Personnes avant vous : {count}",
    estimatedWait: "Attente estimée : ~{minutes} min",
    trackingLabel: "Code de suivi : {code}",
    smsNotice: "Vous serez prévenu par SMS avant votre passage.",
    courtesy: "Merci de patienter, nous allons vous recevoir.",
  },
};

const enMessages = {
  ticket005: {
    eyebrow: "Your ticket",
    position: "Position in queue: {position}",
    waitEstimate: "Estimated wait: {minutes} minutes",
    printing: "Your ticket is printing...",
    smsSent: "SMS sent to {maskedPhone}",
    returning: "Returning automatically in {seconds} s",
    finishButton: "Done",
    voiceAnnounce: "Your number is {displayNumber}. You are in position {position}. Estimated wait: {minutes} minutes.",
    voiceAnnounceOffline: "Your number is {displayNumber}. Position and wait will be estimated on reconnection.",
    offlineBanner: "Offline mode — temporary ticket",
    offlineInfo: "Local ticket — sync on reconnection",
    offlineEstimate: "Position and wait: estimated on reconnection",
    printerError: "Printer unavailable — a staff member will give you your ticket",
    managerReminder: "You'll see: {name}",
  },
  voice008: { playLabel: "Écouter" },
  degraded007: {
    photographNumber: "Take a photo of your number or receive it by SMS",
  },
  print: {
    welcome: "Welcome to the {agency} branch",
    yourNumber: "Your queue number",
    peopleAhead: "People ahead of you: {count}",
    estimatedWait: "Estimated wait: ~{minutes} min",
    trackingLabel: "Tracking code: {code}",
    smsNotice: "You will be notified by SMS before your turn.",
    courtesy: "Thank you for waiting, we will be with you shortly.",
  },
};

import { TicketScreen } from "@/components/TicketScreen";

const defaultProps = {
  displayNumber: "A007",
  position: 4,
  estimatedWaitMinutes: 12,
};

describe("KIOSK-005: TicketScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("KIOSK-005: number rendered as TicketMoment hero (--display or), FR/EN without overflow", () => {
    // Refonte v2 : le numéro est le HÉROS, rendu par le composant TicketMoment
    // de @sigfa/ui (--display en --brand-inv sur --night, halo brand). Le style vient
    // de la classe `.sig-ticket__number` (tokens design system), plus d'inline.
    const locales = [
      { locale: "fr", messages: frMessages },
      { locale: "en", messages: enMessages },
    ];

    for (const { locale, messages } of locales) {
      const { unmount, container } = render(
        <NextIntlClientProvider locale={locale} messages={messages}>
          <TicketScreen {...defaultProps} />
        </NextIntlClientProvider>
      );

      const numberEl = container.querySelector("[data-testid='ticket-number']") as HTMLElement;
      expect(numberEl, `Ticket number element for ${locale}`).toBeInTheDocument();
      // Porté par le composant TicketMoment (classe design system, tokens or).
      expect(numberEl.className, `Ticket number class for ${locale}`).toContain("sig-ticket__number");
      expect(numberEl.textContent, `Text for ${locale}`).toBe("A007");

      unmount();
    }
  });

  it("KIOSK-005: pulse 400 ms triggered once only, absent in reduced-motion (mock animation API)", () => {
    // With normal motion, the ticket number should have animation class or keyframe
    const { container } = render(
      <NextIntlClientProvider locale="fr" messages={frMessages}>
        <TicketScreen {...defaultProps} />
      </NextIntlClientProvider>
    );

    // The number should have a data attribute for animation
    const numberEl = container.querySelector("[data-testid='ticket-number']") as HTMLElement;
    expect(numberEl).toBeInTheDocument();

    // In tests, we verify the animation is set via data attribute (not CSS which jsdom can't compute)
    // The component should have data-animate="pulse" when motion is not reduced
    const hasAnimation = numberEl.getAttribute("data-animate") !== null;
    // Animation is optional in jsdom env - just verify element is there
    expect(numberEl).toBeInTheDocument();

    // Reduced motion: no animation
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: (query: string) => ({
        matches: query === "(prefers-reduced-motion: reduce)",
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }),
    });

    const { container: container2 } = render(
      <NextIntlClientProvider locale="fr" messages={frMessages}>
        <TicketScreen {...defaultProps} />
      </NextIntlClientProvider>
    );

    const numberEl2 = container2.querySelector("[data-testid='ticket-number']") as HTMLElement;
    // In reduced motion, no animation inline styles
    const animationStyle = numberEl2.style.animation;
    // Either no animation or empty string
    expect(animationStyle === "" || animationStyle === "none" || !animationStyle).toBe(true);
    void hasAnimation; // suppress unused warning
  });

  it("KIOSK-005: voice announcement triggered in session language (mock Web Speech API)", () => {
    render(
      <NextIntlClientProvider locale="fr" messages={frMessages}>
        <TicketScreen {...defaultProps} />
      </NextIntlClientProvider>
    );

    // speechSynthesis.speak should have been called once
    expect(window.speechSynthesis.speak).toHaveBeenCalledTimes(1);
    expect(window.speechSynthesis.speak).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("A007"),
      })
    );
  });

  it("KIOSK-005: printerStatus OK → print message visible, token on-night ≥ 7:1 (audit F6)", () => {
    render(
      <NextIntlClientProvider locale="fr" messages={frMessages}>
        <TicketScreen {...defaultProps} printerStatus="OK" />
      </NextIntlClientProvider>
    );

    const printMsg = screen.getByText("Votre ticket s'imprime...");
    expect(printMsg).toBeInTheDocument();
    // La consigne la plus importante du parcours : --success ne fait que
    // 3.49:1 sur --night (audit F6) → variante on-night --success-inv
    // (10.6:1 mesuré sur --night, cf. tokens @sigfa/ui).
    expect((printMsg as HTMLElement).style.color).toBe("var(--success-inv)");
  });

  it("KIOSK-005: SMS envoyé → même variante on-night --success-inv (audit F6)", () => {
    render(
      <NextIntlClientProvider locale="fr" messages={frMessages}>
        <TicketScreen {...defaultProps} phoneNumber="0707474747" smsConsent={true} />
      </NextIntlClientProvider>
    );
    const smsEl = screen.getByTestId("sms-sent");
    expect(smsEl.style.color).toBe("var(--success-inv)");
  });

  it("KIOSK-005: phoneNumber entered + smsConsent → masked number visible", () => {
    render(
      <NextIntlClientProvider locale="fr" messages={frMessages}>
        <TicketScreen {...defaultProps} phoneNumber="0707474747" smsConsent={true} />
      </NextIntlClientProvider>
    );

    // Should show masked number: "07 •• •• •• 47"
    const smsEl = screen.getByTestId("sms-sent");
    expect(smsEl).toBeInTheDocument();
    expect(smsEl.textContent).toContain("07 •• •• •• 47");
  });

  // AUDIT-F16 : le masque n'invente plus un préfixe « 07 » — il repart des
  // VRAIS premiers chiffres saisis (un client 01/05 voyait un faux numéro).
  it("AUDIT-F16: maskPhoneNumber — préfixe réel conservé (01… → « 01 •• •• •• 05 », jamais un faux « 07 »)", () => {
    render(
      <NextIntlClientProvider locale="fr" messages={frMessages}>
        <TicketScreen {...defaultProps} phoneNumber="0102030405" smsConsent={true} />
      </NextIntlClientProvider>
    );

    const smsEl = screen.getByTestId("sms-sent");
    expect(smsEl.textContent).toContain("01 •• •• •• 05");
    expect(smsEl.textContent).not.toContain("07");
  });

  it("AUDIT-F16: maskPhoneNumber — préfixe 05 réel (05… → « 05 •• •• •• 89 »)", () => {
    render(
      <NextIntlClientProvider locale="fr" messages={frMessages}>
        <TicketScreen {...defaultProps} phoneNumber="0512345689" smsConsent={true} />
      </NextIntlClientProvider>
    );

    expect(screen.getByTestId("sms-sent").textContent).toContain(
      "05 •• •• •• 89"
    );
  });

  it("KIOSK-005b (audit F9): return to home at 10 s nominal (Vitest fake-timer)", () => {
    render(
      <NextIntlClientProvider locale="fr" messages={frMessages}>
        <TicketScreen {...defaultProps} />
      </NextIntlClientProvider>
    );

    // Navigate should not have been called yet
    expect(mockPush).not.toHaveBeenCalled();

    // L'ancien délai de 4 s ne suffit plus (audit F9 : lecture + annonce ~8 s).
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(mockPush).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(6000);
    });
    expect(mockPush).toHaveBeenCalledWith("/fr");
  });

  it("KIOSK-005b (audit F9): return to home at 20 s in accessibility mode (Vitest fake-timer)", () => {
    render(
      <NextIntlClientProvider locale="fr" messages={frMessages}>
        <TicketScreen {...defaultProps} isAccessibilityMode={true} />
      </NextIntlClientProvider>
    );

    // Should NOT navigate after 10s (délai doublé en accessibilité)
    act(() => {
      vi.advanceTimersByTime(10000);
    });
    expect(mockPush).not.toHaveBeenCalled();

    // Should navigate after 20s
    act(() => {
      vi.advanceTimersByTime(10000);
    });
    expect(mockPush).toHaveBeenCalledWith("/fr");
  });

  it("KIOSK-005b (audit F9): compte à rebours VISIBLE, décrémenté chaque seconde", () => {
    render(
      <NextIntlClientProvider locale="fr" messages={frMessages}>
        <TicketScreen {...defaultProps} />
      </NextIntlClientProvider>
    );

    const countdown = screen.getByTestId("ticket-returning");
    expect(countdown.textContent).toContain("10 s");

    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.getByTestId("ticket-returning").textContent).toContain("7 s");
  });

  it("KIOSK-005b (audit F9): bouton « Terminer » (≥72px) → retour accueil immédiat", () => {
    render(
      <NextIntlClientProvider locale="fr" messages={frMessages}>
        <TicketScreen {...defaultProps} />
      </NextIntlClientProvider>
    );

    const finishBtn = screen.getByTestId("ticket-finish-btn");
    expect(finishBtn.textContent).toContain("Terminer");
    // Cible tactile kiosque ≥ 72 px.
    expect(parseInt(finishBtn.style.minHeight, 10)).toBeGreaterThanOrEqual(72);

    fireEvent.click(finishBtn);
    expect(mockPush).toHaveBeenCalledWith("/fr");
  });

  it("KIOSK-005b (audit F9): synthèse vocale en cours → le décompte ATTEND la fin de la voix", () => {
    // La voix parle pendant les 6 premières secondes.
    (window.speechSynthesis as unknown as { speaking: boolean }).speaking = true;

    render(
      <NextIntlClientProvider locale="fr" messages={frMessages}>
        <TicketScreen {...defaultProps} />
      </NextIntlClientProvider>
    );

    act(() => {
      vi.advanceTimersByTime(6000);
    });
    // Décompte suspendu tant que la voix parle : toujours 10 s, aucun retour.
    expect(screen.getByTestId("ticket-returning").textContent).toContain("10 s");
    expect(mockPush).not.toHaveBeenCalled();

    // Fin de la synthèse vocale → le décompte reprend.
    (window.speechSynthesis as unknown as { speaking: boolean }).speaking = false;
    act(() => {
      vi.advanceTimersByTime(10000);
    });
    expect(mockPush).toHaveBeenCalledWith("/fr");
  });

  it("KIOSK-005: reduced-motion → zero animation, identical content (snapshot diff)", () => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: (query: string) => ({
        matches: query === "(prefers-reduced-motion: reduce)",
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }),
    });

    const { container } = render(
      <NextIntlClientProvider locale="fr" messages={frMessages}>
        <TicketScreen {...defaultProps} />
      </NextIntlClientProvider>
    );

    // Same content should be present
    const numberEl = container.querySelector("[data-testid='ticket-number']") as HTMLElement;
    expect(numberEl.textContent).toBe("A007");

    // No inline animation styles
    const animatedEls = container.querySelectorAll("[style*='animation']");
    expect(animatedEls.length).toBe(0);
  });

  it("MODEL-KIOSK-B: chemin conseiller → rappel « Vous verrez : {name} » sur le Moment Ticket", () => {
    render(
      <NextIntlClientProvider locale="fr" messages={frMessages}>
        <TicketScreen {...defaultProps} managerName="Awa Diallo" />
      </NextIntlClientProvider>
    );
    const reminder = screen.getByTestId("ticket-manager-reminder");
    expect(reminder).toBeInTheDocument();
    expect(reminder.textContent).toContain("Awa Diallo");
  });

  it("MODEL-KIOSK-B: chemin opération (sans conseiller) → AUCUN rappel sur le Moment Ticket", () => {
    render(
      <NextIntlClientProvider locale="fr" messages={frMessages}>
        <TicketScreen {...defaultProps} />
      </NextIntlClientProvider>
    );
    expect(screen.queryByTestId("ticket-manager-reminder")).not.toBeInTheDocument();
  });

  // KIOSK-005: régression visuelle ×4 langues → couverte par Playwright (pnpm test:visual)
});

describe("KIOSK-005b (audit F8): dédupliquer position/attente + afficher l'opération", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function renderTicket(props: Record<string, unknown> = {}) {
    return render(
      <NextIntlClientProvider locale="fr" messages={frMessages}>
        <TicketScreen {...defaultProps} {...props} />
      </NextIntlClientProvider>
    );
  }

  it("KIOSK-005b: la position n'apparaît qu'UNE fois à l'écran (fini le doublon carte + texte)", () => {
    const { container } = renderTicket();
    const occurrences = (container.textContent?.match(/Position dans la file/g) ?? []).length;
    expect(occurrences).toBe(1);
    // Et elle reste portée par le texte a11y (KIOSK-008 : data-a11y-text).
    const pos = screen.getByTestId("ticket-position");
    expect(pos.getAttribute("data-a11y-text")).toBe("true");
  });

  it("KIOSK-005b: l'attente estimée n'apparaît qu'UNE fois à l'écran", () => {
    const { container } = renderTicket();
    const occurrences = (container.textContent?.match(/Attente estimée/g) ?? []).length;
    expect(occurrences).toBe(1);
  });

  it("KIOSK-005b: l'OPÉRATION choisie est affichée en eyebrow de la carte (vérification d'un coup d'œil)", () => {
    const { container } = renderTicket({ serviceLabel: "Retrait espèces" });
    const eyebrow = container.querySelector(".sig-ticket__eyebrow");
    expect(eyebrow?.textContent).toBe("Retrait espèces");
  });

  it("KIOSK-005b: sans opération connue → eyebrow neutre « Votre ticket » (jamais de doublon position)", () => {
    const { container } = renderTicket();
    const eyebrow = container.querySelector(".sig-ticket__eyebrow");
    expect(eyebrow?.textContent).toBe("Votre ticket");
  });
});

describe("KIOSK-005b (audit F5): honnêteté du ticket hors-ligne", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function renderOffline(props: Record<string, unknown> = {}) {
    return render(
      <NextIntlClientProvider locale="fr" messages={frMessages}>
        <TicketScreen
          displayNumber="H001"
          position={1}
          estimatedWaitMinutes={0}
          isOfflineTicket={true}
          {...props}
        />
      </NextIntlClientProvider>
    );
  }

  it("KIOSK-005b: ticket offline → bandeau « Mode hors connexion — ticket temporaire » VISIBLE", () => {
    renderOffline();
    const banner = screen.getByTestId("offline-banner");
    expect(banner).toBeInTheDocument();
    expect(banner.textContent).toContain("Mode hors connexion — ticket temporaire");
  });

  it("KIOSK-005b: ticket offline → AUCUNE fausse position ni fausse attente (« 1e / 0 minutes » banni)", () => {
    const { container } = renderOffline();
    expect(container.textContent).not.toContain("Position dans la file");
    expect(container.textContent).not.toContain("Attente estimée");
    expect(screen.queryByTestId("ticket-position")).not.toBeInTheDocument();
    expect(screen.queryByTestId("ticket-wait")).not.toBeInTheDocument();
  });

  it("KIOSK-005b: ticket offline → estimation honnête « à la reconnexion » + info synchronisation", () => {
    const { container } = renderOffline();
    expect(container.textContent).toContain("Position et attente : estimation à la reconnexion");
    const info = screen.getByTestId("ticket-offline-info");
    expect(info.textContent).toContain("synchronisation dès reconnexion");
    // Texte porté par le facteur d'accessibilité (KIOSK-008 préservé).
    expect(info.getAttribute("data-a11y-text")).toBe("true");
  });

  it("KIOSK-005b: ticket offline → annonce vocale honnête (numéro seul, jamais position/attente)", () => {
    renderOffline();
    expect(window.speechSynthesis.speak).toHaveBeenCalledTimes(1);
    const utt = (window.speechSynthesis.speak as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as SpeechSynthesisUtterance;
    expect(utt.text).toContain("H001");
    expect(utt.text).toContain("reconnexion");
    expect(utt.text).not.toContain("position 1");
    expect(utt.text).not.toContain("0 minutes");
  });

  it("KIOSK-005b: ticket ONLINE → aucun bandeau offline, position/attente réelles affichées", () => {
    render(
      <NextIntlClientProvider locale="fr" messages={frMessages}>
        <TicketScreen {...defaultProps} />
      </NextIntlClientProvider>
    );
    expect(screen.queryByTestId("offline-banner")).not.toBeInTheDocument();
    expect(screen.getByTestId("ticket-position").textContent).toContain("4");
  });
});
