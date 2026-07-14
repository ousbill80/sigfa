/**
 * Boucle 2 F4 — S5 : store EN MÉMOIRE de la session borne (KIOSK-001).
 * Tests TDD écrits AVANT l'implémentation (phase rouge).
 *
 * La session borne (JWT scope agency, TTL 43 200 s, non renouvelable) vit
 * exclusivement en mémoire : JAMAIS localStorage, JAMAIS Dexie (appareil
 * PARTAGÉ). À expiration, la session est RE-CRÉÉE via le provisionneur
 * enregistré ; en échec, la borne passe en mode dégradé sans crash.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  registerKioskSessionProvisioner,
  ensureKioskSession,
  getKioskSession,
  getKioskSessionToken,
  getKioskSessionBankId,
  subscribeKioskSession,
  resolveKioskSessionProvisioner,
  __resetKioskSessionForTests,
} from "@/lib/kiosk-session-store";
import type { KioskSession } from "@/lib/kiosk-session";

function makeSession(overrides: Partial<KioskSession> = {}): KioskSession {
  return {
    accessToken: "jwt-borne-memoire",
    expiresIn: 43200,
    kioskId: "14141414-1414-4141-a141-141414141414",
    agencyId: "33333333-3333-4333-a333-333333333333",
    bankId: "22222222-2222-4222-a222-222222222222",
    createdAt: Date.now(),
    ...overrides,
  };
}

beforeEach(() => {
  __resetKioskSessionForTests();
});

afterEach(() => {
  __resetKioskSessionForTests();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("KIOSK-001/S5: kiosk-session-store — session borne en mémoire", () => {
  it("S5: sans provisionneur enregistré → pas de session, pas de crash (borne dégradée)", async () => {
    const session = await ensureKioskSession();
    expect(session).toBeNull();
    expect(getKioskSession()).toBeNull();
    expect(getKioskSessionToken()).toBeNull();
  });

  it("S5: ensureKioskSession provisionne au 1er appel puis réutilise la session valide", async () => {
    const provisioner = vi.fn(async () => makeSession());
    registerKioskSessionProvisioner(provisioner);

    const first = await ensureKioskSession();
    const second = await ensureKioskSession();

    expect(provisioner).toHaveBeenCalledTimes(1);
    expect(first?.accessToken).toBe("jwt-borne-memoire");
    expect(second).toBe(first);
    expect(getKioskSessionToken()).toBe("jwt-borne-memoire");
  });

  it("S5: session RE-CRÉÉE à expiration (12 h non renouvelable — horloge Vitest)", async () => {
    vi.useFakeTimers();
    let calls = 0;
    registerKioskSessionProvisioner(async () => {
      calls += 1;
      return makeSession({ accessToken: `jwt-borne-${calls}` });
    });

    const first = await ensureKioskSession();
    expect(first?.accessToken).toBe("jwt-borne-1");

    // 12 h + 1 min : la session de 43 200 s est expirée.
    vi.advanceTimersByTime(43_260 * 1000);
    expect(getKioskSession()).toBeNull();
    expect(getKioskSessionToken()).toBeNull();

    const second = await ensureKioskSession();
    expect(calls).toBe(2);
    expect(second?.accessToken).toBe("jwt-borne-2");
  });

  it("S5: échec du provisionneur → null (dégradé, pas de crash), le prochain appel retente", async () => {
    let attempt = 0;
    registerKioskSessionProvisioner(async () => {
      attempt += 1;
      if (attempt === 1) throw new Error("réseau indisponible");
      return makeSession();
    });

    const first = await ensureKioskSession();
    expect(first).toBeNull();
    expect(getKioskSessionToken()).toBeNull();

    const second = await ensureKioskSession();
    expect(second?.accessToken).toBe("jwt-borne-memoire");
  });

  it("S5: la session ne touche JAMAIS localStorage (appareil partagé)", async () => {
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");
    registerKioskSessionProvisioner(async () => makeSession());

    await ensureKioskSession();

    expect(setItemSpy).not.toHaveBeenCalled();
  });

  it("S5: resolveKioskSessionProvisioner → null sans pont Electron (navigateur nu)", () => {
    expect(window.kioskAuth).toBeUndefined();
    expect(resolveKioskSessionProvisioner()).toBeNull();
  });

  it("S5: resolveKioskSessionProvisioner utilise le pont Electron (preload contextBridge)", async () => {
    const createSession = vi.fn(async () => ({
      accessToken: "jwt-via-ipc",
      expiresIn: 43200,
      kioskId: "k1",
      agencyId: "a1",
      bankId: "22222222-2222-4222-a222-222222222222",
    }));
    window.kioskAuth = { createSession };

    try {
      const provisioner = resolveKioskSessionProvisioner();
      expect(provisioner).not.toBeNull();
      const session = await provisioner!();
      expect(createSession).toHaveBeenCalledTimes(1);
      expect(session?.accessToken).toBe("jwt-via-ipc");
      expect(session?.createdAt).toBeTypeOf("number");
      // CONTRACT-014 : le bankId du DTO IPC transite dans la session mémoire.
      expect(session?.bankId).toBe("22222222-2222-4222-a222-222222222222");
    } finally {
      delete window.kioskAuth;
    }
  });

  // ── CONTRACT-014 : bankId de la session (theming borne) ────────────────────

  it("CONTRACT-014: getKioskSessionBankId → bankId de la session valide, null sans session", async () => {
    expect(getKioskSessionBankId()).toBeNull();

    registerKioskSessionProvisioner(async () => makeSession());
    await ensureKioskSession();

    expect(getKioskSessionBankId()).toBe("22222222-2222-4222-a222-222222222222");
  });

  it("CONTRACT-014: getKioskSessionBankId → null quand la session est expirée (jamais de bankId périmé)", async () => {
    vi.useFakeTimers();
    registerKioskSessionProvisioner(async () => makeSession());
    await ensureKioskSession();
    expect(getKioskSessionBankId()).toBe("22222222-2222-4222-a222-222222222222");

    vi.advanceTimersByTime(43_260 * 1000);
    expect(getKioskSessionBankId()).toBeNull();
  });

  it("CONTRACT-014: subscribeKioskSession notifie à la création de session (theming réactif)", async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeKioskSession(listener);

    registerKioskSessionProvisioner(async () => makeSession());
    await ensureKioskSession();
    expect(listener).toHaveBeenCalled();

    // Désabonnement : plus aucune notification.
    listener.mockClear();
    unsubscribe();
    __resetKioskSessionForTests();
    registerKioskSessionProvisioner(async () => makeSession());
    await ensureKioskSession();
    expect(listener).not.toHaveBeenCalled();
  });
});
