/**
 * Boucle 2 F4 — S5 : câblage RUNTIME de la session borne (KIOSK-001).
 * Tests TDD écrits AVANT l'implémentation (phase rouge).
 *
 * KioskSessionProvider est monté dans le layout : il provisionne la session
 * borne au démarrage, la RE-CRÉE à expiration (12 h non renouvelable) et, en
 * échec, affiche une bannière NON BLOQUANTE (états dégradés KIOSK-007) avec
 * reconnexion silencieuse en arrière-plan — jamais de crash.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { NextIntlClientProvider } from "next-intl";
import { KioskSessionProvider } from "@/components/KioskSessionProvider";
import {
  getKioskSessionToken,
  __resetKioskSessionForTests,
} from "@/lib/kiosk-session-store";
import type { KioskSession } from "@/lib/kiosk-session";

const messages = {
  session: {
    expired: "Votre session a expiré",
    reconnecting: "Reconnexion en cours...",
  },
};

function makeSession(overrides: Partial<KioskSession> = {}): KioskSession {
  return {
    accessToken: "jwt-provider",
    expiresIn: 43200,
    kioskId: "k1",
    agencyId: "a1",
    bankId: "22222222-2222-4222-a222-222222222222",
    createdAt: Date.now(),
    ...overrides,
  };
}

function renderProvider(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="fr" messages={messages}>
      {ui}
    </NextIntlClientProvider>
  );
}

beforeEach(() => {
  __resetKioskSessionForTests();
});

afterEach(() => {
  __resetKioskSessionForTests();
  vi.useRealTimers();
});

describe("KIOSK-001/S5: KioskSessionProvider — session borne câblée au démarrage", () => {
  it("S5: provisionne la session au démarrage de la borne (createKioskSession câblé)", async () => {
    const provisioner = vi.fn(async () => makeSession());

    renderProvider(
      <KioskSessionProvider provisioner={provisioner}>
        <p>écran borne</p>
      </KioskSessionProvider>
    );

    await waitFor(() => expect(provisioner).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(getKioskSessionToken()).toBe("jwt-provider"));
    // Parcours client jamais bloqué.
    expect(screen.getByText("écran borne")).toBeInTheDocument();
    // Session saine → aucune bannière dégradée.
    expect(screen.queryByTestId("session-degraded-banner")).not.toBeInTheDocument();
  });

  it("S5: échec de provisionnement → bannière NON bloquante + retry silencieux", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const provisioner = vi.fn(async () => {
      calls += 1;
      return calls === 1 ? null : makeSession();
    });

    renderProvider(
      <KioskSessionProvider provisioner={provisioner} retryDelayMs={5000}>
        <p>écran borne</p>
      </KioskSessionProvider>
    );

    // 1er essai échoue → dégradé non bloquant, le client continue.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByTestId("session-degraded-banner")).toBeInTheDocument();
    expect(screen.getByText("écran borne")).toBeInTheDocument();

    // Retry silencieux en arrière-plan après le délai.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(provisioner).toHaveBeenCalledTimes(2);
    expect(getKioskSessionToken()).toBe("jwt-provider");
    expect(screen.queryByTestId("session-degraded-banner")).not.toBeInTheDocument();
  });

  it("S5: session RE-CRÉÉE automatiquement à expiration (12 h, non renouvelable)", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const provisioner = vi.fn(async () => {
      calls += 1;
      return makeSession({ accessToken: `jwt-cycle-${calls}` });
    });

    renderProvider(
      <KioskSessionProvider provisioner={provisioner}>
        <p>écran borne</p>
      </KioskSessionProvider>
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(getKioskSessionToken()).toBe("jwt-cycle-1");

    // 12 h : la session expire → re-création silencieuse.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(43_200 * 1000);
    });
    expect(provisioner).toHaveBeenCalledTimes(2);
    expect(getKioskSessionToken()).toBe("jwt-cycle-2");
  });

  it("S5: sans pont Electron (navigateur/mock) → aucun crash, aucune bannière", async () => {
    renderProvider(
      <KioskSessionProvider provisioner={null}>
        <p>écran borne</p>
      </KioskSessionProvider>
    );

    expect(screen.getByText("écran borne")).toBeInTheDocument();
    expect(screen.queryByTestId("session-degraded-banner")).not.toBeInTheDocument();
    expect(getKioskSessionToken()).toBeNull();
  });
});
