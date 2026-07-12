/**
 * tv-session — mint du token d'affichage TV public (DISPLAY, lecture seule).
 *
 * Durcissement RT-003 (couture Boucle 2 S2) : l'écran mural `/tv/{agencyId}` ne
 * réutilise JAMAIS le JWT d'un agent. Il obtient un token à privilèges MINIMAUX
 * via `POST /tv/session { agencyId }` (route PUBLIQUE du contrat, aucun Bearer,
 * aucune PII), puis le passe au handshake socket (`auth.token`) pour rejoindre la
 * room `agency:{agencyId}` en lecture seule.
 *
 * Propriétés du token (contrat CONTRACT-013) : `role="DISPLAY"`, TTL 12 h
 * (43200 s), **non renouvelable** — aucun endpoint refresh. On re-mint au reload
 * et à l'approche de l'expiration.
 *
 * Repli offline (l'un des 5 états requis) : si le mint échoue (404
 * `AGENCY_NOT_FOUND`, réseau, ou 429 après épuisement du backoff) → `status`
 * passe à `error`, aucun token n'est exposé, aucun crash. La route étant limitée
 * à 20/min/IP, un 429 est retenté en backoff en respectant `Retry-After` /
 * `details.retryAfterSeconds`.
 *
 * Codé contre le MOCK Prism / le contrat (API-First) : le vrai bout-en-bout
 * dépend du serveur intégré en parallèle.
 *
 * @module lib/tv-session
 */
"use client";

import { useEffect, useRef, useState } from "react";
import { createSigfaClient, TV_SESSION_TTL_SECONDS } from "@sigfa/contracts";
import type { RealtimeMode } from "./socket-provider";

/** Chemin de contrat public du mint de session TV (sous la base REST). */
export const TV_SESSION_PATH = "/tv/session" as const;

/** Nombre maximal de tentatives de mint sur 429 avant repli offline. */
export const TV_SESSION_MAX_ATTEMPTS = 3 as const;

/** Backoff par défaut (ms) quand aucune valeur serveur n'est fournie. */
export const TV_SESSION_DEFAULT_BACKOFF_MS = 2000 as const;

/**
 * Marge (ms) retranchée au TTL pour re-minter AVANT l'expiration réelle du
 * token (évite une fenêtre offline au moment pile de l'expiration).
 */
export const TV_SESSION_REMINT_MARGIN_MS = 60_000 as const;

/** Statut du mint de session d'affichage TV. */
export type TvSessionStatus = "idle" | "loading" | "ready" | "error";

/** Valeur exposée par {@link useTvSession}. */
export interface TvSessionState {
  /** Statut courant du mint. */
  status: TvSessionStatus;
  /** Token d'affichage DISPLAY (handshake socket), ou `undefined` si indispo. */
  accessToken: string | undefined;
}

/** Options de {@link useTvSession}. */
export interface UseTvSessionOptions {
  /** Agence dont l'écran veut rejoindre la room (`join:agency`). */
  agencyId: string;
  /** Mode temps réel : `off` → aucun mint (fixtures F4) ; `real` → mint. */
  mode: RealtimeMode;
  /** Base REST (défaut : mock Prism canonique). Injectable pour les tests. */
  apiBase: string;
}

/** Forme (partielle) d'un corps d'erreur de contrat porteur d'un backoff. */
interface ErrorBodyWithRetry {
  details?: { retryAfterSeconds?: unknown };
  error?: { details?: { retryAfterSeconds?: unknown } };
}

/**
 * Détermine le délai de backoff (en secondes) sur un 429.
 * Le corps de contrat (`details.retryAfterSeconds`) prime sur l'en-tête HTTP
 * `Retry-After` (secondes). Retourne `null` si aucune valeur exploitable.
 *
 * @param retryAfterHeader - Valeur brute de l'en-tête `Retry-After`, ou null.
 * @param body             - Corps d'erreur (possiblement porteur du backoff).
 * @returns Le délai en secondes, ou `null`.
 */
