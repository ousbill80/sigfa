/**
 * SocketProvider — RT-001b : client socket.io réel activé.
 *
 * Bascule par variable d'env (aucun fork de code) :
 *   - `NEXT_PUBLIC_REALTIME_MODE=real` → ouvre `io(url, { auth: { token } })`,
 *     `join:agency`, `sync:request` au (re)connect, consomme les événements
 *     typés du CONTRAT (`@sigfa/contracts`).
 *   - défaut (`off`/mock) → provider `inactive`, aucune connexion (comportement
 *     F4 inchangé : les surfaces gardent leurs fixtures simulées).
 *
 * Événements consommés (forme CONTRAT, validés par Zod) :
 *   - TV : `ticket:called` + `sync:state.recentCalls`
 *   - dashboards agent/manager (WEB-002/003) : `queue:updated` + `counter:status`
 *
 * États d'échec (D7) : handshake refusé (`connect_error` UNAUTHORIZED / borne
 * révoquée / JWT expiré) → état `error` + repli offline, PAS de boucle de
 * reconnexion infinie (tentatives bornées). `error:forbidden` → non-crash.
 *
 * Note : le token JWT web vit dans un cookie httpOnly (invisible au JS client) ;
 * il est fourni au provider via prop `token` par la couche appelante (route
 * serveur qui hydrate la page). Mobile = PENDING (polling), hors RT-001.
 *
 * @module lib/socket-provider
 */
"use client";

import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactElement,
} from "react";
import { io, type Socket } from "socket.io-client";
import {
  queueUpdatedEvent,
  counterStatusEvent,
  type QueueUpdatedPayload,
  type CounterStatusPayload,
} from "@sigfa/contracts";
import { tvReducer, initialTvState, type TvState } from "./tv-state";

/** Statut de connexion du provider socket. */
export type SocketStatus = "inactive" | "connecting" | "connected" | "error";

/** Mode de fonctionnement (dérivé de NEXT_PUBLIC_REALTIME_MODE). */
export type RealtimeMode = "off" | "real";

/** Nombre maximal de tentatives de reconnexion avant de rester en `error`. */
export const MAX_RECONNECTION_ATTEMPTS = 3 as const;

/** État consommé par les dashboards agent/manager (WEB-002/003). */
export interface DashboardRealtime {
  /** Dernier `queue:updated` reçu (forme contrat), ou null. */
  lastQueueUpdate: QueueUpdatedPayload | null;
  /** Dernier `counter:status` reçu (forme contrat), ou null. */
  lastCounterStatus: CounterStatusPayload | null;
}

/** Forme du contexte socket exposée par {@link useSocket}. */
export interface SocketContextValue {
  /** Vrai quand le socket est connecté. */
  connected: boolean;
  /** Statut courant du provider. */
  status: SocketStatus;
  /** État TV (hero + previous + queue), alimenté par ticket:called / sync:state. */
  tv: TvState;
  /** État temps réel des dashboards (queue:updated / counter:status). */
  dashboard: DashboardRealtime;
}

const defaultValue: SocketContextValue = {
  connected: false,
  status: "inactive",
  tv: initialTvState,
  dashboard: { lastQueueUpdate: null, lastCounterStatus: null },
};

const SocketContext = createContext<SocketContextValue>(defaultValue);

/** Props du {@link SocketProvider}. */
export interface SocketProviderProps {
  /** Enfants React. */
  children: React.ReactNode;
  /**
   * Mode temps réel. Défaut : `NEXT_PUBLIC_REALTIME_MODE` (sinon `off`).
   * `real` → connexion socket réelle ; toute autre valeur → inactif (F4).
   */
  mode?: RealtimeMode;
  /** URL de l'API socket. Défaut : `NEXT_PUBLIC_API_URL` (mock canonique :4010). */
  url?: string;
  /** Token JWT (fourni par la couche serveur — cookie httpOnly). */
  token?: string;
  /** Agence à rejoindre (`join:agency`), dérivée du scope tenant du JWT. */
  agencyId?: string;
}

/** Défaut mock canonique unifié web/kiosk (mock Prism). */
const DEFAULT_MOCK_URL = "http://localhost:4010";

function resolveMode(explicit: RealtimeMode | undefined): RealtimeMode {
  if (explicit) return explicit;
  return process.env.NEXT_PUBLIC_REALTIME_MODE === "real" ? "real" : "off";
}

