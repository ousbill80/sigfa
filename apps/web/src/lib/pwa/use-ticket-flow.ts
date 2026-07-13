/**
 * NOTIF-005-B — 3-step ticket flow state machine (aligned on the kiosk).
 *
 * Steps: `service` (choose) → `confirm` (optional phone + consent) → `ticket`
 * (Moment Ticket + live tracking). Mirrors the kiosk parcours. Emission goes
 * through the QR channel with a stable idempotency key so a double-tap or a
 * reconnection replays the same ticket (24 h idempotency window, CONTRACT-003).
 *
 * @module lib/pwa/use-ticket-flow
 */
"use client";

import { useCallback, useMemo, useState } from "react";
import { emitQrTicket, type PublicTicketCreated } from "./pwa-client";
import { hasPhone, isValidPhone, normalizePhone } from "./pwa-validation";

/** Ordered steps of the flow (drives the Stepper). */
export const FLOW_STEPS = ["service", "confirm", "ticket"] as const;
export type FlowStep = (typeof FLOW_STEPS)[number];

/** Emission status inside the confirm step. */
export type EmitStatus = "idle" | "submitting" | "error";

/**
 * Human-mappable reason for an emission failure. Derived from the HTTP status
 * and the opaque contract error code so the confirm step can show a distinct,
 * humane message instead of swallowing the failure silently.
 */
export type EmitErrorReason =
  | "offline"
  | "conflict"
  | "rate_limited"
  | "validation"
  | "generic";

/** Public API of {@link useTicketFlow}. */
export interface TicketFlow {
  readonly step: FlowStep;
  readonly stepIndex: number;
  readonly selectedServiceId: string | null;
  readonly phone: string;
  readonly consent: boolean;
  readonly emitStatus: EmitStatus;
  /** Set only while {@link emitStatus} is `"error"` — drives the humane copy. */
  readonly emitError: EmitErrorReason | null;
  readonly created: PublicTicketCreated | null;
  /** True when the current phone input is acceptable for submission. */
  readonly canSubmit: boolean;
  readonly selectService: (serviceId: string) => void;
  readonly setPhone: (value: string) => void;
  readonly setConsent: (value: boolean) => void;
  readonly back: () => void;
  readonly submit: () => Promise<void>;
  /** Re-attempts the last emission, replaying the same idempotency key. */
  readonly retry: () => Promise<void>;
  readonly reset: () => void;
}

/** Options for {@link useTicketFlow}. */
export interface TicketFlowOptions {
  readonly baseUrl: string;
  readonly agencyId: string;
  /** Idempotency key factory (injectable for tests). */
  readonly makeKey?: () => string;
}

/**
 * Maps a failed {@link PwaResult} to a human-mappable reason.
 * A status of `0` means the request never reached the server (offline / DNS).
 */
function emitErrorReason(status: number, code?: string): EmitErrorReason {
  if (status === 0) return "offline";
  if (status === 429 || code === "TOO_MANY_REQUESTS") return "rate_limited";
  if (status === 409 || code === "IDEMPOTENCY_CONFLICT") return "conflict";
  if (status === 400 || status === 422 || code === "VALIDATION_ERROR") return "validation";
  return "generic";
}

/** Default idempotency key: crypto UUID when available, else timestamp+random. */
function defaultMakeKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `qr-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Drives the 3-step public ticket flow.
 *
 * @param options - Base URL, resolved agencyId, optional key factory.
 * @returns The flow state and transitions.
 */
export function useTicketFlow(options: TicketFlowOptions): TicketFlow {
  const { baseUrl, agencyId, makeKey = defaultMakeKey } = options;

  const [step, setStep] = useState<FlowStep>("service");
  const [selectedServiceId, setSelectedServiceId] = useState<string | null>(null);
  const [phone, setPhoneState] = useState("");
  const [consent, setConsent] = useState(false);
  const [emitStatus, setEmitStatus] = useState<EmitStatus>("idle");
  const [emitError, setEmitError] = useState<EmitErrorReason | null>(null);
  const [created, setCreated] = useState<PublicTicketCreated | null>(null);
  // Stable idempotency key per attempt — created lazily at first submit.
  const [idemKey, setIdemKey] = useState<string | null>(null);

  const selectService = useCallback((serviceId: string) => {
    setSelectedServiceId(serviceId);
    setEmitStatus("idle");
    setEmitError(null);
    setStep("confirm");
  }, []);

  const setPhone = useCallback((value: string) => {
    setPhoneState(value);
    if (normalizePhone(value).length === 0) setConsent(false);
    setEmitStatus("idle");
    setEmitError(null);
  }, []);

  const back = useCallback(() => {
    setStep((s) => (s === "confirm" ? "service" : s));
    setEmitStatus("idle");
    setEmitError(null);
  }, []);

  const phoneProvided = hasPhone(phone);
  const canSubmit = useMemo(() => {
    if (!selectedServiceId) return false;
    if (!isValidPhone(phone)) return false;
    if (phoneProvided && !consent) return false;
    return true;
  }, [selectedServiceId, phone, phoneProvided, consent]);

  const submit = useCallback(async () => {
    if (!selectedServiceId || !canSubmit) return;
    const key = idemKey ?? makeKey();
    if (!idemKey) setIdemKey(key);
    setEmitStatus("submitting");
    setEmitError(null);
    const normalized = normalizePhone(phone);
    const res = await emitQrTicket(baseUrl, {
      agencyId,
      serviceId: selectedServiceId,
      ...(normalized.length > 0 ? { phoneNumber: normalized, smsConsent: consent } : {}),
      idempotencyKey: key,
    });
    if (res.ok) {
      setCreated(res.data);
      setEmitStatus("idle");
      setEmitError(null);
      setStep("ticket");
    } else {
      // Surface the failure — never swallow it. The stable idempotency key is
      // kept so `retry` replays the same emission (no duplicate ticket).
      setEmitStatus("error");
      setEmitError(emitErrorReason(res.status, res.code));
    }
  }, [selectedServiceId, canSubmit, idemKey, makeKey, phone, baseUrl, agencyId, consent]);

  // Retry re-runs the same submit: the idempotency key was persisted on the
  // first attempt, so a replay resolves to the same ticket (CONTRACT-003).
  const retry = submit;

  const reset = useCallback(() => {
    setStep("service");
    setSelectedServiceId(null);
    setPhoneState("");
    setConsent(false);
    setEmitStatus("idle");
    setEmitError(null);
    setCreated(null);
    setIdemKey(null);
  }, []);

  const stepIndex = FLOW_STEPS.indexOf(step);

  return {
    step,
    stepIndex,
    selectedServiceId,
    phone,
    consent,
    emitStatus,
    emitError,
    created,
    canSubmit,
    selectService,
    setPhone,
    setConsent,
    back,
    submit,
    retry,
    reset,
  };
}
