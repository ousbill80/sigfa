/**
 * AdmOnboardingStepper — chronometered, resumable 5-step agency onboarding
 * (ADM-002b). Design System v2 « Sérénité Premium » — @sigfa/ui + tokens only.
 *
 * Steps: create (clone) → services & SLA → counters → agents (CSV) → kiosk/QR.
 * A global chronometer runs from `startedAt`; each step shows a target time and
 * a non-anxiety "< 2h" indicator (green while under budget). Leaving and coming
 * back restores the current step from the injected `onResume`. Step 5 shows the
 * printable installation QR + expiry + regenerate; the final recap shows the
 * measured total duration and "Agency operational". Every side-effect is an
 * injected callback so the whole parcours is testable without a network.
 *
 * @module components/admin/adm-onboarding-stepper
 */
"use client";

import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from "react";
import QRCode from "qrcode";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Heading,
  Overline,
  SegmentedControl,
  Skeleton,
  Stepper,
} from "@sigfa/ui";
import {
  ADM_ONBOARDING_STEPS,
  ADM_ONBOARDING_STEP_COUNT,
  ADM_ONBOARDING_TARGET_SECONDS,
  ADM_STEP_TARGET_SECONDS,
  admCanAdvance,
  admCurrentStep,
  admOnboardingReducer,
  elapsedSeconds,
  formatDuration,
  initialAdmOnboardingState,
  isAdmOnboardingComplete,
  isUnderTarget,
  resumeFromStatus,
  type AdmOnboardingStep,
  type KioskEnrollment,
  type ServerOnboardingStatus,
} from "@/lib/adm-onboarding";
import {
  tAdmOnboard,
  withReason,
  type AdmOnboardKey,
} from "@/lib/adm-onboarding-i18n";
import { canAccessSection } from "@/lib/admin-rbac";
import type { Role } from "@/lib/roles";
import type { Locale } from "@/lib/i18n";

/** Clone callback result (mirrors useAdmOnboarding CloneResult). */
export interface CloneCallbackResult {
  ok: boolean;
  agencyId?: string;
  onboardingId?: string;
  createdAt?: string;
  message?: string;
}

/** Provision callback result (mirrors useAdmOnboarding ProvisionResult). */
export interface ProvisionCallbackResult {
  ok: boolean;
  enrollment?: KioskEnrollment;
  message?: string;
}

/** Resume callback result (mirrors useAdmOnboarding OnboardingStatusResult). */
export interface ResumeCallbackResult {
  ok: boolean;
  status?: ServerOnboardingStatus;
  message?: string;
}

/** Props for {@link AdmOnboardingStepper}. */
export interface AdmOnboardingStepperProps {
  /** Viewer role — drives RBAC (AGENCY_DIRECTOR+ required). */
  role: Role;
  /** Clones the agency + starts onboarding (POST /banks/{id}/agencies:clone). */
  onClone: (source: { name: string; templateId?: string; sourceAgencyId?: string }) => Promise<CloneCallbackResult>;
  /** Provisions the kiosk + gets the QR (POST /agencies/{id}/kiosks:provision). */
  onProvision: (agencyId: string) => Promise<ProvisionCallbackResult>;
  /** Fetches onboarding status for resume (GET /agencies/{id}/onboarding/{id}). */
  onResume: (agencyId: string, onboardingId: string) => Promise<ResumeCallbackResult>;
  /** Optional agency id to resume an in-progress parcours. */
  resumeAgencyId?: string;
  /** Optional onboarding id to resume an in-progress parcours. */
  resumeOnboardingId?: string;
  /** Connection status (offline blocks the parcours). */
  connection?: "connected" | "offline";
  /** Active locale. */
  locale?: Locale;
  /** Injected clock (ms) for deterministic tests; defaults to Date.now. */
  now?: () => number;
}

/** i18n step-label key per UI step. */
const STEP_LABEL: Record<AdmOnboardingStep, AdmOnboardKey> = {
  clone: "admOnboard.step.clone",
  services: "admOnboard.step.services",
  counters: "admOnboard.step.counters",
  agents: "admOnboard.step.agents",
  kiosk: "admOnboard.step.kiosk",
};

