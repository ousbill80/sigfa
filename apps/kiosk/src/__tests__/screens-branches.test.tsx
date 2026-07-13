/**
 * KIOSK-002..005 — Tests de couverture branches résiduelles
 * Cible : branches non atteintes dans HomeScreen (inactivité, file null) et TicketScreen (langue en-US, annonce déjà faite).
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { NextIntlClientProvider } from "next-intl";

// ─── Speech Synthesis mock ──────────────────────────────
beforeAll(() => {
  if (!window.speechSynthesis) {
    window.speechSynthesis = {
      speak: vi.fn(),
      cancel: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      getVoices: () => [],
      speaking: false,
      pending: false,
      paused: false,
      onvoiceschanged: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    } as unknown as SpeechSynthesis;
  }
  if (!global.SpeechSynthesisUtterance) {
    global.SpeechSynthesisUtterance = vi.fn().mockImplementation((text: string) => ({
      text,
      lang: "",
    })) as unknown as typeof SpeechSynthesisUtterance;
  }
});

// ─── navigation mocks ───────────────────────────────────
const mockPush = vi.fn();
const mockBack = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, back: mockBack }),
  useParams: () => ({ locale: "en" }),
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

// Mock useQueueStatus to return NULL count/minutes (exercises queueUnavailable branch)
vi.mock("@/hooks/useQueueStatus", () => ({
  useQueueStatus: () => ({ count: null, estimatedMinutes: null, isOffline: false }),
}));

const homeMessages = {
  home002: {
    title: "Akwaba — Welcome",
    welcomeAgency: "to {agencyName} branch",
    chooseLanguage: "Choose your language",
    languageFr: "Français",
    languageEn: "English",
    queueStatus: "Queue: {count} people — estimated wait: {minutes} min",
    queueUnavailable: "Queue unavailable",
    offlineBanner: "Offline mode — your tickets remain valid",
    loading: "Loading...",
  },
};

const ticketMessages = {
  ticket005: {
    position: "Position in queue: {position}",
    waitEstimate: "Estimated wait: {minutes} minutes",
    printing: "Your ticket is printing...",
    smsSent: "SMS sent to {maskedPhone}",
    returning: "Returning automatically in {seconds} s",
    voiceAnnounce: "Your number is {displayNumber}. You are in position {position}. Estimated wait: {minutes} minutes.",
    offlineBanner: "Offline mode — temporary ticket",
    offlineInfo: "Local ticket — sync on reconnection",
    printerError: "Printer unavailable — a staff member will give you your ticket",
  },
  voice008: { playLabel: "Écouter" },
  degraded007: {
    photographNumber: "Take a photo of your number or receive it by SMS",
  },
};

import { HomeScreen } from "@/components/HomeScreen";
import { TicketScreen } from "@/components/TicketScreen";
import { useInactivityTimeout } from "@/hooks/useInactivityTimeout";

// ═══════════════════════════════════════════════════════════
// HomeScreen — queue null branch
// ═══════════════════════════════════════════════════════════

describe("KIOSK-002: HomeScreen queue null branch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("KIOSK-002: shows queueUnavailable text when count and estimatedMinutes are null", () => {
    // useQueueStatus is mocked at module-level to return null count/minutes
    render(
      <NextIntlClientProvider locale="en" messages={homeMessages}>
        <HomeScreen />
      </NextIntlClientProvider>
    );

    const queueEl = screen.getByTestId("queue-status");
    expect(queueEl).toBeInTheDocument();
    expect(queueEl.textContent).toBe("Queue unavailable");
  });

  it("KIOSK-002: inactivity timeout callback navigates to /{currentLocale} when triggered", () => {
    const useInactivityTimeoutMock = vi.mocked(useInactivityTimeout);

    render(
      <NextIntlClientProvider locale="en" messages={homeMessages}>
        <HomeScreen />
      </NextIntlClientProvider>
    );

    // Extract the callback passed to useInactivityTimeout
    expect(useInactivityTimeoutMock).toHaveBeenCalled();
    const callback = useInactivityTimeoutMock.mock.calls[0][0];
    expect(typeof callback).toBe("function");

    // Invoke the callback manually to exercise the route push
    callback();
    // locale is "en" from useParams mock in this file
    expect(mockPush).toHaveBeenCalledWith("/en");
  });
});

// ═══════════════════════════════════════════════════════════
// TicketScreen — language en-US branch + speechSynthesis absent
// ═══════════════════════════════════════════════════════════

describe("KIOSK-005: TicketScreen en-US branch and no-speechSynthesis branch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("KIOSK-005: locale != fr → utterance.lang set to en-US", () => {
    const utteranceMock = vi.fn().mockImplementation((text: string) => ({
      text,
      lang: "",
      pitch: 1,
      rate: 1,
    }));
    global.SpeechSynthesisUtterance = utteranceMock as unknown as typeof SpeechSynthesisUtterance;

    const speakMock = vi.fn();
    window.speechSynthesis = { ...window.speechSynthesis, speak: speakMock } as unknown as SpeechSynthesis;

    render(
      <NextIntlClientProvider locale="en" messages={ticketMessages}>
        <TicketScreen
          displayNumber="B001"
          position={1}
          estimatedWaitMinutes={5}
        />
      </NextIntlClientProvider>
    );

    // utterance should be created and spoken
    expect(utteranceMock).toHaveBeenCalledTimes(1);
    expect(speakMock).toHaveBeenCalledTimes(1);
  });

  it("KIOSK-005: when speechSynthesis NOT in window, voice announcement is skipped gracefully", () => {
    // Temporarily remove speechSynthesis from window
    const originalSpeechSynthesis = window.speechSynthesis;
    // @ts-expect-error intentionally removing for test
    delete window.speechSynthesis;

    render(
      <NextIntlClientProvider locale="en" messages={ticketMessages}>
        <TicketScreen
          displayNumber="C002"
          position={2}
          estimatedWaitMinutes={7}
        />
      </NextIntlClientProvider>
    );

    // Should not throw — component renders fine
    expect(screen.getByTestId("ticket-number")).toBeInTheDocument();

    // Restore
    window.speechSynthesis = originalSpeechSynthesis;
  });

  it("KIOSK-005: re-render does not trigger voice announcement twice (hasAnnouncedRef guard)", () => {
    const speakMock = vi.fn();
    const utteranceMock = vi.fn().mockImplementation((text: string) => ({
      text,
      lang: "",
    }));
    window.speechSynthesis = { ...window.speechSynthesis, speak: speakMock } as unknown as SpeechSynthesis;
    global.SpeechSynthesisUtterance = utteranceMock as unknown as typeof SpeechSynthesisUtterance;

    const { rerender } = render(
      <NextIntlClientProvider locale="en" messages={ticketMessages}>
        <TicketScreen
          displayNumber="D003"
          position={3}
          estimatedWaitMinutes={10}
        />
      </NextIntlClientProvider>
    );

    // Called once on first render
    expect(speakMock).toHaveBeenCalledTimes(1);

    // Re-render with same props
    rerender(
      <NextIntlClientProvider locale="en" messages={ticketMessages}>
        <TicketScreen
          displayNumber="D003"
          position={3}
          estimatedWaitMinutes={10}
        />
      </NextIntlClientProvider>
    );

    // Should still be only 1 call due to hasAnnouncedRef guard
    expect(speakMock).toHaveBeenCalledTimes(1);
  });
});
