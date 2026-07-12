/**
 * OnboardingWizard — 5-step guided agency onboarding (WEB-006).
 *
 * Drives the onboarding state machine (lib/onboarding): create → template →
 * services → counters → agents → qr. The create step calls onCreateAgency
 * (POST /agencies) and records the returned id; the final step calls
 * onGenerateQr (POST /agencies/{id}/kiosk-access) and shows the QR image.
 * End-to-end testable without a network (callbacks are injected).
 * v2 « Sérénité Premium » — @sigfa/ui Stepper + tokens only.
 * @module components/admin/onboarding-wizard
 */
"use client";

import { useReducer, useState, type CSSProperties, type ReactElement } from "react";
import { Button, Field, Stepper } from "@sigfa/ui";
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
import { t, type Locale, type TranslationKey } from "@/lib/i18n";

/** Props for {@link OnboardingWizard}. */
export interface OnboardingWizardProps {
  /** Creates the agency (POST /agencies) and resolves its id. */
  onCreateAgency: (name: string) => Promise<string>;
  /** Generates kiosk credentials + QR (POST /agencies/{id}/kiosk-access). */
  onGenerateQr: (agencyId: string) => Promise<string>;
  /** Active locale. */
  locale?: Locale;
}

/** i18n key for each onboarding step label (used by the Stepper). */
const STEP_LABEL: Record<OnboardingStep, TranslationKey> = {
  create: "admin.section.agencies",
  template: "admin.section.sms_templates",
  services: "admin.section.services",
  counters: "admin.section.counters",
  agents: "admin.section.agents",
  qr: "admin.wizard_generate_qr",
};

const overlineStyle: CSSProperties = {
  fontFamily: "var(--font-text)",
  fontSize: "var(--text-xs)",
  fontWeight: 600,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--ink-faint)",
  margin: "0 0 var(--space-4)",
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
  const stepIndex = ONBOARDING_STEPS.indexOf(step);

  const stepLabels = ONBOARDING_STEPS.map((s) => t(STEP_LABEL[s], locale));

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
      <p style={overlineStyle}>{t("admin.section.onboarding", locale)}</p>

      <Stepper steps={stepLabels} current={stepIndex} style={{ marginBottom: "var(--space-6)" }} />

      <div
        data-testid="wizard-progress"
        style={{ fontSize: "var(--text-sm)", color: "var(--ink-soft)", marginBottom: "var(--space-6)" }}
      >
        {t("admin.wizard_step", locale)} {stepIndex + 1} / {ONBOARDING_STEP_COUNT}
      </div>

      <div data-testid={`wizard-step-${step}`} style={{ minHeight: "7rem" }}>
        {step === "create" && (
          <div style={{ maxWidth: "26rem" }}>
            <Field
              id="wizard-agency-name"
              data-testid="wizard-agency-name"
              label={t("admin.section.agencies", locale)}
              value={agencyName}
              onChange={(e) => setAgencyName(e.target.value)}
            />
            <div style={{ marginTop: "var(--space-4)" }}>
              <Button type="button" variant="primary" data-testid="wizard-create-submit" onClick={() => void handleCreate()}>
                {t("admin.confirm", locale)}
              </Button>
            </div>
          </div>
        )}

        {(step === "template" || step === "services" || step === "counters" || step === "agents") && (
          <div>
            <p style={{ color: "var(--ink)", fontSize: "var(--text-lg)", fontWeight: 500, margin: "0 0 var(--space-4)" }}>
              {t(STEP_LABEL[step], locale)}
            </p>
            <Button type="button" variant="secondary" data-testid="wizard-complete-step" onClick={() => dispatch({ type: "COMPLETE_STEP", step })}>
              {t("admin.confirm", locale)}
            </Button>
          </div>
        )}

        {step === "qr" && (
          <div>
            <Button type="button" variant="primary" data-testid="wizard-generate-qr" onClick={() => void handleQr()}>
              {t("admin.wizard_generate_qr", locale)}
            </Button>
            {state.qrCodeDataUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                data-testid="wizard-qr-image"
                src={state.qrCodeDataUrl}
                alt={t("admin.wizard_generate_qr", locale)}
                style={{ display: "block", marginTop: "var(--space-4)", width: "160px", height: "160px", borderRadius: "var(--r-md)", border: "1px solid var(--hairline)" }}
              />
            )}
            {isOnboardingComplete(state) && (
              <p data-testid="wizard-done" style={{ color: "var(--success)", marginTop: "var(--space-3)", fontWeight: 600 }}>
                {t("admin.wizard_done", locale)}
              </p>
            )}
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: "var(--space-3)", marginTop: "var(--space-6)" }}>
        <Button type="button" variant="secondary" data-testid="wizard-back" onClick={() => dispatch({ type: "BACK" })} disabled={state.stepIndex === 0}>
          {t("admin.wizard_back", locale)}
        </Button>
        {step !== "qr" && (
          <Button type="button" variant="primary" data-testid="wizard-next" onClick={() => dispatch({ type: "NEXT" })} disabled={!canAdvance(state)}>
            {t("admin.wizard_next", locale)}
          </Button>
        )}
      </div>
    </section>
  );
}
