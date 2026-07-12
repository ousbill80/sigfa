/**
 * Tests for MODEL-WEB-A — CRUD des opérations sous chaque service.
 *
 * Couvre : liste des opérations, création avec validation INLINE (jamais de
 * modale), code hors regex → erreur inline, SLA hérité affiché (valeur résolue),
 * désactivation, code dupliqué (409 OPERATION_CODE_DUPLICATE) → message humain,
 * RBAC (la section services n'est atteinte que par BANK_ADMIN/AGENCY_DIRECTOR,
 * jamais AGENT/AUDITOR), et PAS de champ priorité (D4).
 * @module components/admin/operations-section.test
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { OperationsSection, resolveOperationSla } from "./operations-section";
import { ServicesSection } from "./services-section";
import { AdminConsole } from "./admin-console";
import type { OperationRow, ServiceRow } from "@/lib/use-admin-console";
import type { Role } from "@/lib/roles";

const SERVICE: ServiceRow = { id: "svc-1", name: "Opérations Courantes", code: "OC", slaMinutes: 15, active: true, order: 1 };

const OPS: OperationRow[] = [
  { id: "op-1", serviceId: "svc-1", code: "DEP", name: "Dépôt espèces", slaMinutes: 8, displayOrder: 1, isActive: true, iconKey: "cash" },
  { id: "op-2", serviceId: "svc-1", code: "RET", name: "Retrait", slaMinutes: null, displayOrder: 2, isActive: true },
  { id: "op-3", serviceId: "svc-1", code: "OLD", name: "Ancienne", slaMinutes: null, displayOrder: 3, isActive: false },
];

describe("resolveOperationSla — SLA hérité (D4)", () => {
  it("MODEL-WEB-A: slaMinutes propre → utilisé ; null → hérite du service", () => {
    expect(resolveOperationSla(8, 15)).toBe(8);
    expect(resolveOperationSla(null, 15)).toBe(15);
    expect(resolveOperationSla(undefined, 15)).toBe(15);
  });
});

describe("OperationsSection — liste + SLA hérité", () => {
  it("MODEL-WEB-A: liste les opérations du service avec code, nom et statut", () => {
    render(<OperationsSection serviceId="svc-1" serviceSlaMinutes={15} operations={OPS} onCreate={vi.fn()} onDeactivate={vi.fn()} />);
    expect(screen.getByTestId("operation-row-op-1")).toHaveTextContent("Dépôt espèces");
    expect(screen.getByTestId("operation-row-op-1")).toHaveTextContent("DEP");
  });

  it("MODEL-WEB-A: opération sans SLA propre → affiche la valeur résolue + « hérite du service »", () => {
    render(<OperationsSection serviceId="svc-1" serviceSlaMinutes={15} operations={OPS} onCreate={vi.fn()} onDeactivate={vi.fn()} />);
    // op-2 hérite (slaMinutes null) → SLA résolu = 15 + mention héritée.
    const sla = screen.getByTestId("operation-sla-op-2");
    expect(sla).toHaveTextContent("15");
    expect(sla).toHaveTextContent(/hérite/i);
    // op-1 a son propre SLA → pas de mention héritée.
    const sla1 = screen.getByTestId("operation-sla-op-1");
    expect(sla1).toHaveTextContent("8");
    expect(sla1).not.toHaveTextContent(/hérite/i);
  });

  it("MODEL-WEB-A: le formulaire vide affiche l'indice « hérite du SLA du service » (valeur résolue)", () => {
    render(<OperationsSection serviceId="svc-1" serviceSlaMinutes={15} operations={[]} onCreate={vi.fn()} onDeactivate={vi.fn()} />);
    const hint = screen.getByTestId("operation-sla-inherit-hint");
    expect(hint).toHaveTextContent(/hérite/i);
    expect(hint).toHaveTextContent("15");
  });

  it("MODEL-WEB-A: état empty — aucune opération configurée", () => {
    render(<OperationsSection serviceId="svc-1" serviceSlaMinutes={15} operations={[]} onCreate={vi.fn()} onDeactivate={vi.fn()} />);
    expect(screen.getByTestId("operations-empty")).toBeInTheDocument();
  });
});

describe("OperationsSection — création + validation inline", () => {
  it("MODEL-WEB-A: code hors regex ^[A-Z0-9]{2,6}$ → erreur INLINE, jamais de modale, onCreate non appelé", async () => {
    const onCreate = vi.fn();
    const user = userEvent.setup();
    render(<OperationsSection serviceId="svc-1" serviceSlaMinutes={15} operations={[]} onCreate={onCreate} onDeactivate={vi.fn()} />);
    await user.type(screen.getByTestId("operation-name"), "Dépôt");
    await user.type(screen.getByTestId("operation-code"), "dep");
    await user.click(screen.getByTestId("operation-submit"));
    expect(screen.getByTestId("error-op-code")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("MODEL-WEB-A: opération valide sans SLA → onCreate avec slaMinutes:null (hérite)", async () => {
    const onCreate = vi.fn();
    const user = userEvent.setup();
    render(<OperationsSection serviceId="svc-1" serviceSlaMinutes={15} operations={[]} onCreate={onCreate} onDeactivate={vi.fn()} />);
    await user.type(screen.getByTestId("operation-name"), "Dépôt espèces");
    await user.type(screen.getByTestId("operation-code"), "DEP");
    await user.click(screen.getByTestId("operation-submit"));
    expect(onCreate).toHaveBeenCalledWith(
      "svc-1",
      expect.objectContaining({ code: "DEP", name: "Dépôt espèces", slaMinutes: null, displayOrder: 1 }),
    );
  });

  it("MODEL-WEB-A: SLA propre renseigné → transmis en number (pas d'héritage)", async () => {
    const onCreate = vi.fn();
    const user = userEvent.setup();
    render(<OperationsSection serviceId="svc-1" serviceSlaMinutes={15} operations={[]} onCreate={onCreate} onDeactivate={vi.fn()} />);
    await user.type(screen.getByTestId("operation-name"), "Retrait");
    await user.type(screen.getByTestId("operation-code"), "RET");
    await user.type(screen.getByTestId("operation-sla"), "5");
    await user.click(screen.getByTestId("operation-submit"));
    expect(onCreate).toHaveBeenCalledWith("svc-1", expect.objectContaining({ code: "RET", slaMinutes: 5 }));
  });

  it("MODEL-WEB-A: iconKey + ordre saisis → transmis dans le payload (displayOrder, iconKey)", async () => {
    const onCreate = vi.fn();
    const user = userEvent.setup();
    render(<OperationsSection serviceId="svc-1" serviceSlaMinutes={15} operations={[]} onCreate={onCreate} onDeactivate={vi.fn()} />);
    await user.type(screen.getByTestId("operation-name"), "Dépôt espèces");
    await user.type(screen.getByTestId("operation-code"), "DEP");
    await user.clear(screen.getByTestId("operation-order"));
    await user.type(screen.getByTestId("operation-order"), "3");
    await user.type(screen.getByTestId("operation-icon"), "cash");
    await user.click(screen.getByTestId("operation-submit"));
    expect(onCreate).toHaveBeenCalledWith("svc-1", expect.objectContaining({ displayOrder: 3, iconKey: "cash" }));
  });

  it("MODEL-WEB-A: PAS de champ priorité dans le formulaire (D4)", () => {
    render(<OperationsSection serviceId="svc-1" serviceSlaMinutes={15} operations={[]} onCreate={vi.fn()} onDeactivate={vi.fn()} />);
    expect(screen.queryByTestId("operation-priority")).not.toBeInTheDocument();
  });

  it("MODEL-WEB-A: code dupliqué (409) → message humain inline, valeurs préservées", () => {
    render(
      <OperationsSection
        serviceId="svc-1"
        serviceSlaMinutes={15}
        operations={[]}
        onCreate={vi.fn()}
        onDeactivate={vi.fn()}
        serverError="Ce code d'opération existe déjà pour ce service."
      />,
    );
    const banner = screen.getByTestId("operation-server-error");
    expect(banner).toHaveTextContent("existe déjà pour ce service");
    expect(banner.textContent).not.toContain("OPERATION_CODE_DUPLICATE");
  });
});

describe("OperationsSection — désactivation", () => {
  it("MODEL-WEB-A: opération active → bouton désactiver appelle onDeactivate(id)", async () => {
    const onDeactivate = vi.fn();
    const user = userEvent.setup();
    render(<OperationsSection serviceId="svc-1" serviceSlaMinutes={15} operations={OPS} onCreate={vi.fn()} onDeactivate={onDeactivate} />);
    await user.click(screen.getByTestId("operation-deactivate-op-1"));
    expect(onDeactivate).toHaveBeenCalledWith("op-1");
  });

  it("MODEL-WEB-A: opération déjà inactive → pas de bouton désactiver", () => {
    render(<OperationsSection serviceId="svc-1" serviceSlaMinutes={15} operations={OPS} onCreate={vi.fn()} onDeactivate={vi.fn()} />);
    expect(screen.queryByTestId("operation-deactivate-op-3")).not.toBeInTheDocument();
  });
});

describe("ServicesSection — sous-gestion par service", () => {
  it("MODEL-WEB-A: « Gérer les opérations » déplie la sous-gestion + charge les opérations", async () => {
    const onExpand = vi.fn();
    const user = userEvent.setup();
    render(
      <ServicesSection
        services={[SERVICE]}
        operationsByService={{ "svc-1": OPS }}
        onCreateService={vi.fn()}
        onCreateOperation={vi.fn()}
        onDeactivateOperation={vi.fn()}
        onExpandService={onExpand}
      />,
    );
    // Repliée par défaut.
    expect(screen.queryByTestId("operations-section-svc-1")).not.toBeInTheDocument();
    await user.click(screen.getByTestId("manage-operations-svc-1"));
    expect(onExpand).toHaveBeenCalledWith("svc-1");
    expect(screen.getByTestId("operations-section-svc-1")).toBeInTheDocument();
    expect(within(screen.getByTestId("operations-section-svc-1")).getByTestId("operation-row-op-1")).toBeInTheDocument();
  });

  it("MODEL-WEB-A: création de service toujours possible (ServiceForm réutilisé)", () => {
    render(
      <ServicesSection
        services={[]}
        operationsByService={{}}
        onCreateService={vi.fn()}
        onCreateOperation={vi.fn()}
        onDeactivateOperation={vi.fn()}
      />,
    );
    expect(screen.getByTestId("service-form")).toBeInTheDocument();
  });

  it("MODEL-WEB-A: service sans code + opérations non chargées (fallback []) + repli au 2e clic", async () => {
    const user = userEvent.setup();
    render(
      <ServicesSection
        services={[{ id: "svc-2", name: "Sans code", slaMinutes: 10, active: true, order: 1 }]}
        operationsByService={{}}
        onCreateService={vi.fn()}
        onCreateOperation={vi.fn()}
        onDeactivateOperation={vi.fn()}
      />,
    );
    // Déplie : pas d'opérations chargées → état empty (fallback []).
    await user.click(screen.getByTestId("manage-operations-svc-2"));
    expect(screen.getByTestId("operations-section-svc-2")).toBeInTheDocument();
    expect(screen.getByTestId("operations-empty")).toBeInTheDocument();
    // 2e clic → repli.
    await user.click(screen.getByTestId("manage-operations-svc-2"));
    expect(screen.queryByTestId("operations-section-svc-2")).not.toBeInTheDocument();
  });
});

describe("RBAC — la sous-gestion des opérations reste dans la section services", () => {
  it("MODEL-WEB-A: AGENT/AUDITOR → 403, aucune section (donc aucune gestion d'opérations)", () => {
    for (const role of ["AGENT", "AUDITOR"] as Role[]) {
      const { unmount } = render(<AdminConsole role={role} renderSection={() => <div data-testid="body" />} />);
      expect(screen.getByTestId("admin-forbidden")).toBeInTheDocument();
      expect(screen.queryByTestId("section-tab-services")).not.toBeInTheDocument();
      unmount();
    }
  });

  it("MODEL-WEB-A: BANK_ADMIN et AGENCY_DIRECTOR atteignent la section services", () => {
    for (const role of ["BANK_ADMIN", "AGENCY_DIRECTOR"] as Role[]) {
      const { unmount } = render(<AdminConsole role={role} renderSection={() => <div />} />);
      expect(screen.getByTestId("section-tab-services")).toBeInTheDocument();
      unmount();
    }
  });
});