export function parseRetryAfterSeconds(
  retryAfterHeader: string | null,
  body: unknown,
): number | null {
  const b = (body ?? {}) as ErrorBodyWithRetry;
  const fromBody = b.details?.retryAfterSeconds ?? b.error?.details?.retryAfterSeconds;
  if (typeof fromBody === "number" && Number.isFinite(fromBody) && fromBody >= 0) {
    return fromBody;
  }
  if (retryAfterHeader !== null) {
    const parsed = Number(retryAfterHeader);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return null;
}

/** Résultat interne d'une tentative de mint. */
type MintOutcome =
  | { kind: "ok"; accessToken: string; expiresIn: number }
  | { kind: "retry"; delayMs: number }
  | { kind: "fail" };

/**
 * Effectue une tentative de mint du token DISPLAY via le client typé public.
 * @param apiBase  - Base REST du contrat public.
 * @param agencyId - Agence cible.
 * @returns L'issue de la tentative ({@link MintOutcome}).
 */
async function mintOnce(apiBase: string, agencyId: string): Promise<MintOutcome> {
  const client = createSigfaClient("public", apiBase);
  try {
    const { data, error, response } = await client.POST(TV_SESSION_PATH, {
      body: { agencyId },
    });
    if (data && typeof data.accessToken === "string") {
      return { kind: "ok", accessToken: data.accessToken, expiresIn: data.expiresIn };
    }
    if (response.status === 429) {
      const seconds = parseRetryAfterSeconds(response.headers.get("retry-after"), error);
      const delayMs =
        seconds !== null ? seconds * 1000 : TV_SESSION_DEFAULT_BACKOFF_MS;
      return { kind: "retry", delayMs };
    }
    return { kind: "fail" };
  } catch {
    // Réseau / handshake indisponible → repli offline, jamais de crash.
    return { kind: "fail" };
  }
}

/**
 * Hook de session d'affichage TV : mint le token DISPLAY et le maintient.
 *
 * - `off` → n'appelle rien (fixtures F4), reste `idle`.
 * - `real` → mint au montage ; retry borné en backoff sur 429 ; re-mint
 *   programmé avant l'expiration (TTL 12 h, aucun refresh). Tout échec durable
 *   → `error` + token absent (repli offline côté écran).
 *
 * @param options - {@link UseTvSessionOptions}.
 * @returns L'état de session ({@link TvSessionState}).
 */
export function useTvSession(options: UseTvSessionOptions): TvSessionState {
  const { agencyId, mode, apiBase } = options;
  const [status, setStatus] = useState<TvSessionStatus>(
    mode === "real" ? "loading" : "idle",
  );
  const [accessToken, setAccessToken] = useState<string | undefined>(undefined);
  const remintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (mode !== "real") {
      setStatus("idle");
      setAccessToken(undefined);
      return;
    }

    let cancelled = false;
    let attempts = 0;

    function clearRemint(): void {
      if (remintTimer.current !== null) {
        clearTimeout(remintTimer.current);
        remintTimer.current = null;
      }
    }

    async function run(): Promise<void> {
      setStatus("loading");
      // Boucle de mint avec backoff borné sur 429.
      for (;;) {
        if (cancelled) return;
        attempts += 1;
        const outcome = await mintOnce(apiBase, agencyId);
        if (cancelled) return;

        if (outcome.kind === "ok") {
          setAccessToken(outcome.accessToken);
          setStatus("ready");
          // Re-mint programmé avant expiration (aucun refresh — nouveau mint).
          const ttlMs =
            (outcome.expiresIn > 0 ? outcome.expiresIn : TV_SESSION_TTL_SECONDS) * 1000;
          const delay = Math.max(0, ttlMs - TV_SESSION_REMINT_MARGIN_MS);
          clearRemint();
          remintTimer.current = setTimeout(() => {
            attempts = 0;
            void run();
          }, delay);
          return;
        }

        if (outcome.kind === "retry" && attempts < TV_SESSION_MAX_ATTEMPTS) {
          await new Promise((r) => setTimeout(r, outcome.delayMs));
          continue;
        }

        // Échec durable (fail, ou 429 après épuisement) → repli offline.
        setAccessToken(undefined);
        setStatus("error");
        return;
      }
    }

    void run();

    return () => {
      cancelled = true;
      clearRemint();
    };
  }, [agencyId, mode, apiBase]);

  return { status, accessToken };
}
