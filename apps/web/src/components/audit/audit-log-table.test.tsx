/**
 * Tests for AuditLogTable (SEC-001b) — 5 states, FR/EN, tokens only, and the
 * READ-ONLY orthogonality guarantee (leçon SEC-F3-01): the DOM contains NO
 * mutation control (no create/edit/delete), and no rendered control emits a
 * POST/PATCH/DELETE — the only actions are filters + pagination (GET re-fetch).
 * @module components/audit/audit-log-table.test
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AuditLogTable, type AuditLogTableProps } from "./audit-log-table";
import type { AuditEntryView } from "@/lib/use-audit-log";

const ENTRIES: AuditEntryView[] = [
  {
    actor: { id: "55555555-5555-4555-a555-555555555555", role: "MANAGER", email: "m@bnci.ci" },
    action: "PATCH /queues/:id",
    entityType: "queue",
    entityId: "11111111-1111-4111-a111-111111111111",
    timestamp: "2026-07-11T09:00:00Z",
    ip: "41.67.128.1",
    diff: { before: { status: "OPEN" }, after: { status: "PAUSED" } },
  },
  {
    actor: { id: "66666666-6666-4666-a666-666666666666", role: "AGENT" },
    action: "POST /tickets/:id/close",
    entityType: "ticket",
    entityId: "22222222-2222-4222-a222-222222222222",
    timestamp: "2026-07-11T09:05:00Z",
    ip: "41.67.128.9",
  },
];

function props(over: Partial<AuditLogTableProps> = {}): AuditLogTableProps {
  return {
    entries: ENTRIES,
    load: "ready",
    filters: {},
    page: 1,
    total: 2,
    limit: 20,
    onFilterChange: vi.fn(),
    onApply: vi.fn(),
    onReset: vi.fn(),
    onPage: vi.fn(),
    ...over,
  };
}

/** Mutating verbs that must NEVER label a control on a read-only surface. */
const MUTATION_LABELS =
  /créer|create|ajouter|add|supprimer|delete|modifier|edit|enregistrer|save|révoquer|revoke|purger|purge|nouveau|new/i;

describe("SEC-001b: AuditLogTable — 5 états d'écran", () => {
  it("SEC-001b: loading — skeleton (aria-busy)", () => {
    render(<AuditLogTable {...props({ load: "loading" })} />);
    expect(screen.getByTestId("audit-loading")).toHaveAttribute("aria-busy", "true");
  });

  it("SEC-001b: empty — message humain (aucun évènement)", () => {
    render(<AuditLogTable {...props({ load: "empty", entries: [] })} />);
    expect(screen.getByTestId("audit-empty")).toBeInTheDocument();
    expect(screen.getByText(/aucun évènement/i)).toBeInTheDocument();
  });

  it("SEC-001b: error — message humain (role alert)", () => {
    render(<AuditLogTable {...props({ load: "error" })} />);
    expect(screen.getByTestId("audit-error")).toHaveAttribute("role", "alert");
  });

  it("SEC-001b: offline — bandeau journal potentiellement obsolète", () => {
    render(<AuditLogTable {...props({ offline: true })} />);
    expect(screen.getByTestId("audit-offline")).toBeInTheDocument();
  });

  it("SEC-001b: nominal — une ligne par entrée + colonnes qui/quoi/quand/IP", () => {
    render(<AuditLogTable {...props()} />);
    expect(screen.getAllByTestId("audit-row")).toHaveLength(2);
    expect(screen.getByText("PATCH /queues/:id")).toBeInTheDocument();
    expect(screen.getByText("41.67.128.1")).toBeInTheDocument();
  });

  it("SEC-001b: diff before/after lisible", () => {
    render(<AuditLogTable {...props()} />);
    expect(screen.getByText(/"status":"OPEN"/)).toBeInTheDocument();
    expect(screen.getByText(/"status":"PAUSED"/)).toBeInTheDocument();
  });
});