const subtitleStyle: CSSProperties = {
  fontSize: "var(--text-sm)",
  color: "var(--ink-soft)",
  margin: "0 0 var(--space-6)",
  maxWidth: "48rem",
};

const stepPanelStyle: CSSProperties = {
  minHeight: "8rem",
  padding: "var(--space-6)",
};

const stepBodyLead: CSSProperties = {
  color: "var(--ink)",
  fontSize: "var(--text-lg)",
  fontWeight: 500,
  margin: "0 0 var(--space-4)",
};

function toLocaleTime(iso: string, locale: Locale): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  return new Date(t).toLocaleString(locale === "fr" ? "fr-FR" : "en-GB");
}

/**
 * The 5-step chronometered onboarding parcours.
 * @param props - {@link AdmOnboardingStepperProps}.
 * @returns The parcours element (or the forbidden/offline states).
 */
export function AdmOnboardingStepper(props: AdmOnboardingStepperProps): ReactElement {
  const {
    role,
    onClone,
    onProvision,
    onResume,
    resumeAgencyId,
    resumeOnboardingId,
    connection = "connected",
    locale = "fr",
    now = Date.now,
  } = props;

  const [state, dispatch] = useReducer(admOnboardingReducer, undefined, initialAdmOnboardingState);
  const [agencyName, setAgencyName] = useState("");
  const [sourceKind, setSourceKind] = useState<"template" | "agency">("template");
  const [sourceId, setSourceId] = useState("");
  const [tick, setTick] = useState(0);
  const resumedRef = useRef(false);

  const tr = useCallback((key: AdmOnboardKey) => tAdmOnboard(key, locale), [locale]);

  // Live chronometer — re-render each second while the parcours runs.
  useEffect(() => {
    if (state.startedAt === null || state.completedAt !== null) return;
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [state.startedAt, state.completedAt]);

  // Resume from server onboarding status on mount, once.
  useEffect(() => {
    if (resumedRef.current) return;
    if (!resumeAgencyId || !resumeOnboardingId) return;
    resumedRef.current = true;
    void onResume(resumeAgencyId, resumeOnboardingId).then((r) => {
      if (r.ok && r.status) {
        dispatch({ type: "RESUME", snapshot: resumeFromStatus(r.status) });
      }
    });
  }, [onResume, resumeAgencyId, resumeOnboardingId]);

  const handleClone = useCallback(async (): Promise<void> => {
    if (agencyName.trim().length === 0) return;
    dispatch({ type: "START_CLONE" });
    const source =
      sourceKind === "template"
        ? { name: agencyName.trim(), templateId: sourceId.trim() || undefined }
        : { name: agencyName.trim(), sourceAgencyId: sourceId.trim() || undefined };
    const r = await onClone(source);
    if (r.ok && r.agencyId && r.onboardingId) {
      dispatch({
        type: "CLONE_DONE",
        agencyId: r.agencyId,
        onboardingId: r.onboardingId,
        startedAt: r.createdAt ?? new Date(now()).toISOString(),
      });
    } else {
      dispatch({ type: "SET_ERROR", message: r.message ?? tr("admOnboard.state.error") });
    }
  }, [agencyName, sourceKind, sourceId, onClone, now, tr]);

  const handleProvision = useCallback(async (): Promise<void> => {
    if (!state.agencyId) return;
    dispatch({ type: "START_PROVISION" });
    const r = await onProvision(state.agencyId);
    if (r.ok && r.enrollment) {
      dispatch({
        type: "PROVISION_DONE",
        enrollment: r.enrollment,
        completedAt: new Date(now()).toISOString(),
      });
    } else {
      dispatch({
        type: "SET_ERROR",
        message: withReason(tr("admOnboard.kiosk.not_provisioned"), r.message ?? tr("admOnboard.state.error")),
      });
    }
  }, [state.agencyId, onProvision, now, tr]);

  // ── RBAC + offline gates ────────────────────────────────────────────────
  if (!canAccessSection(role, "onboarding")) {
    return (
      <section data-testid="adm-onboard-forbidden" aria-label={tr("admOnboard.title")} style={{ padding: "var(--space-8)" }}>
        <EmptyState title={tr("admOnboard.forbidden")} />
      </section>
    );
  }

  if (connection === "offline") {
    return (
      <section data-testid="adm-onboard-offline" aria-label={tr("admOnboard.title")} style={{ padding: "var(--space-8)" }}>
        <EmptyState title={tr("admOnboard.state.offline")} />
      </section>
    );
  }

  const step = admCurrentStep(state);
  const stepIndex = ADM_ONBOARDING_STEPS.indexOf(step);
  const stepLabels = ADM_ONBOARDING_STEPS.map((s) => tr(STEP_LABEL[s]));
  const nowMs = now() + tick * 0; // tick forces re-render; nowMs read fresh
  const elapsed = elapsedSeconds(state, nowMs);
  const underTarget = isUnderTarget(state, nowMs);
  const complete = isAdmOnboardingComplete(state);

  return (
    <section data-testid="adm-onboard-stepper" aria-label={tr("admOnboard.title")} style={{ padding: "var(--space-8)" }}>
      <Overline>{tr("admOnboard.step_of")}</Overline>
      <Heading size="xl" style={{ margin: "var(--space-1) 0 var(--space-2)" }}>
        {tr("admOnboard.title")}
      </Heading>
      <p style={subtitleStyle}>{tr("admOnboard.subtitle")}</p>
      <p className="adm-notice">{tr("admOnboard.target_notice")}</p>

      {/* Global chronometer + < 2h indicator */}
      <div
        data-testid="adm-onboard-chrono"
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-4)",
          marginBottom: "var(--space-6)",
          flexWrap: "wrap",
        }}
      >
        <span style={{ fontSize: "var(--text-sm)", color: "var(--ink-soft)" }}>
          {tr("admOnboard.chrono_label")}
        </span>
        <strong
          style={{
            fontFamily: "var(--font-mono, var(--font-text))",
            fontSize: "var(--text-lg)",
            color: "var(--ink)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {formatDuration(elapsed)}
        </strong>
        <span style={{ fontSize: "var(--text-xs)", color: "var(--ink-faint)" }}>
          {tr("admOnboard.chrono_target")} {formatDuration(ADM_ONBOARDING_TARGET_SECONDS)}
        </span>
        <Badge tone={underTarget ? "success" : "warning"}>
          {underTarget ? tr("admOnboard.under_target") : tr("admOnboard.over_target")}
        </Badge>
      </div>

      <Stepper steps={stepLabels} current={stepIndex} style={{ marginBottom: "var(--space-6)" }} />

      <div
        style={{ fontSize: "var(--text-sm)", color: "var(--ink-soft)", marginBottom: "var(--space-4)" }}
      >
        {tr("admOnboard.step_of")} {stepIndex + 1} / {ADM_ONBOARDING_STEP_COUNT}
        {" · "}
        <span data-testid="adm-onboard-step-target">
          {tr("admOnboard.step_target")} {formatDuration(ADM_STEP_TARGET_SECONDS[step])}
        </span>
      </div>

      {/* Inline error / loading feedback */}
      {state.view === "error" && state.error && (
        <div data-testid="adm-onboard-error" role="alert" className="adm-danger-note">
          <span className="adm-danger-note__icon">
            <DangerGlyph />
          </span>
          <span>{state.error}</span>
        </div>
      )}
      {state.view === "loading" && (
        <Skeleton data-testid="adm-onboard-loading" style={{ height: "1.5rem", marginBottom: "var(--space-4)" }} />
      )}
      {state.view === "provisioning" && (
        <p data-testid="adm-onboard-provisioning" style={{ color: "var(--ink-soft)", marginBottom: "var(--space-4)" }}>
          {tr("admOnboard.state.provisioning")}
        </p>
      )}

      <Card style={stepPanelStyle} data-testid={`adm-step-${step}`}>
        {step === "clone" && (
          <CloneStep
            tr={tr}
            name={agencyName}
            onName={setAgencyName}
            sourceKind={sourceKind}
            onSourceKind={setSourceKind}
            sourceId={sourceId}
            onSourceId={setSourceId}
            done={state.completed.clone}
            busy={state.view === "loading"}
            onSubmit={() => void handleClone()}
          />
        )}

        {(step === "services" || step === "counters" || step === "agents") && (
          <VerifyStep
            tr={tr}
            step={step}
            done={state.completed[step]}
            onConfirm={() => dispatch({ type: "COMPLETE_STEP", step })}
          />
        )}

        {step === "kiosk" && (
          <KioskStep
            tr={tr}
            locale={locale}
            enrollment={state.enrollment}
            busy={state.view === "provisioning"}
            onProvision={() => void handleProvision()}
          />
        )}
      </Card>

      {/* Recap — only when fully complete (kiosk done + valid QR) */}
      {complete && (
        <Recap
          tr={tr}
          totalSeconds={elapsed}
          agencyId={state.agencyId}
          kioskId={state.enrollment?.kioskId ?? null}
        />
      )}

      {/* Navigation */}
      <div style={{ display: "flex", gap: "var(--space-3)", marginTop: "var(--space-6)" }}>
        <Button
          type="button"
          variant="secondary"
          data-testid="adm-onboard-back"
          onClick={() => dispatch({ type: "BACK" })}
          disabled={state.stepIndex === 0}
        >
          {tr("admOnboard.back")}
        </Button>
        {step !== "kiosk" && (
          <Button
            type="button"
            variant="primary"
            data-testid="adm-onboard-next"
            onClick={() => dispatch({ type: "NEXT" })}
            disabled={!admCanAdvance(state)}
          >
            {tr("admOnboard.next")}
          </Button>
        )}
      </div>
    </section>
  );
}

