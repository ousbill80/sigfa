/**
 * KIOSK-006 — Tests du bandeau offline (--info, non bloquant, fondu 250 ms).
 * Écrits AVANT l'implémentation (phase rouge).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { NextIntlClientProvider } from "next-intl";
import { OfflineBanner, OFFLINE_BANNER_FADE_MS } from "@/components/OfflineBanner";

const messages = {
  confirmation004: {
    offlineBanner: "Mode hors connexion — vos tickets restent valables",
  },
};

function renderBanner(isOffline: boolean) {
  return render(
    <NextIntlClientProvider locale="fr" messages={messages}>
      <OfflineBanner isOffline={isOffline} />
    </NextIntlClientProvider>
  );
}

describe("KIOSK-006: OfflineBanner", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it("KIOSK-006: bandeau --info visible offline (token info, message hors connexion)", () => {
    renderBanner(true);
    const banner = screen.getByTestId("offline-banner");
    expect(banner).toBeInTheDocument();
    expect(banner.style.backgroundColor).toBe("var(--info)");
    expect(banner.textContent).toBe(
      "Mode hors connexion — vos tickets restent valables"
    );
  });

  it("KIOSK-006: bandeau --info disparu en 250 ms au retour réseau (fondu)", () => {
    const { rerender } = renderBanner(true);
    expect(screen.getByTestId("offline-banner")).toBeInTheDocument();

    // Retour réseau → fondu déclenché (opacity 0 + transition 250 ms).
    act(() => {
      rerender(
        <NextIntlClientProvider locale="fr" messages={messages}>
          <OfflineBanner isOffline={false} />
        </NextIntlClientProvider>
      );
    });
    const fading = screen.getByTestId("offline-banner");
    expect(fading.getAttribute("data-fading")).toBe("true");
    expect(fading.style.transition).toContain(`${OFFLINE_BANNER_FADE_MS}ms`);
    expect(fading.style.opacity).toBe("0");

    // Après 250 ms, le bandeau est démonté.
    act(() => {
      vi.advanceTimersByTime(OFFLINE_BANNER_FADE_MS);
    });
    expect(screen.queryByTestId("offline-banner")).not.toBeInTheDocument();
  });

  it("KIOSK-006: bandeau absent quand la borne est en ligne", () => {
    renderBanner(false);
    expect(screen.queryByTestId("offline-banner")).not.toBeInTheDocument();
  });
});
