/**
 * OnboardingWizard — 5-step guided agency onboarding (WEB-006).
 *
 * Drives the onboarding state machine (lib/onboarding): create → template →
 * services → counters → agents → qr. The create step calls onCreateAgency
 * (POST /agencies) and records the returned id; the final step calls
 * onGenerateQr (POST /agencies/{id}/kiosk-access) and shows the QR image.
 * End-to-end testable without a network (callbacks are injected). Tokens only.
 * @module components/admin/onboarding-wizard
 */
"use client";

import { useReducer, useState, type CSSProperties, type ReactElement } from "react";
import {
  initialOnboardingState,
  onboardingReducer,
  currentStep,
  canAdvance,
  isOnboardingComplete,
  ONBOARDING_STEPS,
  ONBOARDING_STEP_COUNT,
  type OnboardingStep,
} from "@/lib/onboarding";
import { t, type Locale } from "@/lib/i18n";

/** Props for {@link OnboardingWizard}. */
export interface OnboardingWizardProps {
  /** Creates the agency (POST /agencies) and resolves its id. */
  onCreateAgency: (name: string) => Promise<string>;
  /** Generates kiosk credentials + QR (POST /agencies/{id}/kiosk-access). */
  onGenerateQr: (agencyId: string) => Promise<string>;
  /** Active locale. */
  locale?: Locale;
}

const btnStyle: CSSProperties = {
  minHeight: "40px",
  padding: "0 1rem",
  borderRadius: "0.375rem",
  cursor: "pointer",
  fontSize: "1rem",
  border: "none",
  backgroundColor: "var(--brand)",
  color: "var(--brand-contrast)",
};
const secondaryBtn: CSSProperties = {
  ...btnStyle,
  backgroundColor: "var(--surface-1)",
  color: "var(--ink-strong)",
  border: "1px solid var(--ink-soft)",
};

/**
 * 5-step onboarding wizard.
 * @param props - {@link OnboardingWizardProps}.
 * @returns The wizard element.
 */
export function OnboardingWizard({ onCreateAgency, onGenerateQr, locale = "fr" }: OnboardingWizardProps): ReactElement {
  const [state, dispatch] = useReducer(onboardingReducer, undefined, initialOnboardingState);
  const [agencyName, setAgencyName] = useState("");
  const step: OnboardingStep = currentStep(state);
  const stepNumber = ONBOARDING_STEPS.indexOf(step) + 1;

  async function handleCreate(): Promise<void> {
    if (agencyName.trim().length === 0) return;
    const id = await onCreateAgency(agencyName);
    dispatch({ type: "AGENCY_CREATED", agencyId: id });
  }

  async function handleQr(): Promise<void> {
    if (!state.agencyId) return;
    const url = await onGenerateQr(state.agencyId);
    dispatch({ type: "QR_GENERATED", qrCodeDataUrl: url });
  }

  return (
    <section data-testid="onboarding-wizard" aria-label={t("admin.section.onboarding", locale)}>
      <div data-testid="wizard-progress" style={{ fontSize: "var(--caption)", color: "var(--ink-soft)", marginBottom: "1rem" }}>
        {t("admin.wizard_step", locale)} {stepNumber} / {ONBOARDING_STEP_COUNT}
      </div>

      <div data-testid={`wizard-step-${step}`} style={{ minHeight: "6rem" }}>
        {step === "create" && (
          <div>
            <label htmlFor="wizard-agency-name" style={{ fontSize: "var(--caption)", color: "var(--ink-soft)" }}>
              {t("admin.section.agencies", locale)}
            </label>
            <input
              id="wizard-agency-name"
              data-testid="wizard-agency-name"
              value={agencyName}
              onChange={(e) => setAgencyName(e.target.value)}
              style={{ display: "block", minHeight: "40px", padding: "0 0.75rem", border: "1px solid var(--ink-soft)", borderRadius: "0.375rem", margin: "0.25rem 0", fontSize: "1rem", backgroundColor: "var(--surface-0)", color: "var(--ink-strong)" }}
            />
            <button type="button" data-testid="wizard-create-submit" onClick={() => void handleCreate()} style={btnStyle}>
              {t("admin.confirm", locale)}
            </button>
          </div>
        )}

        {(step === "template" || step === "services" || step === "counters" || step === "agents") && (
          <div>
            <p style={{ color: "var(--ink-strong)" }}>{t(`admin.section.${step === "template" ? "sms_templates" : step}` as never, locale)}</p>
            <button type="button" data-testid="wizard-complete-step" onClick={() => dispatch({ type: "COMPLETE_STEP", step })} style={secondaryBtn}>
              {t("admin.confirm", locale)}
            </button>
          </div>
        )}

        {step === "qr" && (
          <div>
            <button type="button" data-testid="wizard-generate-qr" onClick={() => void handleQr()} style={btnStyle}>
              {t("admin.wizard_generate_qr", locale)}
            </button>
            {state.qrCodeDataUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img data-testid="wizard-qr-image" src={state.qrCodeDataUrl} alt={t("admin.wizard_generate_qr", locale)} style={{ display: "block", marginTop: "1rem", width: "160px", height: "160px" }} />
            )}
            {isOnboardingComplete(state) && (
              <p data-testid="wizard-done" style={{ color: "var(--success)" }}>{t("admin.wizard_done", locale)}</p>
            )}
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: "0.75rem", marginTop: "1rem" }}>
        <button type="button" data-testid="wizard-back" onClick={() => dispatch({ type: "BACK" })} disabled={state.stepIndex === 0} style={{ ...secondaryBtn, opacity: state.stepIndex === 0 ? 0.5 : 1 }}>
          {t("admin.wizard_back", locale)}
        </button>
        {step !== "qr" && (
          <button type="button" data-testid="wizard-next" onClick={() => dispatch({ type: "NEXT" })} disabled={!canAdvance(state)} style={{ ...btnStyle, opacity: canAdvance(state) ? 1 : 0.5 }}>
            {t("admin.wizard_next", locale)}
          </button>
        )}
      </div>
    </section>
  );
}
