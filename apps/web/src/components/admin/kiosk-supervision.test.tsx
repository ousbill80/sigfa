/**
 * Tests for KioskSupervision (ADM-003b) — StatusPill per status, SILENT never a
 * solid red fill (dotted/bordered pill), relative last-seen, alert counter,
 * SILENT-first ordering, network view, five states, FR/EN, tokens-only.
 * @module components/admin/kiosk-supervision.test
 */
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { KioskSupervision } from "./kiosk-supervision";
import {
  initialKioskSupervisionState,
  type KioskSupervisionState,
  type SupervisedKiosk,
} from "@/lib/kiosk-supervision-state";

const A1 = "33333333-3333-4333-a333-333333333333";
const A2 = "44444444-4444-4444-a444-444444444444";
const K1 = "14141414-1414-4141-a141-141414141414";
const K2 = "15151515-1515-4151-a151-151515151515";
const K3 = "16161616-1616-4161-a161-161616161616";
const NOW = Date.parse("2026-07-12T10:00:00Z");

function kiosk(over: Partial<SupervisedKiosk> = {}): SupervisedKiosk {
  return {
    kioskId: K1,
    agencyId: A1,
    status: "ONLINE",
    lastSeen: new Date(NOW - 12_000).toISOString(),
    ...over,
  };
}

function stateWith(kiosks: SupervisedKiosk[], over: Partial<KioskSupervisionState> = {}): KioskSupervisionState {
  return { ...initialKioskSupervisionState, kiosks, ...over };
}

describe("ADM-003b: vue agence — StatusPill + last seen relatif", () => {
  it("ADM-003b: chaque borne rend une StatusPill avec label texte (jamais couleur seule)", () => {
    render(
      <KioskSupervision
        state={stateWith([kiosk({ status: "ONLINE" }), kiosk({ kioskId: K2, status: "DEGRADED" })])}
        load="ready"
        nowMs={NOW}
      />,
    );
    const pills = screen.getAllByTestId("kiosk-status-pill");
    expect(pills).toHaveLength(2);
    for (const p of pills) expect(p).toHaveTextContent(/./);
  });

  it("ADM-003b: last seen relatif affiché (« il y a 12 s »)", () => {
    render(<KioskSupervision state={stateWith([kiosk()])} load="ready" nowMs={NOW} />);
    expect(screen.getByTestId("kiosk-card")).toHaveTextContent("il y a 12 s");
  });

  it("ADM-003b: NEVER_SEEN → libellé « installation non finalisée »", () => {
    render(
      <KioskSupervision
        state={stateWith([kiosk({ status: "NEVER_SEEN", lastSeen: null })])}
        load="ready"
        nowMs={NOW}
      />,
    );
    expect(screen.getByTestId("kiosk-card")).toHaveTextContent(/non finalis/i);
  });
});

describe("ADM-003b: SILENT = pastille danger, JAMAIS fond rouge plein", () => {
  it("ADM-003b: SILENT rend --danger en bordure/point, background = tint doux (jamais var(--danger) plein)", () => {
    render(
      <KioskSupervision
        state={stateWith([kiosk({ status: "SILENT", lastSeen: new Date(NOW - 120_000).toISOString() })])}
        load="ready"
        nowMs={NOW}
      />,
    );
    const pill = screen.getByTestId("kiosk-status-pill");
    const style = pill.getAttribute("style") ?? "";
    // La bordure porte --danger…
    expect(style).toContain("var(--danger)");
    // …mais le fond est le tint doux, jamais un fond rouge plein.
    expect(style).toContain("var(--danger-soft)");
    expect(style).not.toMatch(/background-color:\s*var\(--danger\)\b/);
  });

  it("ADM-003b: la carte muette porte un libellé « Borne muette » (icône + texte)", () => {
    render(
      <KioskSupervision
        state={stateWith([kiosk({ status: "SILENT", lastSeen: new Date(NOW - 120_000).toISOString() })])}
        load="ready"
        nowMs={NOW}
      />,
    );
    expect(screen.getByTestId("kiosk-status-pill")).toHaveTextContent(/muette/i);
  });
});

describe("ADM-003b: alertes + ordonnancement muette en tête", () => {
  it("ADM-003b: compteur d'alertes actives = nombre de bornes muettes", () => {
    render(
      <KioskSupervision
        state={stateWith([
          kiosk({ kioskId: K1, status: "SILENT" }),
          kiosk({ kioskId: K2, status: "ONLINE" }),
          kiosk({ kioskId: K3, status: "SILENT" }),
        ])}
        load="ready"
        nowMs={NOW}
      />,
    );
    expect(screen.getByTestId("alert-counter")).toHaveTextContent("2");
  });

  it("ADM-003b: borne muette remonte en tête de grille", () => {
    render(
      <KioskSupervision
        state={stateWith([
          kiosk({ kioskId: K1, status: "ONLINE" }),
          kiosk({ kioskId: K2, status: "SILENT", lastSeen: new Date(NOW - 120_000).toISOString() }),
        ])}
        load="ready"
        nowMs={NOW}
      />,
    );
    const cards = screen.getAllByTestId("kiosk-card");
    expect(cards[0]!.getAttribute("data-status")).toBe("SILENT");
  });
});