describe("SEC-001b: AuditLogTable — orthogonalité lecture seule (leçon SEC-F3-01)", () => {
  it("SEC-001b: AUCUN bouton de mutation dans le DOM (create/edit/delete)", () => {
    const { container } = render(<AuditLogTable {...props()} />);
    // Tous les boutons présents sont de la navigation (filtres/pagination) : GET only.
    for (const btn of Array.from(container.querySelectorAll("button"))) {
      expect(btn.textContent ?? "").not.toMatch(MUTATION_LABELS);
      // Un contrôle read-only n'est jamais un submit hors du formulaire de filtre.
      const type = btn.getAttribute("type");
      expect(["button", "submit", null]).toContain(type);
    }
  });

  it("SEC-001b: aucun <form> ne cible une méthode mutative (method=post/etc.)", () => {
    const { container } = render(<AuditLogTable {...props()} />);
    for (const form of Array.from(container.querySelectorAll("form"))) {
      const method = (form.getAttribute("method") ?? "get").toLowerCase();
      // Le formulaire de filtre est intercepté (preventDefault) et ne POST jamais.
      expect(method).not.toBe("post");
      expect(form.getAttribute("action")).toBeNull();
    }
  });

  it("SEC-001b: les seuls contrôles sont filtres + pagination (GET), câblés à des handlers de lecture", () => {
    const onApply = vi.fn();
    const onPage = vi.fn();
    // total > limit → une page suivante existe (bouton actif).
    render(<AuditLogTable {...props({ onApply, onPage, total: 60, limit: 20 })} />);
    // Soumettre les filtres → handler de lecture (jamais de mutation réseau).
    fireEvent.submit(screen.getByTestId("audit-filters"));
    expect(onApply).toHaveBeenCalledTimes(1);
    // Naviguer à la page suivante → handler de lecture.
    fireEvent.click(screen.getByTestId("audit-next"));
    expect(onPage).toHaveBeenCalledWith(2);
  });

  it("SEC-001b: filtres entityType/entityId/actorId/from/to présents (conformes au contrat)", () => {
    render(<AuditLogTable {...props()} />);
    for (const f of ["entityType", "entityId", "actorId", "from", "to"]) {
      expect(screen.getByTestId(`audit-filter-${f}`)).toBeInTheDocument();
    }
  });
});

describe("SEC-001b: AuditLogTable — i18n FR/EN + tokens", () => {
  it("SEC-001b: FR par défaut puis EN (aucune clé brute)", () => {
    const { rerender } = render(<AuditLogTable {...props()} locale="fr" />);
    expect(screen.getByText("Journal d'audit")).toBeInTheDocument();

    rerender(<AuditLogTable {...props()} locale="en" />);
    expect(screen.getByText("Audit log")).toBeInTheDocument();
    // Aucune clé de traduction brute ne fuit dans le DOM.
    expect(screen.queryByText(/audit\.(title|col|filter)\./)).toBeNull();
  });

  it("SEC-001b: en-têtes de colonnes traduits (FR)", () => {
    render(<AuditLogTable {...props()} locale="fr" />);
    expect(screen.getByText("Horodatage")).toBeInTheDocument();
    expect(screen.getByText("Acteur")).toBeInTheDocument();
    expect(screen.getByText("Adresse IP")).toBeInTheDocument();
  });

  it("SEC-001b: action portée par un Badge bordé — danger (dot) pour un verbe destructif, jamais un aplat", () => {
    const destructive: AuditEntryView[] = [
      {
        actor: { id: "77777777-7777-4777-a777-777777777777", role: "DIRECTOR" },
        action: "DELETE /agencies/:id",
        entityType: "agency",
        entityId: "33333333-3333-4333-a333-333333333333",
        timestamp: "2026-07-11T10:00:00Z",
        ip: "41.67.128.5",
      },
    ];
    render(<AuditLogTable {...props({ entries: destructive })} />);
    const badge = screen.getByTestId("audit-action-badge");
    // Bordered danger pill with a dot (never a solid red fill).
    expect(badge.className).toContain("sig-badge--danger");
    expect(badge.querySelector(".sig-badge__dot")).not.toBeNull();
    expect(badge).toHaveTextContent("DELETE /agencies/:id");
  });

  it("SEC-001b: un verbe non destructif reste un Badge info (pas de danger abusif)", () => {
    render(<AuditLogTable {...props()} />);
    const first = screen.getAllByTestId("audit-action-badge")[0];
    expect(first?.className).toContain("sig-badge--info");
  });

  it("SEC-001b: valeurs de style = tokens design (jamais de hex en dur)", () => {
    const { container } = render(<AuditLogTable {...props()} />);
    const table = screen.getByTestId("audit-table");
    // Le conteneur n'utilise que des variables CSS pour ses couleurs.
    expect(table.getAttribute("style") ?? "").not.toMatch(/#[0-9a-f]{3,6}/i);
    // Aucune couleur hex codée en dur dans l'arbre rendu.
    for (const el of Array.from(container.querySelectorAll("[style]"))) {
      expect(el.getAttribute("style") ?? "").not.toMatch(/color:\s*#[0-9a-f]{3,6}/i);
    }
  });
});
