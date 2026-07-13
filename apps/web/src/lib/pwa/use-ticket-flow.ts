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

/** Public API of {@link useTicketFlow}. */
export interface TicketFlow {
  readonly step: FlowStep;
  readonly stepIndex: number;
  readonly selectedServiceId: string | null;
  readonly phone: string;
  readonly consent: boolean;
  readonly emitStatus: EmitStatus;
  readonly created: PublicTicketCreated | null;
  /** True when the current phone input is acceptable for submission. */
  readonly canSubmit: boolean;
  readonly selectService: (serviceId: string) => void;
  readonly setPhone: (value: string) => void;
  readonly setConsent: (value: boolean) => void;
  readonly back: () => void;
  readonly submit: () => Promise<void>;
  readonly reset: () => void;
}

/** Options for {@link useTicketFlow}. */
export interface TicketFlowOptions {
  readonly baseUrl: string;
  readonly agencyId: string;
  /** Idempotency key factory (injectable for tests). */
  readonly makeKey?: () => string;
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
  const [created, setCreated] = useState<PublicTicketCreated | null>(null);
  // Stable idempotency key per attempt — created lazily at first submit.
  const [idemKey, setIdemKey] = useState<string | null>(null);

  const selectService = useCallback((serviceId: string) => {
    setSelectedServiceId(serviceId);
    setEmitStatus("idle");
    setStep("confirm");
  }, []);

  const setPhone = useCallback((value: string) => {
    setPhoneState(value);
    if (normalizePhone(value).length === 0) setConsent(false);
    setEmitStatus("idle");
  }, []);

  const back = useCallback(() => {
    setStep((s) => (s === "confirm" ? "service" : s));
    setEmitStatus("idle");
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
      setStep("ticket");
    } else {
      setEmitStatus("error");
    }
  }, [selectedServiceId, canSubmit, idemKey, makeKey, phone, baseUrl, agencyId, consent]);

  const reset = useCallback(() => {
    setStep("service");
    setSelectedServiceId(null);
    setPhoneState("");
    setConsent(false);
    setEmitStatus("idle");
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
    created,
    canSubmit,
    selectService,
    setPhone,
    setConsent,
    back,
    submit,
    reset,
  };
}