/** Clone step — name + source (template/agency). */
function CloneStep(props: {
  tr: (k: AdmOnboardKey) => string;
  name: string;
  onName: (v: string) => void;
  sourceKind: "template" | "agency";
  onSourceKind: (v: "template" | "agency") => void;
  sourceId: string;
  onSourceId: (v: string) => void;
  done: boolean;
  busy: boolean;
  onSubmit: () => void;
}): ReactElement {
  const { tr } = props;
  return (
    <div style={{ maxWidth: "30rem", display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      <p style={{ ...stepBodyLead, marginBottom: 0 }}>{tr("admOnboard.step.clone")}</p>
      <p style={{ fontSize: "var(--text-sm)", color: "var(--ink-soft)", margin: 0 }}>
        {tr("admOnboard.clone.structural_notice")}
      </p>
      <Field
        id="adm-clone-name"
        data-testid="adm-clone-name"
        label={tr("admOnboard.clone.name_label")}
        hint={tr("admOnboard.clone.name_hint")}
        value={props.name}
        onChange={(e) => props.onName(e.target.value)}
      />
      <div>
        <p style={{ fontSize: "var(--text-sm)", color: "var(--ink-soft)", marginBottom: "var(--space-2)" }}>
          {tr("admOnboard.clone.source_label")}
        </p>
        <SegmentedControl
          data-testid="adm-clone-source"
          ariaLabel={tr("admOnboard.clone.source_label")}
          value={props.sourceKind}
          onChange={(v) => props.onSourceKind(v === "agency" ? "agency" : "template")}
          options={[
            { value: "template", label: tr("admOnboard.clone.source_template") },
            { value: "agency", label: tr("admOnboard.clone.source_agency") },
          ]}
        />
      </div>
      <Field
        id="adm-clone-template"
        data-testid="adm-clone-template"
        label={
          props.sourceKind === "template"
            ? tr("admOnboard.clone.template_id_label")
            : tr("admOnboard.clone.agency_id_label")
        }
        value={props.sourceId}
        onChange={(e) => props.onSourceId(e.target.value)}
      />
      <div>
        <Button
          type="button"
          variant="primary"
          data-testid="adm-clone-submit"
          onClick={props.onSubmit}
          disabled={props.busy}
        >
          {tr("admOnboard.clone.submit")}
        </Button>
      </div>
      {props.done && (
        <p data-testid="adm-clone-done" style={{ color: "var(--success)", fontWeight: 600, margin: 0 }}>
          {tr("admOnboard.clone.done")}
        </p>
      )}
    </div>
  );
}

/** Verify step (services / counters / agents) — confirm the cloned config. */
function VerifyStep(props: {
  tr: (k: AdmOnboardKey) => string;
  step: "services" | "counters" | "agents";
  done: boolean;
  onConfirm: () => void;
}): ReactElement {
  const { tr, step } = props;
  const intro: AdmOnboardKey =
    step === "services"
      ? "admOnboard.verify.services"
      : step === "counters"
        ? "admOnboard.verify.counters"
        : "admOnboard.agents.intro";
  const chips: AdmOnboardKey[] = STEP_RECAP_CHIPS[step];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      <p style={stepBodyLead}>{tr(STEP_LABEL_FOR[step])}</p>
      <p style={{ fontSize: "var(--text-sm)", color: "var(--ink-soft)", margin: 0 }}>{tr(intro)}</p>
      {/* Cloned-config recap — concrete chips, never a hollow paragraph. */}
      <div
        data-testid={`adm-verify-recap-${step}`}
        style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)", alignItems: "center" }}
      >
        {chips.map((k) => (
          <Badge key={k} tone="brand">
            {tr(k)}
          </Badge>
        ))}
        <Badge tone="success" dot>
          {tr("admOnboard.recap_chip.cloned")}
        </Badge>
      </div>
      <div>
        <Button type="button" variant="secondary" data-testid="adm-verify-confirm" onClick={props.onConfirm}>
          {tr("admOnboard.verify.confirm")}
        </Button>
      </div>
      {props.done && (
        <p data-testid="adm-verify-confirmed" style={{ color: "var(--success)", fontWeight: 600, margin: 0 }}>
          {tr("admOnboard.verify.confirmed")}
        </p>
      )}
    </div>
  );
}

