/**
 * NOTIF-005-B — PWA shell: composes the 3-step flow + live tracking.
 *
 * Resolves the QR token client-side for a humane invalid/expired screen, then
 * drives the flow: Stepper header, FR/EN toggle, offline banner, and the active
 * step. Registers the service worker for light offline support. Design v2
 * « Sérénité Premium » — tokens only, zero emoji, FR/EN, 5 states per screen.
 *
 * @module components/pwa/PwaShell
 */
"use client";

import { useMemo, useState, type ReactElement } from "react";
import { OfflineBanner, Stepper } from "@sigfa/ui";
import { pt, type PwaLocale } from "@/lib/pwa/pwa-i18n";
import { parseAgencyToken } from "@/lib/pwa/pwa-token";
import { getServices, findService, serviceName } from "@/lib/pwa/pwa-services";
import { useTicketFlow, FLOW_STEPS } from "@/lib/pwa/use-ticket-flow";
import { useNetworkStatus } from "@/lib/pwa/use-network-status";
import { useServiceWorker } from "@/lib/pwa/use-service-worker";
import { PwaLanguageToggle } from "@/components/pwa/PwaLanguageToggle";
import { PwaTokenError } from "@/components/pwa/PwaTokenError";
import { PwaServiceStep } from "@/components/pwa/PwaServiceStep";
import { PwaConfirmStep } from "@/components/pwa/PwaConfirmStep";
import { PwaTicketStep } from "@/components/pwa/PwaTicketStep";

/** Props for {@link PwaShell}. */
export interface PwaShellProps {
  /** Raw signed agency token from the `/q/[token]` route (URL-decoded). */
  readonly token: string;
  /** Public API base URL. */
  readonly baseUrl: string;
  /** Initial locale (default `"fr"`). */
  readonly initialLocale?: PwaLocale;
  /** Disable SW registration (tests). */
  readonly registerServiceWorker?: boolean;
  /** Poll cadence override forwarded to the ticket step (tests). */
  readonly pollIntervalMs?: number;
}

/**
 * Renders the full public ticket PWA.
 *
 * @param props - Token, base URL, locale, test gates.
 * @returns The shell element.
 */
export function PwaShell({
  token,
  baseUrl,
  initialLocale = "fr",
  registerServiceWorker = true,
  pollIntervalMs,
}: PwaShellProps): ReactElement {
  const [locale, setLocale] = useState<PwaLocale>(initialLocale);
  const online = useNetworkStatus();
  useServiceWorker(registerServiceWorker);

  const tokenResult = useMemo(() => parseAgencyToken(token), [token]);
  const agencyId = tokenResult.kind === "valid" ? tokenResult.agencyId : "";

  const flow = useTicketFlow({ baseUrl, agencyId });
  const services = getServices();

  // Invalid / expired token → humane error screen (no crash).
  if (tokenResult.kind !== "valid") {
    return (
      <PwaTokenErrorFrame locale={locale} onLocale={setLocale}>
        <PwaTokenError kind={tokenResult.kind} locale={locale} />
      </PwaTokenErrorFrame>
    );
  }

  const selectedService = flow.selectedServiceId
    ? findService(services, flow.selectedServiceId)
    : undefined;
  const serviceLabel = selectedService ? serviceName(selectedService, locale) : "";

  const steps = FLOW_STEPS.map((s) =>
    pt(
      s === "service" ? "pwa.step.service" : s === "confirm" ? "pwa.step.confirm" : "pwa.step.ticket",
      locale,
    ),
  );

  return (
    <main
      data-testid="pwa-shell"
      role="main"
      style={{
        minHeight: "100dvh",
        backgroundColor: "var(--paper)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "var(--space-5) var(--space-4) var(--space-8)",
      }}
    >
      <div style={{ width: "100%", maxWidth: "32rem" }}>
        <header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: "var(--space-5)",
          }}
        >
          <span
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: 700,
              color: "var(--brand-strong)",
              fontSize: "var(--text-lg)",
            }}
          >
            {pt("pwa.app.name", locale)}
          </span>
          <PwaLanguageToggle locale={locale} onChange={setLocale} />
        </header>

        {!online && (
          <div style={{ marginBottom: "var(--space-4)" }}>
            <OfflineBanner data-testid="pwa-offline-banner" message={pt("pwa.state.offline", locale)} />
          </div>
        )}

        <Stepper
          data-testid="pwa-stepper"
          steps={steps}
          current={flow.stepIndex}
          style={{ marginBottom: "var(--space-6)" }}
        />

        {flow.step === "service" && (
          <PwaServiceStep services={services} locale={locale} onSelect={flow.selectService} />
        )}

        {flow.step === "confirm" && (
          <PwaConfirmStep
            serviceLabel={serviceLabel}
            phone={flow.phone}
            consent={flow.consent}
            canSubmit={flow.canSubmit}
            emitStatus={flow.emitStatus}
            emitError={flow.emitError}
            locale={locale}
            onPhoneChange={flow.setPhone}
            onConsentChange={flow.setConsent}
            onBack={flow.back}
            onSubmit={() => void flow.submit()}
            onRetry={() => void flow.retry()}
          />
        )}

        {flow.step === "ticket" && flow.created && (
          <PwaTicketStep
            baseUrl={baseUrl}
            created={flow.created}
            locale={locale}
            onNewTicket={flow.reset}
            intervalMs={pollIntervalMs}
          />
        )}
      </div>
    </main>
  );
}

/** Minimal chrome (locale toggle) wrapping the token-error screen. */
function PwaTokenErrorFrame({
  locale,
  onLocale,
  children,
}: {
  locale: PwaLocale;
  onLocale: (l: PwaLocale) => void;
  children: ReactElement;
}): ReactElement {
  return (
    <div style={{ position: "relative" }}>
      <div style={{ position: "absolute", top: "var(--space-4)", right: "var(--space-4)", zIndex: 1 }}>
        <PwaLanguageToggle locale={locale} onChange={onLocale} />
      </div>
      {children}
    </div>
  );
}