function resolveUrl(explicit: string | undefined): string {
  return explicit ?? process.env.NEXT_PUBLIC_API_URL ?? DEFAULT_MOCK_URL;
}

/**
 * SocketProvider — enveloppe l'app avec le contexte socket.
 *
 * En mode `real` : ouvre la connexion, rejoint la room d'agence, demande un
 * resync au (re)connect et applique le snapshot (remplacement d'état). En mode
 * `off`/mock : reste `inactive` (aucune connexion), les surfaces gardent leurs
 * fixtures F4.
 *
 * @param props - {@link SocketProviderProps}.
 * @returns L'élément provider.
 */
export function SocketProvider(props: SocketProviderProps): ReactElement {
  const { children } = props;
  const mode = resolveMode(props.mode);
  const url = resolveUrl(props.url);
  const { token, agencyId } = props;

  const [status, setStatus] = useState<SocketStatus>(
    mode === "real" ? "connecting" : "inactive"
  );
  const [tv, dispatchTv] = useReducer(tvReducer, initialTvState);
  const [dashboard, setDashboard] = useState<DashboardRealtime>({
    lastQueueUpdate: null,
    lastCounterStatus: null,
  });
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (mode !== "real") {
      setStatus("inactive");
      return;
    }

    const socket: Socket = io(url, {
      auth: token ? { token } : {},
      // D7 : borner les tentatives — pas de boucle de reconnexion infinie.
      reconnectionAttempts: MAX_RECONNECTION_ATTEMPTS,
      transports: ["websocket", "polling"],
      autoConnect: true,
    });
    socketRef.current = socket;

    function requestSync(): void {
      // D4 : resync = convergence d'état (snapshot), pas de rejeu.
      if (agencyId) {
        // Le serveur valide `{ agencyId }` (joinAgencySchema/syncRequestSchema).
        socket.emit("join:agency", { agencyId });
        socket.emit("sync:request", { agencyId });
      }
    }

    socket.on("connect", () => {
      setStatus("connected");
      requestSync();
    });

    // (re)connexion → re-join + sync:request → convergence d'état.
    socket.io.on("reconnect", () => {
      setStatus("connected");
      requestSync();
    });

    socket.on("disconnect", () => {
      setStatus("connecting");
    });

    // D7 : handshake refusé (UNAUTHORIZED / révocation / expiration).
    socket.on("connect_error", () => {
      setStatus("error");
    });

    // Épuisement des tentatives bornées → état error stable (repli offline).
    socket.io.on("reconnect_failed", () => {
      setStatus("error");
    });

    // Refus applicatif de join/sync hors scope → non-crash, état géré.
    socket.on("error:forbidden", () => {
      setStatus("error");
    });

    // TV : ticket:called (forme contrat, validé dans le reducer).
    socket.on("ticket:called", (payload: unknown) => {
      dispatchTv({ type: "ticket:called", payload });
    });

    // TV : sync:state → remplacement d'état par snapshot (recentCalls).
    socket.on("sync:state", (payload: unknown) => {
      dispatchTv({ type: "sync:state", payload });
    });

    // Dashboards : queue:updated (validé contre le contrat).
    socket.on("queue:updated", (payload: unknown) => {
      const parsed = queueUpdatedEvent.payloadSchema.safeParse(payload);
      if (parsed.success) {
        setDashboard((prev) => ({ ...prev, lastQueueUpdate: parsed.data }));
      }
    });

    // Dashboards : counter:status (validé contre le contrat).
    socket.on("counter:status", (payload: unknown) => {
      const parsed = counterStatusEvent.payloadSchema.safeParse(payload);
      if (parsed.success) {
        setDashboard((prev) => ({ ...prev, lastCounterStatus: parsed.data }));
      }
    });

    return () => {
      socket.removeAllListeners();
      socket.io.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [mode, url, token, agencyId]);

  const value = useMemo<SocketContextValue>(
    () => ({
      connected: status === "connected",
      status,
      tv,
      dashboard,
    }),
    [status, tv, dashboard]
  );

  return <SocketContext.Provider value={value}>{children}</SocketContext.Provider>;
}

/**
 * Hook d'accès au contexte socket.
 * @returns La valeur du contexte socket.
 */
export function useSocket(): SocketContextValue {
  return useContext(SocketContext);
}
