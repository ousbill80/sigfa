/**
 * NOTIF-005-B — tests for step 2 (confirm: optional phone + consent).
 * @module components/pwa/PwaConfirmStep.test
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PwaConfirmStep, type PwaConfirmStepProps } from "./PwaConfirmStep";
import { pt } from "@/lib/pwa/pwa-i18n";

function setup(overrides: Partial<PwaConfirmStepProps> = {}) {
  const props: PwaConfirmStepProps = {
    serviceLabel: "Caisse",
    phone: "",
    consent: false,
    canSubmit: true,
    emitStatus: "idle",
    locale: "fr",
    onPhoneChange: vi.fn(),
    onConsentChange: vi.fn(),
    onBack: vi.fn(),
    onSubmit: vi.fn(),
    onRetry: vi.fn(),
    ...overrides,
  };
  render(<PwaConfirmStep {...props} />);
  return props;
}

describe("NOTIF-005-B: PwaConfirmStep", () => {
  it("shows the chosen service label", () => {
    setup();
    expect(screen.getByTestId("pwa-confirm-service")).toHaveTextContent("Caisse");
  });

  it("hides the consent checkbox until a phone is entered", () => {
    setup({ phone: "" });
    expect(screen.queryByTestId("pwa-confirm-consent")).not.toBeInTheDocument();
  });

  it("shows the consent checkbox when a phone is present", () => {
    setup({ phone: "+2250700000001" });
    expect(screen.getByTestId("pwa-confirm-consent")).toBeInTheDocument();
  });

  it("surfaces an inline consent-required message when phone present but no consent", () => {
    setup({ phone: "+2250700000001", consent: false });
    expect(screen.getByTestId("pwa-consent-error")).toBeInTheDocument();
  });

  it("shows an inline invalid-phone error", () => {
    setup({ phone: "abc" });
    expect(screen.getByText(pt("pwa.confirm.phone_invalid", "fr"))).toBeInTheDocument();
  });

  it("disables submit when canSubmit is false", () => {
    setup({ canSubmit: false });
    expect(screen.getByTestId("pwa-confirm-submit")).toBeDisabled();
  });

  it("shows a submitting label while emitting", () => {
    setup({ emitStatus: "submitting" });
    expect(screen.getByTestId("pwa-confirm-submit")).toHaveTextContent(
      pt("pwa.confirm.submitting", "fr"),
    );
  });

  it("wires phone, consent, back and submit handlers", async () => {
    const props = setup({ phone: "+225070000000" });
    await userEvent.type(screen.getByTestId("pwa-confirm-phone"), "1");
    expect(props.onPhoneChange).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("checkbox"));
    expect(props.onConsentChange).toHaveBeenCalledWith(true);
    await userEvent.click(screen.getByTestId("pwa-confirm-back"));
    expect(props.onBack).toHaveBeenCalledOnce();
  });

  it("calls onSubmit when submit is enabled and clicked", async () => {
    const props = setup({ canSubmit: true });
    await userEvent.click(screen.getByTestId("pwa-confirm-submit"));
    expect(props.onSubmit).toHaveBeenCalledOnce();
  });
});

describe("NOTIF-005-B: PwaConfirmStep — emission failure is visible + retryable", () => {
  it("shows a visible alert with a retry button when emission fails", () => {
    setup({ emitStatus: "error", emitError: "generic" });
    const alert = screen.getByTestId("pwa-emit-error");
    expect(alert).toHaveAttribute("role", "alert");
    expect(alert).toHaveTextContent(pt("pwa.emit.error_title", "fr"));
    expect(screen.getByTestId("pwa-emit-retry")).toBeInTheDocument();
  });

  it("does not render the error block while idle", () => {
    setup({ emitStatus: "idle" });
    expect(screen.queryByTestId("pwa-emit-error")).not.toBeInTheDocument();
  });

  it("wires the retry handler", async () => {
    const props = setup({ emitStatus: "error", emitError: "offline" });
    await userEvent.click(screen.getByTestId("pwa-emit-retry"));
    expect(props.onRetry).toHaveBeenCalledOnce();
  });

  it("shows distinct humane messages per failure reason", () => {
    const cases = [
      ["offline", "pwa.emit.error_offline"],
      ["conflict", "pwa.emit.error_conflict"],
      ["rate_limited", "pwa.emit.error_rate_limited"],
      ["validation", "pwa.emit.error_validation"],
      ["generic", "pwa.emit.error_generic"],
    ] as const;
    for (const [reason, key] of cases) {
      const { unmount } = render(
        <PwaConfirmStep
          serviceLabel="Caisse"
          phone=""
          consent={false}
          canSubmit
          emitStatus="error"
          emitError={reason}
          locale="fr"
          onPhoneChange={vi.fn()}
          onConsentChange={vi.fn()}
          onBack={vi.fn()}
          onSubmit={vi.fn()}
          onRetry={vi.fn()}
        />,
      );
      expect(screen.getByTestId("pwa-emit-error-message")).toHaveTextContent(pt(key, "fr"));
      unmount();
    }
  });

  it("keeps tap targets ≥44px on the actions and retry", () => {
    setup({ emitStatus: "error", emitError: "generic" });
    for (const id of ["pwa-confirm-back", "pwa-confirm-submit", "pwa-emit-retry"]) {
      expect(screen.getByTestId(id).getAttribute("style") ?? "").toMatch(/min-height:\s*44px/);
    }
  });
});
