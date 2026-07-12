/**
 * KIOSK-007 — Heartbeat borne : chemin RÉEL de signalement imprimante.
 *
 * La borne ne fait PAS d'émission socket directe (le `POST /kiosk/alert` a été
 * rejeté à l'arbitrage). Elle SIGNALE son statut via le heartbeat du contrat :
 *   `POST /kiosks/{kioskId}/heartbeat` (schéma `HeartbeatRequest`).
 * Le SERVEUR, en recevant un `printerStatus != OK`, émet lui-même
 * `kiosk:printer-error` vers le dashboard manager (cf. entête OpenAPI).
 *
 * En F4 (mock Prism :4010, sockets simulés), on VÉRIFIE l'intention d'émission
 * via l'émetteur simulé {@link signalPrinterError} — AUCUNE connexion socket
 * réelle n'est ouverte. Le heartbeat, lui, est un vrai appel HTTP du contrat
 * (`@sigfa/contracts`), conforme à la convention API-First.
 *
 * @module hooks/useKioskHeartbeat
 */
"use client";

import { useCallback } from "react";
import { createSigfaClient } from "@sigfa/contracts";
import {
  ensureKioskSession,
  getKioskSessionToken,
} from "@/lib/kiosk-session-store";
import type { PrinterStatus } from "@/hooks/useDegradedState";
import {
  signalPrinterError,
  noopDegradedSink,
  type DegradedEventSink,
} from "@/lib/kiosk-degraded-emitter";

/** Version applicative borne remontée dans le heartbeat (semver). */
const KIOSK_APP_VERSION = "1.0.0";

/** Paramètres d'un envoi de heartbeat. */
export interface HeartbeatParams {
  /** Identifiant de la borne (path param). */
  kioskId: string;
  /** Identifiant de l'agence (pour le payload `kiosk:printer-error` simulé). */
  agencyId: string;
  /** Statut imprimante courant. */
  printerStatus: PrinterStatus;
  /** Durée de fonctionnement en secondes (défaut 0). */
  uptimeSeconds?: number;
}

/** Résultat d'un heartbeat. */
export interface HeartbeatResult {
  /** Vrai si le POST heartbeat a réussi (200). */
  ok: boolean;
  /**
   * Vrai si un signalement `kiosk:printer-error` a été émis (SIMULÉ F4). En
   * production ce booléen n'a pas d'effet réseau : l'émission réelle appartient
   * au serveur qui reçoit le heartbeat.
   */
  printerErrorSignalled: boolean;
}

/** Options du hook (injection du sink simulé pour les tests). */
export interface UseKioskHeartbeatOptions {
  /** Sink d'événement simulé (défaut : no-op). */
  sink?: DegradedEventSink;
  /** URL de l'API (défaut : mock canonique :4010). */
  apiUrl?: string;
}

/**
 * Retourne une fonction `sendHeartbeat` qui POST le heartbeat borne et, si
 * `printerStatus != OK`, signale (simulé F4) l'erreur imprimante.
 *
 * @param options - {@link UseKioskHeartbeatOptions}.
 * @returns `{ sendHeartbeat }`.
 */
export function useKioskHeartbeat(options: UseKioskHeartbeatOptions = {}): {
  sendHeartbeat: (params: HeartbeatParams) => Promise<HeartbeatResult>;
} {
  const sink = options.sink ?? noopDegradedSink;
  const apiUrl = options.apiUrl ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4010";

  const sendHeartbeat = useCallback(
    async (params: HeartbeatParams): Promise<HeartbeatResult> => {
      // S5 : le heartbeat exige le token de session borne (contrat public,
      // scope agency). Session garantie/RE-CRÉÉE avant l'appel ; sans session
      // (borne dégradée), le POST part sans Bearer et échoue proprement.
      await ensureKioskSession();
      const token = getKioskSessionToken();
      const client = createSigfaClient(
        "public",
        apiUrl,
        token ? { token } : {}
      );

      let ok = false;
      try {
        const { response } = await client.POST("/kiosks/{kioskId}/heartbeat", {
          params: { path: { kioskId: params.kioskId } },
          body: {
            printerStatus: params.printerStatus,
            appVersion: KIOSK_APP_VERSION,
            uptimeSeconds: params.uptimeSeconds ?? 0,
          },
        });
        ok = response.status === 200;
      } catch {
        ok = false;
      }

      // printerStatus != OK → le SERVEUR émet kiosk:printer-error (chemin réel).
      // En F4 on signale l'intention via l'émetteur simulé, sans délai.
      let printerErrorSignalled = false;
      if (params.printerStatus !== "OK") {
        printerErrorSignalled = signalPrinterError(
          {
            kioskId: params.kioskId,
            agencyId: params.agencyId,
            since: new Date().toISOString(),
          },
          sink
        );
      }

      return { ok, printerErrorSignalled };
    },
    [apiUrl, sink]
  );

  return { sendHeartbeat };
}
