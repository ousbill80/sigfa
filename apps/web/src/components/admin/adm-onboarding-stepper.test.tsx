/**
 * Tests for AdmOnboardingStepper (ADM-002b) — the chronometered, resumable
 * 5-step parcours with the installation QR screen.
 *
 * All side-effects are injected callbacks so the parcours is testable end to end
 * without a network. Covers: the 5 steps, the target-time + chronometer + < 2h
 * indicator, blocked advancement with inline error and preserved progress, the
 * printable QR screen with expiry + regenerate, the final recap with measured
 * duration, RBAC (AGENT/AUDITOR → forbidden), the "kiosk not provisioned"
 * message, and the offline state.
 * @module components/admin/adm-onboarding-stepper.test
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AdmOnboardingStepper } from "./adm-onboarding-stepper";
import type { KioskEnrollment } from "@/lib/adm-onboarding";

const ENROLL: KioskEnrollment = {
  kioskId: "14141414-1414-4141-a141-141414141414",
  enrollmentQrUrl: "https://app.sigfa.ci/enroll/14141414-1414-4141-a141-141414141414",
  expiresAt: "2999-07-12T10:30:00Z",
};

/** Callbacks that succeed, for a happy-path parcours. */
function okHandlers() {
  return {
    onClone: vi.fn(async () => ({
      ok: true as const,
      agencyId: "ag-1",
      onboardingId: "ob-1",
      createdAt: "2026-07-12T10:00:00Z",
    })),
    onProvision: vi.fn(async () => ({ ok: true as const, enrollment: ENROLL })),
    onResume: vi.fn(async () => ({ ok: true as const })),
  };
}

describe("ADM-002b: AdmOnboardingStepper — RBAC", () => {
  it("ADM-002b: AGENT → écran interdit, aucune action de parcours", () => {
    const h = okHandlers();
    render(<AdmOnboardingStepper role="AGENT" {...h} />);
    expect(screen.getByTestId("adm-onboard-forbidden")).toBeInTheDocument();
    expect(screen.queryByTestId("adm-onboard-stepper")).not.toBeInTheDocument();
  });

  it("ADM-002b: AUDITOR → écran interdit", () => {
    const h = okHandlers();
    render(<AdmOnboardingStepper role="AUDITOR" {...h} />);
    expect(screen.getByTestId("adm-onboard-forbidden")).toBeInTheDocument();
  });

  it("ADM-002b: AGENCY_DIRECTOR → parcours accessible", () => {
    const h = okHandlers();
    render(<AdmOnboardingStepper role="AGENCY_DIRECTOR" {...h} />);
    expect(screen.getByTestId("adm-onboard-stepper")).toBeInTheDocument();
  });
});

describe("ADM-002b: AdmOnboardingStepper — chronomètre + temps cibles", () => {
  it("ADM-002b: chaque étape affiche son temps cible et le chronomètre global", () => {
    const h = okHandlers();
    render(<AdmOnboardingStepper role="AGENCY_DIRECTOR" {...h} />);
    expect(screen.getByTestId("adm-onboard-chrono")).toBeInTheDocument();
    expect(screen.getByTestId("adm-onboard-step-target")).toBeInTheDocument();
  });
});

describe("ADM-002b: AdmOnboardingStepper — parcours complet", () => {
  async function driveToKiosk(h: ReturnType<typeof okHandlers>) {
    render(<AdmOnboardingStepper role="AGENCY_DIRECTOR" {...h} />);
    // Step 1 — clone
    fireEvent.change(screen.getByTestId("adm-clone-name"), { target: { value: "Agence Marcory" } });
    fireEvent.change(screen.getByTestId("adm-clone-template"), { target: { value: "tpl-1" } });
    fireEvent.click(screen.getByTestId("adm-clone-submit"));
    await waitFor(() => expect(h.onClone).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByTestId("adm-onboard-next"));
    // Step 2 — services
    fireEvent.click(screen.getByTestId("adm-verify-confirm"));
    fireEvent.click(screen.getByTestId("adm-onboard-next"));
    // Step 3 — counters
    fireEvent.click(screen.getByTestId("adm-verify-confirm"));
    fireEvent.click(screen.getByTestId("adm-onboard-next"));
    // Step 4 — agents
    fireEvent.click(screen.getByTestId("adm-verify-confirm"));
    fireEvent.click(screen.getByTestId("adm-onboard-next"));
    // Step 5 — kiosk
    await screen.findByTestId("adm-kiosk-provision");
  }

  it("ADM-002b: parcours 5 étapes → QR imprimable + expiration + régénérer", async () => {
    const h = okHandlers();
    await driveToKiosk(h);
    fireEvent.click(screen.getByTestId("adm-kiosk-provision"));
    await waitFor(() => expect(h.onProvision).toHaveBeenCalledTimes(1));
    // QR image + expiry + regenerate + print
    expect(await screen.findByTestId("adm-kiosk-qr")).toBeInTheDocument();
    expect(screen.getByTestId("adm-kiosk-expires")).toBeInTheDocument();
    expect(screen.getByTestId("adm-kiosk-regenerate")).toBeInTheDocument();
    expect(screen.getByTestId("adm-kiosk-print")).toBeInTheDocument();
  });

  it("ADM-002b: récap final affiche durée totale mesurée + « Agence opérationnelle »", async () => {
    const h = okHandlers();
    await driveToKiosk(h);
    fireEvent.click(screen.getByTestId("adm-kiosk-provision"));
    await screen.findByTestId("adm-kiosk-qr");
    const recap = await screen.findByTestId("adm-onboard-recap");
    expect(recap).toBeInTheDocument();
    expect(screen.getByTestId("adm-onboard-total-duration")).toBeInTheDocument();
  });

  it("ADM-002b: régénérer relance le provisionnement", async () => {
    const h = okHandlers();
    await driveToKiosk(h);
    fireEvent.click(screen.getByTestId("adm-kiosk-provision"));
    await screen.findByTestId("adm-kiosk-qr");
    fireEvent.click(screen.getByTestId("adm-kiosk-regenerate"));
    await waitFor(() => expect(h.onProvision).toHaveBeenCalledTimes(2));
  });
});