describe("ADM-003b: vue réseau (BANK_ADMIN+)", () => {
  it("ADM-003b: bascule vers vue réseau → agences avec bornes muettes triées", () => {
    render(
      <KioskSupervision
        state={stateWith([
          kiosk({ kioskId: K1, agencyId: A1, status: "ONLINE" }),
          kiosk({ kioskId: K2, agencyId: A2, status: "SILENT" }),
        ])}
        load="ready"
        networkEnabled
        nowMs={NOW}
      />,
    );
    fireEvent.click(screen.getByTestId("view-network"));
    const rows = screen.getAllByTestId("network-agency-row");
    expect(rows).toHaveLength(1);
    expect(within(rows[0]!).getByText(A2.slice(0, 8))).toBeInTheDocument();
  });

  it("ADM-003b: vue réseau sans borne muette → message « aucune agence en alerte »", () => {
    render(
      <KioskSupervision
        state={stateWith([kiosk({ status: "ONLINE" })])}
        load="ready"
        networkEnabled
        nowMs={NOW}
      />,
    );
    fireEvent.click(screen.getByTestId("view-network"));
    expect(screen.getByTestId("network-no-silent")).toBeInTheDocument();
  });

  it("ADM-003b: sans networkEnabled → pas d'onglet vue réseau (RBAC AGENCY_DIRECTOR)", () => {
    render(<KioskSupervision state={stateWith([kiosk()])} load="ready" nowMs={NOW} />);
    expect(screen.queryByTestId("view-network")).not.toBeInTheDocument();
  });
});

describe("ADM-003b: cinq états d'écran", () => {
  it("ADM-003b: loading → skeleton grille", () => {
    render(<KioskSupervision state={initialKioskSupervisionState} load="loading" nowMs={NOW} />);
    expect(screen.getByTestId("supervision-skeleton")).toBeInTheDocument();
  });

  it("ADM-003b: empty → EmptyState avec lien onboarding", () => {
    render(<KioskSupervision state={initialKioskSupervisionState} load="empty" nowMs={NOW} />);
    expect(screen.getByTestId("supervision-empty")).toBeInTheDocument();
    expect(screen.getByTestId("supervision-empty-cta")).toHaveAttribute("href", "/admin/onboarding");
  });

  it("ADM-003b: error → carte d'erreur role=alert", () => {
    render(<KioskSupervision state={initialKioskSupervisionState} load="error" nowMs={NOW} />);
    expect(screen.getByTestId("supervision-error")).toBeInTheDocument();
  });

  it("ADM-003b: stale (API indisponible) → bandeau info + dernier état connu", () => {
    render(<KioskSupervision state={stateWith([kiosk()])} load="stale" nowMs={NOW} />);
    expect(screen.getByTestId("supervision-stale")).toBeInTheDocument();
    // Le dernier état connu reste visible.
    expect(screen.getByTestId("kiosk-card")).toBeInTheDocument();
  });

  it("ADM-003b: offline (socket down) → bandeau resync", () => {
    render(
      <KioskSupervision
        state={stateWith([kiosk()], { connection: "offline" })}
        load="ready"
        nowMs={NOW}
      />,
    );
    expect(screen.getByTestId("supervision-offline")).toBeInTheDocument();
  });
});

describe("ADM-003b: i18n FR/EN", () => {
  it("ADM-003b: rendu EN — titre traduit", () => {
    render(<KioskSupervision state={stateWith([kiosk()])} load="ready" locale="en" nowMs={NOW} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Kiosk supervision");
  });

  it("ADM-003b: rendu FR — titre traduit", () => {
    render(<KioskSupervision state={stateWith([kiosk()])} load="ready" locale="fr" nowMs={NOW} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Supervision des bornes");
  });
});

describe("ADM-003b: tokens uniquement — zéro couleur en dur, zéro emoji", () => {
  it("ADM-003b: aucun hex codé en dur dans le rendu, aucun emoji", () => {
    const { container } = render(
      <KioskSupervision
        state={stateWith([
          kiosk({ kioskId: K1, status: "SILENT" }),
          kiosk({ kioskId: K2, status: "ONLINE" }),
        ])}
        load="ready"
        nowMs={NOW}
      />,
    );
    const html = container.innerHTML;
    expect(html).not.toMatch(/#[0-9a-fA-F]{6}/);
    // eslint-disable-next-line no-control-regex
    expect(html).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
  });
});
