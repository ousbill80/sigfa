/**
 * use-adm-theme.ts — theming console data workflow (ADM-001b).
 *
 * Every call goes through the typed @sigfa/contracts `admin` client on the
 * canonical, contract-declared routes only:
 *  - GET   /banks/{id}/theme           → load requested/applied colours + messages
 *  - PATCH /banks/{id}/theme           → persist requestedColors + welcomeMessages
 *  - POST  /banks/{id}/theme/logo      → multipart logo upload (INVALID_LOGO → inline)
 *
 * X-Idempotency-Key (UUID v4): the ADM-001b story requires it on the theme
 * PATCH. The contract types the PATCH `header` as `never`, so the key is NOT
 * passed as a typed `params.header` (that would be off-contract); it is attached
 * via the request `headers` init, which openapi-fetch forwards verbatim. The
 * request therefore stays on-contract while carrying the idempotency key.
 *
 * Five states are surfaced through `status`: loading / ready / empty / error /
 * offline. Offline blocks every mutation up-front.
 *
 * @module lib/use-adm-theme
 */
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createSigfaClient } from "@sigfa/contracts";
import { translateThemeError, toRequestedColors, type WelcomeMessages } from "./adm-theme";
import type { Locale } from "./i18n";

/** Typed admin client (theme routes). */
export type AdminThemeClient = ReturnType<typeof createSigfaClient<"admin">>;

/** The five screen states (nominal maps to `ready`). */
export type ThemeStatus = "loading" | "ready" | "empty" | "error" | "offline";

/** The theme as returned by GET /banks/{id}/theme (subset the console uses). */
export interface LoadedTheme {
  /** The requested primary (`--brand`) colour. */
  brand: string;
  /** Welcome messages (FR required). */
  welcomeMessages: WelcomeMessages;
  /** Current logo URL (null when none). */
  logoUrl: string | null;
}

/** Result of a mutation attempt (drives inline error / success feedback). */
export interface ThemeMutationResult {
  ok: boolean;
  /** Human, namespaced message on failure (never a raw code). */
  message?: string;
  /** On a successful save/upload, the effective (persisted) theme. */
  theme?: LoadedTheme;
}

/** Options for {@link useAdmTheme}. */
export interface UseAdmThemeOptions {
  /** Typed admin client. */
  admin: AdminThemeClient;
  /** Bank id (BANK_ADMIN scope). */
  bankId: string;
  /** Locale for human error messages. */
  locale?: Locale;
}

/** Result of {@link useAdmTheme}. */
export interface UseAdmThemeResult {
  status: ThemeStatus;
  /** The loaded theme once ready (null otherwise). */
  theme: LoadedTheme | null;
  /** Force offline (used to lock the form when connectivity drops). */
  setOffline: (offline: boolean) => void;
  /** Re-fetch the theme (GET). */
  reload: () => Promise<void>;
  /** Persist brand + welcome messages (PATCH with X-Idempotency-Key). */
  saveTheme: (draft: { brand: string; welcomeMessages: WelcomeMessages }) => Promise<ThemeMutationResult>;
  /** Upload a logo (POST multipart). 422 INVALID_LOGO → inline, old logo kept. */
  uploadLogo: (file: File) => Promise<ThemeMutationResult>;
}

/** UUID v4 generator (idempotency key). */
function idempotencyKey(): string {
  return crypto.randomUUID();
}

/** Parse a GET /theme response body into the console's LoadedTheme shape. */
function toLoadedTheme(data: unknown): LoadedTheme | null {
  const body = data as
    | {
        requestedColors?: { primary?: string };
        appliedColors?: { primary?: string };
        welcomeMessages?: { fr?: string; en?: string };
        logoUrl?: string | null;
      }
    | undefined;
  if (!body) return null;
  const brand = body.requestedColors?.primary ?? body.appliedColors?.primary;
  const fr = body.welcomeMessages?.fr;
  if (typeof brand !== "string" || typeof fr !== "string") return null;
  return {
    brand,
    welcomeMessages: { fr, en: body.welcomeMessages?.en },
    logoUrl: body.logoUrl ?? null,
  };
}

/**
 * Theming console workflow hook — GET/PATCH/logo on contract routes only.
 * @param options - {@link UseAdmThemeOptions}.
 * @returns {@link UseAdmThemeResult}.
 */
export function useAdmTheme(options: UseAdmThemeOptions): UseAdmThemeResult {
  const { admin, bankId, locale = "fr" } = options;
  const [status, setStatus] = useState<ThemeStatus>("loading");
  const [theme, setTheme] = useState<LoadedTheme | null>(null);
  const [forcedOffline, setForcedOffline] = useState(false);

  const setOffline = useCallback((offline: boolean): void => {
    setForcedOffline(offline);
    if (offline) setStatus("offline");
  }, []);

  const reload = useCallback(async (): Promise<void> => {
    if (forcedOffline) {
      setStatus("offline");
      return;
    }
    setStatus("loading");
    const { data, error } = await admin.GET("/banks/{id}/theme", {
      params: { path: { id: bankId } },
    });
    if (error || !data) {
      setStatus("error");
      return;
    }
    const loaded = toLoadedTheme(data);
    if (!loaded) {
      setStatus("empty");
      setTheme(null);
      return;
    }
    setTheme(loaded);
    setStatus("ready");
  }, [admin, bankId, forcedOffline]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const saveTheme = useCallback<UseAdmThemeResult["saveTheme"]>(
    async (draft) => {
      if (forcedOffline) {
        return { ok: false, message: translateThemeError({ error: { code: "OFFLINE" } }, locale) };
      }
      const { data, error, response } = await admin.PATCH("/banks/{id}/theme", {
        params: { path: { id: bankId } },
        body: {
          requestedColors: toRequestedColors(draft.brand),
          welcomeMessages: draft.welcomeMessages,
        },
        // X-Idempotency-Key attached via request init (contract types header as
        // never; openapi-fetch forwards this header verbatim — stays on-contract).
        headers: { "X-Idempotency-Key": idempotencyKey() },
      });
      if (error) {
        return { ok: false, message: translateThemeError(error, locale) };
      }
      const loaded = toLoadedTheme(data);
      if (loaded) setTheme(loaded);
      setStatus("ready");
      return { ok: true, theme: loaded ?? undefined };
    },
    [admin, bankId, forcedOffline, locale],
  );

  const uploadLogo = useCallback<UseAdmThemeResult["uploadLogo"]>(
    async (file) => {
      if (forcedOffline) {
        return { ok: false, message: translateThemeError({ error: { code: "OFFLINE" } }, locale) };
      }
      const form = new FormData();
      form.append("file", file);
      const { data, error } = await admin.POST("/banks/{id}/theme/logo", {
        params: { path: { id: bankId } },
        // Multipart body — openapi-fetch forwards FormData as-is. The client
        // default `Content-Type: application/json` is dropped so fetch sets the
        // correct `multipart/form-data; boundary=…` header itself.
        body: form as unknown as { file: string },
        headers: { "Content-Type": null },
      });
      if (error) {
        // 422 INVALID_LOGO / network → inline message; old logo stays active.
        return { ok: false, message: translateThemeError(error, locale) };
      }
      const logoUrl = (data as { logoUrl?: string } | undefined)?.logoUrl ?? null;
      setTheme((prev) => (prev ? { ...prev, logoUrl } : prev));
      return { ok: true };
    },
    [admin, bankId, forcedOffline, locale],
  );

  return useMemo(
    () => ({ status, theme, setOffline, reload, saveTheme, uploadLogo }),
    [status, theme, setOffline, reload, saveTheme, uploadLogo],
  );
}