/** Cloned-config recap chips per verify step. */
const STEP_RECAP_CHIPS: Record<"services" | "counters" | "agents", AdmOnboardKey[]> = {
  services: ["admOnboard.recap_chip.services", "admOnboard.recap_chip.sla"],
  counters: ["admOnboard.recap_chip.counters", "admOnboard.recap_chip.thresholds"],
  agents: ["admOnboard.recap_chip.agents", "admOnboard.recap_chip.roles"],
};

/** Step-label lookup restricted to the verify steps (typed helper). */
const STEP_LABEL_FOR: Record<"services" | "counters" | "agents", AdmOnboardKey> = {
  services: "admOnboard.step.services",
  counters: "admOnboard.step.counters",
  agents: "admOnboard.step.agents",
};

/** Kiosk step — provision + printable installation QR + expiry + regenerate. */
function KioskStep(props: {
  tr: (k: AdmOnboardKey) => string;
  locale: Locale;
  enrollment: KioskEnrollment | null;
  busy: boolean;
  onProvision: () => void;
}): ReactElement {
  const { tr, enrollment } = props;
  const expired = enrollment !== null && Date.parse(enrollment.expiresAt) <= Date.now();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      <p style={stepBodyLead}>{tr("admOnboard.step.kiosk")}</p>
      <p style={{ fontSize: "var(--text-sm)", color: "var(--ink-soft)", margin: 0 }}>{tr("admOnboard.kiosk.intro")}</p>

      {enrollment === null && (
        <div>
          <Button
            type="button"
            variant="primary"
            data-testid="adm-kiosk-provision"
            onClick={props.onProvision}
            disabled={props.busy}
          >
            {tr("admOnboard.kiosk.provision")}
          </Button>
        </div>
      )}

      {enrollment !== null && (
        <div
          data-testid="adm-kiosk-install-screen"
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "var(--space-3)",
            padding: "var(--space-6)",
            background: "var(--surface-1)",
            border: "1px solid var(--hairline)",
            borderRadius: "var(--r-lg)",
          }}
        >
          <QrImage value={enrollment.enrollmentQrUrl} label={tr("admOnboard.kiosk.qr_alt")} />
          <p style={{ fontSize: "var(--text-sm)", color: "var(--ink-soft)", textAlign: "center", maxWidth: "24rem", margin: 0 }}>
            {tr("admOnboard.kiosk.scan_instructions")}
          </p>
          <p data-testid="adm-kiosk-expires" style={{ fontSize: "var(--text-xs)", color: "var(--ink-faint)", margin: 0 }}>
            {tr("admOnboard.kiosk.expires_at")} {toLocaleTime(enrollment.expiresAt, props.locale)}
          </p>
          {expired && (
            <p style={{ color: "var(--danger)", fontSize: "var(--text-sm)", margin: 0 }}>
              {tr("admOnboard.kiosk.expired")}
            </p>
          )}
          <div style={{ display: "flex", gap: "var(--space-3)" }}>
            <Button
              type="button"
              variant="secondary"
              data-testid="adm-kiosk-regenerate"
              onClick={props.onProvision}
              disabled={props.busy}
            >
              {tr("admOnboard.kiosk.regenerate")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              data-testid="adm-kiosk-print"
              onClick={() => {
                if (typeof window !== "undefined" && typeof window.print === "function") window.print();
              }}
            >
              {tr("admOnboard.kiosk.print")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** QR pixel size (printable) — a plain number, not a CSS length literal. */
const QR_PIXELS = 280;

/**
 * QR image — generated LOCALLY (lib `qrcode`) as a client-side data-URL. No
 * third-party endpoint (offline-friendly, RGPD): the enrollment URL never
 * leaves the browser. The URL is always shown as accessible text so the code is
 * never the only channel (icon+text pairing, WCAG). The QR encodes the
 * enrollment URL only — never the raw token.
 */
function QrImage(props: { value: string; label: string }): ReactElement {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void QRCode.toDataURL(props.value, { width: QR_PIXELS, margin: 1, errorCorrectionLevel: "M" })
      .then((url) => {
        if (active) setDataUrl(url);
      })
      .catch(() => {
        if (active) setDataUrl(null);
      });
    return () => {
      active = false;
    };
  }, [props.value]);

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--space-2)" }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        data-testid="adm-kiosk-qr"
        src={dataUrl ?? undefined}
        alt={props.label}
        width={QR_PIXELS}
        height={QR_PIXELS}
        style={{
          width: `${QR_PIXELS / 16}rem`,
          height: `${QR_PIXELS / 16}rem`,
          borderRadius: "var(--r-md)",
          border: "1px solid var(--hairline)",
          background: "var(--surface-1)",
        }}
      />
      <code style={{ fontSize: "var(--text-xs)", color: "var(--ink-faint)", wordBreak: "break-all", maxWidth: "24rem", textAlign: "center" }}>
        {props.value}
      </code>
    </div>
  );
}

