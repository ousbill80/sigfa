/**
 * use-adm-onboarding.ts — ADM-002b onboarding workflow hook.
 *
 * Drives the NEW clone/provision/onboarding routes (ADM-002a) through the typed
 * @sigfa/contracts admin client, on canonical routes only:
 *  - POST /banks/{id}/agencies:clone         → clone + start onboarding
 *  - POST /agencies/{id}/kiosks:provision     → provision kiosk + installation QR
 *  - GET  /agencies/{id}/onboarding/{id}      → onboarding status (resume)
 *
 * The raw `enrollmentToken` returned by :provision is NEVER surfaced to the UI:
 * the hook exposes only the QR url + expiry (the QR encodes the enrollment URL,
 * never the token in clear). Offline blocks every mutation up-front. Errors are
 * translated to human messages (never a raw code) via admin-errors.
 * @module lib/use-adm-onboarding
 */
"use client";

import { useCallback, useMemo, useState } from "react";
import { createSigfaClient } from "@sigfa/contracts";
import { translateApiError } from "./admin-errors";
import { tAdmOnboard } from "./adm-onboarding-i18n";
import type { KioskEnrollment, ServerOnboardingStatus } from "./adm-onboarding";
import type { Locale } from "./i18n";

/** Typed admin client (clone/provision/onboarding). */
export type AdminClient = ReturnType<typeof createSigfaClient<"admin">>;

/** Connection status driving the offline lock. */
export type OnboardingConnection = "connected" | "offline";

/** A source for the clone: exactly one of templateId / sourceAgencyId. */
export interface CloneSource {
  name: string;
  templateId?: string;
  sourceAgencyId?: string;
}

/** Result of a clone attempt. */
export interface CloneResult {
  ok: boolean;
  agencyId?: string;
  onboardingId?: string;
  createdAt?: string;
  /** Human message (translated, never a raw code) on failure. */
  message?: string;
}

/** Result of a kiosk provision attempt (raw token never included). */
export interface ProvisionResult {
  ok: boolean;
  enrollment?: KioskEnrollment;
  message?: string;
}

/** Result of an onboarding-status fetch. */
export interface OnboardingStatusResult {
  ok: boolean;
  status?: ServerOnboardingStatus;
  message?: string;
}

/** Options for {@link useAdmOnboarding}. */
export interface UseAdmOnboardingOptions {
  admin: AdminClient;
  /** The bank id (BANK_ADMIN scope) — clone route. */
  bankId: string;
  /** Active locale for offline/error messages. */
  locale?: Locale;
}

/** Result of {@link useAdmOnboarding}. */
export interface UseAdmOnboardingResult {
  connection: OnboardingConnection;
  setConnection: (s: OnboardingConnection) => void;
  /** Clone an agency + start onboarding (POST /banks/{id}/agencies:clone). */
  cloneAgency: (source: CloneSource) => Promise<CloneResult>;
  /** Provision a kiosk + get the installation QR (POST /agencies/{id}/kiosks:provision). */
  provisionKiosk: (agencyId: string) => Promise<ProvisionResult>;
  /** Fetch onboarding status for resume (GET /agencies/{id}/onboarding/{id}). */
  getOnboarding: (agencyId: string, onboardingId: string) => Promise<OnboardingStatusResult>;
}

/**
 * Onboarding workflow hook — all mutations go through the typed admin client on
 * the canonical clone/provision/onboarding routes only. Offline blocks every
 * mutation before any network call.
 * @param options - {@link UseAdmOnboardingOptions}.
 * @returns {@link UseAdmOnboardingResult}.
 */
export function useAdmOnboarding(options: UseAdmOnboardingOptions): UseAdmOnboardingResult {
  const { admin, bankId, locale = "fr" } = options;
  const [connection, setConnectionState] = useState<OnboardingConnection>("connected");

  const setConnection = useCallback((s: OnboardingConnection): void => {
    setConnectionState(s);
  }, []);

  const offlineMessage = useCallback(
    (): string => tAdmOnboard("admOnboard.state.offline", locale),
    [locale],
  );

  const cloneAgency = useCallback<UseAdmOnboardingResult["cloneAgency"]>(
    async (source) => {
      if (connection === "offline") return { ok: false, message: offlineMessage() };
      const body: { name: string; templateId?: string; sourceAgencyId?: string } = {
        name: source.name,
      };
      if (source.templateId) body.templateId = source.templateId;
      if (source.sourceAgencyId) body.sourceAgencyId = source.sourceAgencyId;
      const { data, error, response } = await admin.POST("/banks/{id}/agencies:clone", {
        params: { path: { id: bankId } },
        body,
      });
      if (error || !data) {
        return { ok: false, message: translateApiError(error, response?.status === 409) };
      }
      const d = data as { agencyId: string; onboardingId: string; createdAt: string };
      return { ok: true, agencyId: d.agencyId, onboardingId: d.onboardingId, createdAt: d.createdAt };
    },
    [admin, bankId, connection, offlineMessage],
  );

  const provisionKiosk = useCallback<UseAdmOnboardingResult["provisionKiosk"]>(
    async (agencyId) => {
      if (connection === "offline") return { ok: false, message: offlineMessage() };
      const { data, error, response } = await admin.POST("/agencies/{id}/kiosks:provision", {
        params: { path: { id: agencyId } },
      });
      if (error || !data) {
        return { ok: false, message: translateApiError(error, response?.status === 409) };
      }
      const d = data as {
        kioskId: string;
        enrollmentQrUrl: string;
        expiresAt: string;
      };
      // Deliberately drop `enrollmentToken`: the UI only ever sees the QR url +
      // expiry (the token must never leave the transport layer).
      const enrollment: KioskEnrollment = {
        kioskId: d.kioskId,
        enrollmentQrUrl: d.enrollmentQrUrl,
        expiresAt: d.expiresAt,
      };
      return { ok: true, enrollment };
    },
    [admin, connection, offlineMessage],
  );

  const getOnboarding = useCallback<UseAdmOnboardingResult["getOnboarding"]>(
    async (agencyId, onboardingId) => {
      const { data, error, response } = await admin.GET("/agencies/{id}/onboarding/{onboardingId}", {
        params: { path: { id: agencyId, onboardingId } },
      });
      if (error || !data) {
        return { ok: false, message: translateApiError(error, response?.status === 409) };
      }
      return { ok: true, status: data as ServerOnboardingStatus };
    },
    [admin],
  );

  return useMemo(
    () => ({ connection, setConnection, cloneAgency, provisionKiosk, getOnboarding }),
    [connection, setConnection, cloneAgency, provisionKiosk, getOnboarding],
  );
}
