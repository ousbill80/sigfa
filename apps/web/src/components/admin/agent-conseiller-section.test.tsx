/**
 * Tests for MODEL-WEB-B — marquer un agent comme conseiller (D5).
 *
 * Couvre : chargement d'un agent (GET /agents/{id}), toggle conseiller
 * (isRelationshipManager), displayName REQUIS quand conseiller activé (message
 * humain, validation INLINE jamais de modale), photoUrl optionnel (URL valide),
 * enregistrement via PATCH /agents/{id} avec le bon body, mention borne visible,
 * et RBAC : la section « agents » n'est atteinte que par AGENCY_DIRECTOR /
 * BANK_ADMIN, jamais AGENT/AUDITOR (cohérent WEB-006).
 * @module components/admin/agent-conseiller-section.test
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { AgentConseillerSection } from "./agent-conseiller-section";
import { AdminConsole } from "./admin-console";
import { validateConseiller } from "@/lib/admin-validation";
import { visibleSections } from "@/lib/admin-rbac";
import type { AgentProfileRow } from "@/lib/use-admin-console";
import type { Role } from "@/lib/roles";

const AGENT: AgentProfileRow = {
  id: "55555555-5555-4555-a555-555555555555",
  firstName: "Kofi",
  lastName: "Asante",
  isRelationshipManager: false,
};

function okLoad(agent: AgentProfileRow = AGENT): () => Promise<{ ok: boolean; agent: AgentProfileRow }> {
  return vi.fn(async () => ({ ok: true, agent }));
}

describe("validateConseiller — displayName requis si conseiller (D5)", () => {
  it("MODEL-WEB-B: conseiller activé + displayName vide → erreur inline (message humain)", () => {
    const errors = validateConseiller({ isRelationshipManager: true, displayName: "  ", photoUrl: "" });
    expect(errors.displayName).toMatch(/nom public/i);
  });

  it("MODEL-WEB-B: conseiller activé + displayName rempli → pas d'erreur", () => {
    const errors = validateConseiller({ isRelationshipManager: true, displayName: "Kofi A.", photoUrl: "" });
    expect(errors.displayName).toBeUndefined();
  });

  it("MODEL-WEB-B: non conseiller + displayName vide → pas d'erreur (rien à valider)", () => {
    const errors = validateConseiller({ isRelationshipManager: false, displayName: "", photoUrl: "" });
    expect(Object.keys(errors)).toHaveLength(0);
  });

  it("MODEL-WEB-B: photoUrl non-URL → erreur ; URL http(s) valide → OK ; vide → OK", () => {
    expect(validateConseiller({ isRelationshipManager: true, displayName: "X", photoUrl: "not-a-url" }).photoUrl).toBeDefined();
    expect(validateConseiller({ isRelationshipManager: true, displayName: "X", photoUrl: "https://cdn/x.png" }).photoUrl).toBeUndefined();
    expect(validateConseiller({ isRelationshipManager: true, displayName: "X", photoUrl: "" }).photoUrl).toBeUndefined();
  });
});

describe("AgentConseillerSection — chargement + toggle", () => {
  it("MODEL-WEB-B: charge un agent (GET /agents/{id}) puis affiche le formulaire", async () => {
    const user = userEvent.setup();
    const onLoadAgent = okLoad();
    render(<AgentConseillerSection onLoadAgent={onLoadAgent} onSave={vi.fn()} />);

    await user.type(screen.getByTestId("conseiller-agent-id"), AGENT.id);
    await user.click(screen.getByTestId("conseiller-load"));

    expect(onLoadAgent).toHaveBeenCalledWith(AGENT.id);
    await waitFor(() => expect(screen.getByTestId("conseiller-form")).toBeInTheDocument());
    expect(screen.getByTestId("conseiller-toggle")).not.toBeChecked();
  });

  it("MODEL-WEB-B: la mention « apparaît sur la borne » est visible", async () => {
    const user = userEvent.setup();
    render(<AgentConseillerSection onLoadAgent={okLoad()} onSave={vi.fn()} />);
    await user.type(screen.getByTestId("conseiller-agent-id"), AGENT.id);
    await user.click(screen.getByTestId("conseiller-load"));
    await waitFor(() => expect(screen.getByTestId("conseiller-kiosk-notice")).toBeInTheDocument());
    expect(screen.getByTestId("conseiller-kiosk-notice")).toHaveTextContent(/borne/i);
  });

  it("MODEL-WEB-B: le displayName n'apparaît qu'une fois le toggle activé", async () => {
    const user = userEvent.setup();
    render(<AgentConseillerSection onLoadAgent={okLoad()} onSave={vi.fn()} />);
    await user.type(screen.getByTestId("conseiller-agent-id"), AGENT.id);
    await user.click(screen.getByTestId("conseiller-load"));
    await waitFor(() => screen.getByTestId("conseiller-form"));

    expect(screen.queryByTestId("conseiller-display-name")).not.toBeInTheDocument();
    await user.click(screen.getByTestId("conseiller-toggle"));
    expect(screen.getByTestId("conseiller-display-name")).toBeInTheDocument();
  });
});

describe("AgentConseillerSection — validation inline + PATCH", () => {
  it("MODEL-WEB-B: conseiller activé sans displayName → erreur INLINE, onSave non appelé", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<AgentConseillerSection onLoadAgent={okLoad()} onSave={onSave} />);
    await user.type(screen.getByTestId("conseiller-agent-id"), AGENT.id);
    await user.click(screen.getByTestId("conseiller-load"));
    await waitFor(() => screen.getByTestId("conseiller-form"));

    await user.click(screen.getByTestId("conseiller-toggle"));
    await user.click(screen.getByTestId("conseiller-submit"));

    expect(screen.getByTestId("error-conseiller-display-name")).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
    // Jamais de modale.
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("MODEL-WEB-B: marquer conseiller → PATCH /agents/{id} avec isRelationshipManager + displayName + photoUrl", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn(async () => ({ ok: true }));
    render(<AgentConseillerSection onLoadAgent={okLoad()} onSave={onSave} />);
    await user.type(screen.getByTestId("conseiller-agent-id"), AGENT.id);
    await user.click(screen.getByTestId("conseiller-load"));
    await waitFor(() => screen.getByTestId("conseiller-form"));

    await user.click(screen.getByTestId("conseiller-toggle"));
    await user.type(screen.getByTestId("conseiller-display-name"), "Kofi A.");
    await user.type(screen.getByTestId("conseiller-photo-url"), "https://cdn.example/kofi.png");
    await user.click(screen.getByTestId("conseiller-submit"));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave).toHaveBeenCalledWith(AGENT.id, {
      isRelationshipManager: true,
      displayName: "Kofi A.",
      photoUrl: "https://cdn.example/kofi.png",
    });
    await waitFor(() => expect(screen.getByTestId("conseiller-saved")).toBeInTheDocument());
  });

  it("MODEL-WEB-B: démarquer un conseiller existant → PATCH isRelationshipManager:false", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn(async () => ({ ok: true }));
    render(
      <AgentConseillerSection
        onLoadAgent={okLoad({ ...AGENT, isRelationshipManager: true, displayName: "Kofi A." })}
        onSave={onSave}
      />,
    );
    await user.type(screen.getByTestId("conseiller-agent-id"), AGENT.id);
    await user.click(screen.getByTestId("conseiller-load"));
    await waitFor(() => screen.getByTestId("conseiller-form"));

    expect(screen.getByTestId("conseiller-toggle")).toBeChecked();
    await user.click(screen.getByTestId("conseiller-toggle"));
    await user.click(screen.getByTestId("conseiller-submit"));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith(AGENT.id, { isRelationshipManager: false }));
  });

  it("MODEL-WEB-B: conseiller sans photo → PATCH photoUrl:null (agent sans nom → id affiché)", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn(async () => ({ ok: true }));
    const noName: AgentProfileRow = { id: "id-only", isRelationshipManager: false };
    render(<AgentConseillerSection onLoadAgent={okLoad(noName)} onSave={onSave} locale="en" />);
    await user.type(screen.getByTestId("conseiller-agent-id"), "id-only");
    await user.click(screen.getByTestId("conseiller-load"));
    await waitFor(() => screen.getByTestId("conseiller-form"));
    // No first/last name → the id is shown as the heading.
    expect(screen.getByTestId("conseiller-form")).toHaveTextContent("id-only");

    await user.click(screen.getByTestId("conseiller-toggle"));
    await user.type(screen.getByTestId("conseiller-display-name"), "Anon A.");
    await user.click(screen.getByTestId("conseiller-submit"));

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith("id-only", {
        isRelationshipManager: true,
        displayName: "Anon A.",
        photoUrl: null,
      }),
    );
  });

  it("MODEL-WEB-B: erreur serveur au PATCH → message humain affiché dans le formulaire", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn(async () => ({ ok: false, message: "Sauvegarde impossible." }));
    render(<AgentConseillerSection onLoadAgent={okLoad()} onSave={onSave} />);
    await user.type(screen.getByTestId("conseiller-agent-id"), AGENT.id);
    await user.click(screen.getByTestId("conseiller-load"));
    await waitFor(() => screen.getByTestId("conseiller-form"));
    await user.click(screen.getByTestId("conseiller-submit"));

    await waitFor(() => expect(screen.getByTestId("conseiller-server-error")).toHaveTextContent("Sauvegarde impossible."));
    // Le formulaire reste affiché (édition possible).
    expect(screen.getByTestId("conseiller-form")).toBeInTheDocument();
  });

  it("MODEL-WEB-B: erreur serveur au chargement → message humain, pas de formulaire", async () => {
    const user = userEvent.setup();
    const onLoadAgent = vi.fn(async () => ({ ok: false, message: "Agent introuvable." }));
    render(<AgentConseillerSection onLoadAgent={onLoadAgent} onSave={vi.fn()} />);
    await user.type(screen.getByTestId("conseiller-agent-id"), "unknown");
    await user.click(screen.getByTestId("conseiller-load"));

    await waitFor(() => expect(screen.getByTestId("conseiller-server-error")).toHaveTextContent("Agent introuvable."));
    expect(screen.queryByTestId("conseiller-form")).not.toBeInTheDocument();
  });
});

describe("AgentConseillerSection — RBAC (cohérent WEB-006)", () => {
  it("MODEL-WEB-B: la section « agents » est atteinte par AGENCY_DIRECTOR et BANK_ADMIN", () => {
    expect(visibleSections("AGENCY_DIRECTOR")).toContain("agents");
    expect(visibleSections("BANK_ADMIN")).toContain("agents");
  });

  it("MODEL-WEB-B: AGENT et AUDITOR n'atteignent AUCUNE section (403, pas d'accès conseiller)", () => {
    (["AGENT", "AUDITOR"] as Role[]).forEach((role) => {
      expect(visibleSections(role)).toHaveLength(0);
      render(<AdminConsole role={role} />);
      expect(screen.getByTestId("admin-forbidden")).toBeInTheDocument();
      cleanup();
    });
  });
});