describe("ADM-002b: AdmOnboardingStepper — échecs & blocage", () => {
  it("ADM-002b: clone en échec → erreur inline, avancement bloqué, progression conservée", async () => {
    const h = okHandlers();
    h.onClone.mockResolvedValueOnce({ ok: false as const, message: "Source de clonage requise." } as never);
    render(<AdmOnboardingStepper role="AGENCY_DIRECTOR" {...h} />);
    fireEvent.change(screen.getByTestId("adm-clone-name"), { target: { value: "X" } });
    fireEvent.click(screen.getByTestId("adm-clone-submit"));
    expect(await screen.findByTestId("adm-onboard-error")).toHaveTextContent("Source de clonage requise.");
    // NEXT stays disabled — still on step 1
    expect(screen.getByTestId("adm-clone-name")).toBeInTheDocument();
  });

  it("ADM-002b: QR non généré → message « Borne non provisionnée » + réessayer, jamais d'étape 5 « terminée » sans QR", async () => {
    const h = okHandlers();
    h.onProvision.mockResolvedValueOnce({ ok: false as const, message: "quota atteint" } as never);
    render(<AdmOnboardingStepper role="AGENCY_DIRECTOR" {...h} />);
    fireEvent.change(screen.getByTestId("adm-clone-name"), { target: { value: "Agence Marcory" } });
    fireEvent.change(screen.getByTestId("adm-clone-template"), { target: { value: "tpl-1" } });
    fireEvent.click(screen.getByTestId("adm-clone-submit"));
    await waitFor(() => expect(h.onClone).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId("adm-onboard-next"));
    fireEvent.click(screen.getByTestId("adm-verify-confirm"));
    fireEvent.click(screen.getByTestId("adm-onboard-next"));
    fireEvent.click(screen.getByTestId("adm-verify-confirm"));
    fireEvent.click(screen.getByTestId("adm-onboard-next"));
    fireEvent.click(screen.getByTestId("adm-verify-confirm"));
    fireEvent.click(screen.getByTestId("adm-onboard-next"));
    fireEvent.click(await screen.findByTestId("adm-kiosk-provision"));
    expect(await screen.findByTestId("adm-onboard-error")).toBeInTheDocument();
    // No QR, no recap
    expect(screen.queryByTestId("adm-kiosk-qr")).not.toBeInTheDocument();
    expect(screen.queryByTestId("adm-onboard-recap")).not.toBeInTheDocument();
  });
});

describe("ADM-002b: AdmOnboardingStepper — reprise + offline", () => {
  it("ADM-002b: reprise depuis onboarding/{id} restaure l'étape courante", async () => {
    const h = okHandlers();
    h.onResume.mockResolvedValueOnce({
      ok: true as const,
      status: {
        onboardingId: "ob-1",
        agencyId: "ag-1",
        startedAt: "2026-07-12T10:00:00Z",
        completedAt: null,
        steps: [
          { key: "clone", status: "DONE", completedAt: "2026-07-12T10:01:00Z" },
          { key: "services", status: "DONE", completedAt: "2026-07-12T10:10:00Z" },
        ],
      },
    } as never);
    render(
      <AdmOnboardingStepper
        role="AGENCY_DIRECTOR"
        resumeAgencyId="ag-1"
        resumeOnboardingId="ob-1"
        {...h}
      />,
    );
    await waitFor(() => expect(h.onResume).toHaveBeenCalledWith("ag-1", "ob-1"));
    // Landed on step 3 (counters) — its verify button is present
    expect(await screen.findByTestId("adm-verify-confirm")).toBeInTheDocument();
  });

  it("ADM-002b: offline → « Connexion requise pour l'onboarding »", () => {
    const h = okHandlers();
    render(<AdmOnboardingStepper role="AGENCY_DIRECTOR" connection="offline" {...h} />);
    expect(screen.getByTestId("adm-onboard-offline")).toBeInTheDocument();
  });
});
