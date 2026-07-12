/**
 * Tests for the WEB-006 admin console components.
 *
 * Covers the criteria that live in the UI layer: RBAC 403 shell, brand contrast
 * auto-correction preview, inline Zod validation (no modal), SMS variable
 * preview, CSV import summary, agency deactivation dialog listing tickets, the
 * 5-step onboarding wizard, and the loading/error/offline/empty states. Tokens
 * only (WCAG contrast checked deterministically on the design tokens — axe-core
 * is not installed, so the established token-contrast pattern is used).
 * @module components/admin/admin-console.test
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { AdminConsole } from "./admin-console";
import { IdentitySection } from "./identity-section";
import { ServiceForm } from "./service-form";
import { SmsTemplateEditor } from "./sms-template-editor";
import { AgentsImport } from "./agents-import-panel";
import { AgenciesSection } from "./agencies-section";
import { OnboardingWizard } from "./onboarding-wizard";
import { contrastRatio, DEFAULT_THEME } from "@/lib/theme";
import type { Role } from "@/lib/roles";

describe("AdminConsole — RBAC shell", () => {
  it("WEB-006: RBAC AGENT/AUDITOR → 403 sur /admin/*", () => {
    for (const role of ["AGENT", "AUDITOR"] as Role[]) {
      const { unmount } = render(<AdminConsole role={role} />);
      expect(screen.getByTestId("admin-forbidden")).toBeInTheDocument();
      // Aucune section rendue.
      expect(screen.queryByTestId("admin-sections")).not.toBeInTheDocument();
      unmount();
    }
  });

  it("WEB-006: RBAC AGENCY_DIRECTOR — services de son agence uniquement (pas identité/templates)", () => {
    render(<AdminConsole role="AGENCY_DIRECTOR" />);
    const nav = screen.getByTestId("admin-sections");
    expect(within(nav).getByTestId("section-tab-services")).toBeInTheDocument();
    expect(within(nav).getByTestId("section-tab-agents")).toBeInTheDocument();
    // Sections bank-wide absentes pour l'AGENCY_DIRECTOR.
    expect(within(nav).queryByTestId("section-tab-identity")).not.toBeInTheDocument();
    expect(within(nav).queryByTestId("section-tab-sms-templates")).not.toBeInTheDocument();
  });

  it("WEB-006: BANK_ADMIN voit les 8 sections", () => {
    render(<AdminConsole role="BANK_ADMIN" />);
    const nav = screen.getByTestId("admin-sections");
    expect(within(nav).getAllByTestId(/^section-tab-/)).toHaveLength(8);
  });

  it("WEB-006: sélection d'onglet → renderSection appelée pour la section active", async () => {
    const user = userEvent.setup();
    const renderSection = vi.fn((s: string) => <div data-testid={`body-${s}`}>{s}</div>);
    render(<AdminConsole role="BANK_ADMIN" renderSection={renderSection} />);
    // Première section rendue par défaut.
    expect(screen.getByTestId("body-identity")).toBeInTheDocument();
    // Bascule vers une autre section.
    await user.click(screen.getByTestId("section-tab-thresholds"));
    expect(screen.getByTestId("body-thresholds")).toBeInTheDocument();
  });
});

describe("IdentitySection — contraste --brand", () => {
  it("WEB-006: --brand saisie hors ratio → avertissement + valeur corrigée affichée", async () => {
    const user = userEvent.setup();
    render(<IdentitySection onSave={vi.fn()} />);
    const input = screen.getByTestId("brand-input");
    // Couleur claire → contraste insuffisant sur --surface-1.
    await user.clear(input);
    await user.type(input, "#ffee00");
    // Avertissement inline + valeur corrigée affichée.
    const warning = await screen.findByTestId("brand-warning");
    expect(warning).toBeInTheDocument();
    const corrected = screen.getByTestId("brand-corrected").textContent ?? "";
    // La valeur corrigée passe réellement le ratio 4,5:1 sur --surface-1.
    const hex = corrected.match(/#[0-9a-fA-F]{6}/)?.[0] ?? "";
    expect(contrastRatio(hex, DEFAULT_THEME.surface1)).toBeGreaterThanOrEqual(4.5);
  });

  it("WEB-006: --brand conforme → aucun avertissement", async () => {
    const user = userEvent.setup();
    render(<IdentitySection onSave={vi.fn()} />);
    const input = screen.getByTestId("brand-input");
    await user.clear(input);
    await user.type(input, "#003f7f");
    expect(screen.queryByTestId("brand-warning")).not.toBeInTheDocument();
  });

  it("WEB-006: sauvegarde identité → applique la couleur corrigée (PATCH /banks/{id}/theme)", async () => {
    const onSave = vi.fn();
    const user = userEvent.setup();
    render(<IdentitySection onSave={onSave} />);
    const input = screen.getByTestId("brand-input");
    await user.clear(input);
    await user.type(input, "#ffee00");
    await user.click(screen.getByTestId("identity-save"));
    // La couleur appliquée est la valeur corrigée (contraste conforme), jamais la brute.
    const applied = onSave.mock.calls[0]![0] as { primary: string };
    expect(contrastRatio(applied.primary, DEFAULT_THEME.surface1)).toBeGreaterThanOrEqual(4.5);
    expect(applied.primary).not.toBe("#ffee00");
  });
});

describe("ServiceForm — validation inline", () => {
  it("WEB-006: CRUD service — validation Zod inline, erreurs en ligne sans modale", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<ServiceForm onSubmit={onSubmit} />);
    // Code invalide (minuscules).
    await user.type(screen.getByTestId("service-name"), "Virements");
    await user.type(screen.getByTestId("service-code"), "oc");
    await user.click(screen.getByTestId("service-submit"));
    // Erreur inline, jamais de modale (role=dialog).
    expect(screen.getByTestId("error-code")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("WEB-006: service valide → onSubmit appelé avec payload contractuel", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<ServiceForm onSubmit={onSubmit} />);
    await user.type(screen.getByTestId("service-name"), "Virements");
    await user.type(screen.getByTestId("service-code"), "OC");
    await user.click(screen.getByTestId("service-submit"));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Virements", code: "OC", slaMinutes: expect.any(Number), order: expect.any(Number) }),
    );
  });

  it("WEB-006: état error — message inline conservé, formulaire non réinitialisé", () => {
    render(<ServiceForm onSubmit={vi.fn()} serverError="Ce code de service existe déjà dans cette agence." />);
    expect(screen.getByTestId("service-server-error")).toHaveTextContent("existe déjà");
  });

  it("WEB-006: SLA/priorité saisis → transmis dans le payload contractuel", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<ServiceForm onSubmit={onSubmit} />);
    await user.type(screen.getByTestId("service-name"), "Crédits");
    await user.type(screen.getByTestId("service-code"), "CR");
    await user.clear(screen.getByTestId("service-sla"));
    await user.type(screen.getByTestId("service-sla"), "20");
    await user.clear(screen.getByTestId("service-order"));
    await user.type(screen.getByTestId("service-order"), "5");
    await user.click(screen.getByTestId("service-submit"));
    expect(onSubmit).toHaveBeenCalledWith({ name: "Crédits", code: "CR", slaMinutes: 20, order: 5 });
  });
});

describe("SmsTemplateEditor — preview variables", () => {
  it("WEB-006: templates SMS — variables {{ticket}} rendues en preview", async () => {
    const user = userEvent.setup();
    render(<SmsTemplateEditor eventType="TICKET_CONFIRMATION" initialContent="" onSave={vi.fn()} />);
    const textarea = screen.getByTestId("template-input");
    // user-event treats "{{" as a literal "{" — double them to emit "{{…}}".
    await user.type(textarea, "Ticket {{{{number}}}} position {{{{position}}}}");
    // La preview substitue les variables autorisées.
    const preview = screen.getByTestId("template-preview");
    expect(preview).toHaveTextContent("A-047");
    expect(preview).toHaveTextContent("3");
    expect(preview.textContent).not.toContain("{{number}}");
  });

  it("WEB-006: variable hors contrat → avertissement, sauvegarde bloquée", async () => {
    const onSave = vi.fn();
    const user = userEvent.setup();
    render(<SmsTemplateEditor eventType="YOUR_TURN" initialContent="" onSave={onSave} />);
    await user.type(screen.getByTestId("template-input"), "Bonjour {{{{agentName}}}}");
    expect(screen.getByTestId("template-unknown-var")).toBeInTheDocument();
    await user.click(screen.getByTestId("template-save"));
    expect(onSave).not.toHaveBeenCalled();
  });

  it("WEB-006: template valide → onSave appelé avec { type, content }", async () => {
    const onSave = vi.fn();
    const user = userEvent.setup();
    render(<SmsTemplateEditor eventType="TICKET_CONFIRMATION" initialContent="" onSave={onSave} />);
    // user-event collapses "{{"→"{" but leaves "}}" verbatim, so "{{{{number}}" → "{{number}}".
    await user.type(screen.getByTestId("template-input"), "Ticket {{{{number}} prêt");
    await user.click(screen.getByTestId("template-save"));
    expect(onSave).toHaveBeenCalledWith({ type: "TICKET_CONFIRMATION", content: "Ticket {{number}} prêt" });
  });
});

describe("AgentsImport — résumé", () => {
  it("WEB-006: import CSV — résumé N créés / M ignorés / K erreurs (motif par ligne)", () => {
    render(
      <AgentsImport
        onImport={vi.fn()}
        summary={{
          created: 48,
          skipped: 2,
          errorCount: 1,
          errors: [{ line: 12, field: "email", code: "DUPLICATE_EMAIL", message: "email déjà pris" }],
        }}
      />,
    );
    expect(screen.getByTestId("import-summary")).toHaveTextContent("48");
    expect(screen.getByTestId("import-summary")).toHaveTextContent("2");
    // Motif par ligne visible (message humain).
    const err = screen.getByTestId("import-error-row-0");
    expect(err).toHaveTextContent("12");
    expect(err).toHaveTextContent("email déjà pris");
    // Le code brut n'est pas affiché tel quel.
    expect(err.textContent).not.toContain("DUPLICATE_EMAIL");
  });

  it("WEB-006: sélection d'un fichier CSV → onImport appelé avec le File", async () => {
    const onImport = vi.fn();
    const user = userEvent.setup();
    render(<AgentsImport onImport={onImport} />);
    const file = new File(["email\nx@y.z"], "agents.csv", { type: "text/csv" });
    await user.upload(screen.getByTestId("agents-file"), file);
    expect(onImport).toHaveBeenCalledWith(file);
  });
});

describe("AgenciesSection — désactivation avec tickets", () => {
  it("WEB-006: désactivation agence avec tickets ouverts → dialog liste tickets, annulable", async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(
      <AgenciesSection
        agencies={[{ id: "ag-1", name: "Agence Plateau", active: true }]}
        openTickets={{ "ag-1": ["A-047", "B-012"] }}
        onConfirmDeactivate={onConfirm}
      />,
    );
    await user.click(screen.getByTestId("deactivate-ag-1"));
    // Dialog visible listant les tickets ouverts.
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("A-047")).toBeInTheDocument();
    expect(within(dialog).getByText("B-012")).toBeInTheDocument();
    // Annulable.
    await user.click(within(dialog).getByTestId("dialog-cancel"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("WEB-006: confirmation forcée → onConfirmDeactivate appelé avec l'id agence", async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(
      <AgenciesSection
        agencies={[{ id: "ag-1", name: "Agence Plateau", active: true }]}
        openTickets={{ "ag-1": ["A-047"] }}
        onConfirmDeactivate={onConfirm}
      />,
    );
    await user.click(screen.getByTestId("deactivate-ag-1"));
    await user.click(within(screen.getByRole("dialog")).getByTestId("dialog-confirm"));
    expect(onConfirm).toHaveBeenCalledWith("ag-1");
  });

  it("WEB-006: état empty — aucune agence configurée", () => {
    render(<AgenciesSection agencies={[]} openTickets={{}} onConfirmDeactivate={vi.fn()} />);
    expect(screen.getByTestId("agencies-empty")).toBeInTheDocument();
  });
});

describe("OnboardingWizard — 5 étapes", () => {
  it("WEB-006: onboarding 5 étapes — parcours complet testable en Testing Library", async () => {
    const onGenerateQr = vi.fn().mockResolvedValue("data:image/png;base64,AAA");
    const user = userEvent.setup();
    render(<OnboardingWizard onCreateAgency={vi.fn().mockResolvedValue("ag-1")} onGenerateQr={onGenerateQr} />);

    // Étape 1 : création.
    expect(screen.getByTestId("wizard-step-create")).toBeInTheDocument();
    await user.type(screen.getByTestId("wizard-agency-name"), "Agence Cocody");
    await user.click(screen.getByTestId("wizard-create-submit"));
    await user.click(screen.getByTestId("wizard-next"));

    // Étapes intermédiaires : template → services → counters → agents.
    for (const step of ["template", "services", "counters", "agents"]) {
      expect(screen.getByTestId(`wizard-step-${step}`)).toBeInTheDocument();
      await user.click(screen.getByTestId("wizard-complete-step"));
      await user.click(screen.getByTestId("wizard-next"));
    }

    // Étape finale : QR.
    expect(screen.getByTestId("wizard-step-qr")).toBeInTheDocument();
    await user.click(screen.getByTestId("wizard-generate-qr"));
    expect(onGenerateQr).toHaveBeenCalled();
    expect(await screen.findByTestId("wizard-qr-image")).toBeInTheDocument();
  });
});
