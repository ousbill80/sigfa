/**
 * NOTIF-005-B — step 2: confirm (optional phone + SMS consent).
 *
 * Phone is OPTIONAL (tracking works via trackingId). When a phone is entered,
 * an explicit SMS consent checkbox is required (UEMOA opt-in). Inline errors
 * under the field, never a modal. Tokens from `@sigfa/ui`.
 *
 * @module components/pwa/PwaConfirmStep
 */
"use client";

import type { ChangeEvent, ReactElement } from "react";
import { Button, Card, Field } from "@sigfa/ui";
import { pt, type PwaLocale } from "@/lib/pwa/pwa-i18n";
import { hasPhone, isValidPhone } from "@/lib/pwa/pwa-validation";
import type { EmitStatus } from "@/lib/pwa/use-ticket-flow";

/** Props for {@link PwaConfirmStep}. */
export interface PwaConfirmStepProps {
  readonly serviceLabel: string;
  readonly phone: string;
  readonly consent: boolean;
  readonly canSubmit: boolean;
  readonly emitStatus: EmitStatus;
  readonly locale: PwaLocale;
  readonly onPhoneChange: (value: string) => void;
  readonly onConsentChange: (value: boolean) => void;
  readonly onBack: () => void;
  readonly onSubmit: () => void;
}

/**
 * Renders the confirmation step.
 *
 * @param props - Confirm-step state and handlers.
 * @returns The step element.
 */
export function PwaConfirmStep(props: PwaConfirmStepProps): ReactElement {
  const {
    serviceLabel,
    phone,
    consent,
    canSubmit,
    emitStatus,
    locale,
    onPhoneChange,
    onConsentChange,
    onBack,
    onSubmit,
  } = props;

  const phonePresent = hasPhone(phone);
  const phoneError = phone.length > 0 && !isValidPhone(phone);
  const consentError = phonePresent && !consent;
  const submitting = emitStatus === "submitting";

  return (
    <section data-testid="pwa-confirm-step" aria-label={pt("pwa.confirm.title", locale)}>
      <h1
        style={{
          fontFamily: "var(--font-display)",
          fontSize: "var(--text-2xl)",
          lineHeight: "1.15",
          color: "var(--ink)",
          margin: "0 0 var(--space-5)",
        }}
      >
        {pt("pwa.confirm.title", locale)}
      </h1>

      <Card style={{ padding: "var(--space-5)", marginBottom: "var(--space-5)" }}>
        <span style={{ display: "block", color: "var(--ink-soft)", fontSize: "var(--text-sm)" }}>
          {pt("pwa.confirm.service_label", locale)}
        </span>
        <span
          data-testid="pwa-confirm-service"
          style={{ fontWeight: 600, fontSize: "var(--text-lg)", color: "var(--ink)" }}
        >
          {serviceLabel}
        </span>
      </Card>

      <Field
        data-testid="pwa-confirm-phone"
        type="tel"
        inputMode="tel"
        label={pt("pwa.confirm.phone_label", locale)}
        hint={pt("pwa.confirm.phone_hint", locale)}
        placeholder={pt("pwa.confirm.phone_placeholder", locale)}
        value={phone}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onPhoneChange(e.target.value)}
        error={phoneError ? pt("pwa.confirm.phone_invalid", locale) : undefined}
      />

      {phonePresent && (
        <label
          data-testid="pwa-confirm-consent"
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: "var(--space-3)",
            margin: "var(--space-4) 0",
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={consent}
            onChange={(e: ChangeEvent<HTMLInputElement>) => onConsentChange(e.target.checked)}
            style={{ width: "1.25rem", height: "1.25rem", marginTop: "0.15rem" }}
            aria-describedby={consentError ? "pwa-consent-error" : undefined}
          />
          <span style={{ color: "var(--ink)", fontSize: "var(--text-sm)" }}>
            {pt("pwa.confirm.consent_label", locale)}
          </span>
        </label>
      )}
      {consentError && (
        <p
          id="pwa-consent-error"
          data-testid="pwa-consent-error"
          role="alert"
          style={{ color: "var(--danger)", fontSize: "var(--text-sm)", margin: "0 0 var(--space-4)" }}
        >
          {pt("pwa.confirm.consent_required", locale)}
        </p>
      )}

      <div style={{ display: "flex", gap: "var(--space-3)", marginTop: "var(--space-4)" }}>
        <Button variant="secondary" onClick={onBack} disabled={submitting} data-testid="pwa-confirm-back">
          {pt("pwa.confirm.back", locale)}
        </Button>
        <Button
          variant="primary"
          onClick={onSubmit}
          disabled={!canSubmit || submitting}
          data-testid="pwa-confirm-submit"
          style={{ flex: 1 }}
        >
          {submitting ? pt("pwa.confirm.submitting", locale) : pt("pwa.confirm.submit", locale)}
        </Button>
      </div>
    </section>
  );
}
