/**
 * AUDIT-F24 — Tests TDD pour ServicesPageClient + fixture démo « affluence ».
 * La bannière file longue (KIOSK-007, seuil 30 min) doit être VÉRIFIABLE en
 * démo : la fixture MSW `DEMO_AFFLUENCE_SERVICES` (src/mocks/handlers.ts)
 * s'active via `/{locale}/services?demo=affluence` en mode démo MSW.
 * Écrits AVANT l'implémentation (phase rouge).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// ─── Mock next/navigation (searchParams contrôlés par test) ────────────────
let mockSearch = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useParams: () => ({ locale: "fr" }),
  useSearchParams: () => mockSearch,
}));

// ─── Capture des props passées à l'écran (l'écran lui-même a ses tests) ────
const capturedProps: { services?: ServiceItem[]; agencyId?: string }[] = [];
vi.mock("@/components/ServicesScreen", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/components/ServicesScreen")>();
  return {
    ...actual,
    ServicesScreen: (props: { services: ServiceItem[]; agencyId: string }) => {
      capturedProps.push(props);
      return <div data-testid="services-screen-stub" />;
    },
  };
});

import type { ServiceItem } from "@/components/ServicesScreen";
import { ServicesPageClient } from "@/app/[locale]/services/ServicesPageClient";
import { DEMO_AFFLUENCE_SERVICES } from "@/mocks/handlers";
import { DEFAULT_LONG_QUEUE_THRESHOLD_MIN } from "@/hooks/useDegradedState";

describe("AUDIT-F24: fixture démo affluence (bannière file longue vérifiable)", () => {
  beforeEach(() => {
    capturedProps.length = 0;
    mockSearch = new URLSearchParams();
    vi.stubEnv("NEXT_PUBLIC_ENABLE_MSW", "1");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("AUDIT-F24: la fixture contient un service ouvert avec attente ≥ 30 min (seuil KIOSK-007)", () => {
    const longest = Math.max(
      ...DEMO_AFFLUENCE_SERVICES.filter((s) => s.isOpen).map(
        (s) => s.estimatedMinutes
      )
    );
    expect(longest).toBeGreaterThanOrEqual(DEFAULT_LONG_QUEUE_THRESHOLD_MIN);
  });

  it("AUDIT-F24: sans paramètre demo → services nominaux, AUCUNE attente ≥ 30 min (bannière absente en nominal)", async () => {
    render(<ServicesPageClient />);
    await waitFor(() => expect(capturedProps.length).toBeGreaterThan(0));

    const last = capturedProps[capturedProps.length - 1];
    expect(last.services?.length).toBeGreaterThan(0);
    const longest = Math.max(
      ...(last.services ?? []).map((s) => s.estimatedMinutes)
    );
    expect(longest).toBeLessThan(DEFAULT_LONG_QUEUE_THRESHOLD_MIN);
  });

  it("AUDIT-F24: ?demo=affluence (mode démo MSW) → la fixture affluence alimente l'écran", async () => {
    mockSearch = new URLSearchParams("demo=affluence");
    render(<ServicesPageClient />);

    await waitFor(() => {
      const last = capturedProps[capturedProps.length - 1];
      expect(last?.services).toEqual(DEMO_AFFLUENCE_SERVICES);
    });
  });

  it("AUDIT-F24: ?demo=affluence HORS mode démo MSW → services nominaux (fixture jamais active en réel)", async () => {
    vi.stubEnv("NEXT_PUBLIC_ENABLE_MSW", "");
    mockSearch = new URLSearchParams("demo=affluence");
    render(<ServicesPageClient />);
    await waitFor(() => expect(capturedProps.length).toBeGreaterThan(0));

    // Laisse passer un éventuel chargement async : la fixture ne doit PAS arriver.
    await new Promise((r) => setTimeout(r, 50));
    const last = capturedProps[capturedProps.length - 1];
    const longest = Math.max(
      ...(last.services ?? []).map((s) => s.estimatedMinutes)
    );
    expect(longest).toBeLessThan(DEFAULT_LONG_QUEUE_THRESHOLD_MIN);
  });
});