/** Final recap — measured total duration + "Agency operational". */
function Recap(props: {
  tr: (k: AdmOnboardKey) => string;
  totalSeconds: number;
  agencyId: string | null;
  kioskId: string | null;
}): ReactElement {
  const { tr } = props;
  return (
    <Card
      data-testid="adm-onboard-recap"
      style={{
        marginTop: "var(--space-6)",
        padding: "var(--space-8)",
        borderRadius: "var(--r-xl)",
        borderTop: "3px solid var(--gold)",
        background: "var(--gold-soft)",
      }}
    >
      <Overline>{tr("admOnboard.recap.title")}</Overline>
      <Heading size="xl" style={{ margin: "var(--space-1) 0 var(--space-4)", color: "var(--forest)" }}>
        {tr("admOnboard.recap.operational")}
      </Heading>
      <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "var(--space-2) var(--space-4)", margin: 0 }}>
        <DtDd term={tr("admOnboard.recap.total_duration")}>
          <strong data-testid="adm-onboard-total-duration" style={{ fontVariantNumeric: "tabular-nums" }}>
            {formatDuration(props.totalSeconds)}
          </strong>
        </DtDd>
        {props.agencyId && <DtDd term={tr("admOnboard.recap.agency_id")}>{props.agencyId}</DtDd>}
        {props.kioskId && <DtDd term={tr("admOnboard.recap.kiosk_id")}>{props.kioskId}</DtDd>}
      </dl>
    </Card>
  );
}

/** Small danger triangle glyph (icon+text pairing), colour via currentColor. */
function DangerGlyph(): ReactElement {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M8 1.5 15 14H1L8 1.5Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path d="M8 6v3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="8" cy="11.5" r="0.85" fill="currentColor" />
    </svg>
  );
}

/** A definition-list term/description pair. */
function DtDd(props: { term: string; children: ReactNode }): ReactElement {
  return (
    <>
      <dt style={{ color: "var(--ink-faint)", fontSize: "var(--text-sm)" }}>{props.term}</dt>
      <dd style={{ margin: 0, color: "var(--ink)", fontSize: "var(--text-sm)" }}>{props.children}</dd>
    </>
  );
}
