/**
 * MswProvider — tests de la GARDE d'environnement dev-only.
 *
 * Sous vitest, `process.env.NODE_ENV === "test"` (≠ "development") : la garde
 * `MSW_ENABLED` est donc fausse. On vérifie le comportement PRODUCTION-SAFE :
 *  - les enfants sont rendus IMMÉDIATEMENT (aucun blocage), et
 *  - le worker MSW n'est JAMAIS démarré (aucun import dynamique déclenché).
 *
 * Ce comportement est identique en production (NODE_ENV="production"), ce qui
 * garantit que le static export / Electron n'exécute rien de MSW.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// Espionne le module worker : s'il est importé/démarré, le mock le révèle.
const startSpy = vi.fn();
vi.mock("@/mocks/browser", () => ({
  worker: { start: startSpy },
}));

import { MswProvider } from "@/components/MswProvider";

describe("MswProvider (garde dev-only)", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("rend les enfants immédiatement hors développement (production-safe)", () => {
    render(
      <MswProvider>
        <span data-testid="child">contenu</span>
      </MswProvider>
    );
    expect(screen.getByTestId("child")).toBeInTheDocument();
    expect(screen.getByTestId("child").textContent).toBe("contenu");
  });

  it("ne démarre JAMAIS le worker MSW quand NODE_ENV n'est pas 'development'", () => {
    expect(process.env.NODE_ENV).not.toBe("development");
    render(
      <MswProvider>
        <span>x</span>
      </MswProvider>
    );
    expect(startSpy).not.toHaveBeenCalled();
  });
});
