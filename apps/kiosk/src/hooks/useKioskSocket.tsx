/**
 * KioskSocketProvider — RT-001b : client socket.io réel pour la borne/TV.
 *
 * Même contrat que le provider web (`apps/web/src/lib/socket-provider.tsx`) :
 *   - bascule par variable d'env (aucun fork de code) : `mode="real"` →
 *     `io(url, { auth: { token } })`, `join:agency`, `sync:request` au (re)connect,
 *     consommation des événements typés du CONTRAT (`@sigfa/contracts`).
 *   - défaut (`off`/mock) → provider `inactive`, aucune connexion (F4 inchangé).
 *
 * Surfaces borne/TV consomment le réel : `ticket:called` + `sync:state.recentCalls`
 * (écran d'appel) et `queue:updated` (bandeau file). États d'échec (D7) :
 * handshake refusé (UNAUTHORIZED) → `error` + repli offline, tentatives bornées ;
 * `error:forbidden` → non-crash.
 *
 * @module hooks/useKioskSocket
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
  ticketCalledEvent,
  syncStateEvent,
  queueUpdatedEvent,
} from "@/lib/contracts-realtime";

/** Statut de connexion du provider socket. */
export type KioskSocketStatus = "inactive" | "connecting" | "connected" | "error";

/** Mode de fonctionnement (dérivé de NEXT_PUBLIC_REALTIME_MODE). */
export type KioskRealtimeMode = "off" | "real";

/** Nombre maximal de tentatives de reconnexion avant de rester en `error`. */
export const KIOSK_MAX_RECONNECTION_ATTEMPTS = 3 as const;

/** Nombre d'appels précédents affichés sous l'appel courant (TV borne). */
export const KIOSK_TV_PREVIOUS_COUNT = 3 as const;

/** Un appel de ticket rendu sur la borne/TV. */
export interface KioskCall {
  /** Numéro lisible du ticket (ex. "A047"). */
  ticketNumber: string;
  /** Numéro affiché ({code}-{NNN}, ex. "OC-047"). */
  displayNumber: string;
  /** Libellé du guichet appelant. */
  counterLabel: string;
  /** Horodatage ISO 8601 de l'appel. */
  calledAt: string;
}

/** État TV de la borne. */
export interface KioskTvState {
  /** Appel courant, ou null. */
  hero: KioskCall | null;
  /** Jusqu'à {@link KIOSK_TV_PREVIOUS_COUNT} appels précédents, plus récent d'abord. */
  previous: KioskCall[];
}

/** État courant de la file affichée par la borne. */
export interface KioskQueueState {
  /** Nombre de tickets en attente, ou null si inconnu. */
  length: number | null;
  /** Estimation d'attente (secondes), ou null si inconnue. */
  estimate: number | null;
}

/** Forme du contexte socket exposée par {@link useKioskSocket}. */
export interface KioskSocketContextValue {
  /** Vrai quand le socket est connecté. */
  connected: boolean;
  /** Statut courant du provider. */
  status: KioskSocketStatus;
  /** État TV (appel courant + précédents). */
  tv: KioskTvState;
  /** État de la file (dernier queue:updated). */
  queue: KioskQueueState;
}

const initialTv: KioskTvState = { hero: null, previous: [] };
const initialQueue: KioskQueueState = { length: null, estimate: null };

const defaultValue: KioskSocketContextValue = {
  connected: false,
  status: "inactive",
  tv: initialTv,
  queue: initialQueue,
};

const KioskSocketContext = createContext<KioskSocketContextValue>(defaultValue);

/** Props du {@link KioskSocketProvider}. */
export interface KioskSocketProviderProps {
  /** Enfants React. */
  children: React.ReactNode;
  /** Mode temps réel. Défaut : `NEXT_PUBLIC_REALTIME_MODE` (sinon `off`). */
  mode?: KioskRealtimeMode;
  /** URL de l'API socket. Défaut : `NEXT_PUBLIC_API_URL` (mock canonique :4010). */
  url?: string;
  /** Token JWT de session borne (KIOSK-001). */
  token?: string;
  /** Agence à rejoindre (`join:agency`). */
  agencyId?: string;
}

/** Défaut mock canonique unifié web/kiosk (mock Prism). */
const DEFAULT_MOCK_URL = "http://localhost:4010";

/** Convertit un numéro de ticket en numéro d'affichage TV ({code}-{NNN}). */
function toDisplayNumber(ticketNumber: string, code: string): string {
  const match = /^([A-Za-z]+)(\d+)$/.exec(ticketNumber.trim());
  if (!match) return ticketNumber;
  const prefix = code.trim() === "" ? match[1]! : code.trim();
  return `${prefix.toUpperCase()}-${match[2]!}`;
}

/** Actions du reducer TV borne. */
type KioskTvAction =
  | { type: "ticket:called"; payload: unknown }
  | { type: "sync:state"; payload: unknown };

/** Reducer TV borne : valide contre le contrat, ignore les payloads invalides. */
function kioskTvReducer(state: KioskTvState, action: KioskTvAction): KioskTvState {
  switch (action.type) {
    case "ticket:called": {
      const parsed = ticketCalledEvent.payloadSchema.safeParse(action.payload);
      if (!parsed.success) return state;
      const call: KioskCall = {
        ticketNumber: parsed.data.ticket.number,
        displayNumber: toDisplayNumber(
          parsed.data.ticket.number,
          parsed.data.counter.label.slice(0, 2)
        ),
        counterLabel: parsed.data.counter.label,
        calledAt: parsed.data.ticket.createdAt,
      };
      const previous = state.hero
        ? [state.hero, ...state.previous].slice(0, KIOSK_TV_PREVIOUS_COUNT)
        : state.previous;
      return { hero: call, previous };
    }
    case "sync:state": {
      const parsed = syncStateEvent.payloadSchema.safeParse(action.payload);
      if (!parsed.success) return state;
      // D4 : remplacement d'état par snapshot (pas de rejeu).
      const calls: KioskCall[] = parsed.data.recentCalls.map((c) => ({
        ticketNumber: c.ticketNumber,
        displayNumber: c.displayNumber,
        counterLabel: c.counterLabel,
        calledAt: c.calledAt,
      }));
      const [hero = null, ...rest] = calls;
      return { hero, previous: rest.slice(0, KIOSK_TV_PREVIOUS_COUNT) };
    }
    default:
      return state;
  }
}

function resolveMode(explicit: KioskRealtimeMode | undefined): KioskRealtimeMode {
  if (explicit) return explicit;
  return process.env.NEXT_PUBLIC_REALTIME_MODE === "real" ? "real" : "off";
}

function resolveUrl(explicit: string | undefined): string {
  return explicit ?? process.env.NEXT_PUBLIC_API_URL ?? DEFAULT_MOCK_URL;
}

/**
 * KioskSocketProvider — enveloppe la borne avec le contexte socket.
 *
 * @param props - {@link KioskSocketProviderProps}.
 * @returns L'élément provider.
 */
export function KioskSocketProvider(props: KioskSocketProviderProps): ReactElement {
  const { children } = props;
  const mode = resolveMode(props.mode);
  const url = resolveUrl(props.url);
  const { token, agencyId } = props;

  const [status, setStatus] = useState<KioskSocketStatus>(
    mode === "real" ? "connecting" : "inactive"
  );
  const [tv, dispatchTv] = useReducer(kioskTvReducer, initialTv);
  const [queue, setQueue] = useState<KioskQueueState>(initialQueue);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (mode !== "real") {
      setStatus("inactive");
      return;
    }

    const socket: Socket = io(url, {
      auth: token ? { token } : {},
      reconnectionAttempts: KIOSK_MAX_RECONNECTION_ATTEMPTS,
      transports: ["websocket", "polling"],
      autoConnect: true,
    });
    socketRef.current = socket;

    function requestSync(): void {
      if (agencyId) {
        socket.emit("join:agency", agencyId);
        socket.emit("sync:request", { agencyId });
      }
    }

    socket.on("connect", () => {
      setStatus("connected");
      requestSync();
    });

    socket.io.on("reconnect", () => {
      setStatus("connected");
      requestSync();
    });

    socket.on("disconnect", () => {
      setStatus("connecting");
    });

    socket.on("connect_error", () => {
      setStatus("error");
    });

    socket.io.on("reconnect_failed", () => {
      setStatus("error");
    });

    socket.on("error:forbidden", () => {
      setStatus("error");
    });

    socket.on("ticket:called", (payload: unknown) => {
      dispatchTv({ type: "ticket:called", payload });
    });

    socket.on("sync:state", (payload: unknown) => {
      dispatchTv({ type: "sync:state", payload });
    });

    socket.on("queue:updated", (payload: unknown) => {
      const parsed = queueUpdatedEvent.payloadSchema.safeParse(payload);
      if (parsed.success) {
        setQueue({ length: parsed.data.length, estimate: parsed.data.estimate });
      }
    });

    return () => {
      socket.removeAllListeners();
      socket.io.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [mode, url, token, agencyId]);

  const value = useMemo<KioskSocketContextValue>(
    () => ({
      connected: status === "connected",
      status,
      tv,
      queue,
    }),
    [status, tv, queue]
  );

  return (
    <KioskSocketContext.Provider value={value}>{children}</KioskSocketContext.Provider>
  );
}

/**
 * Hook d'accès au contexte socket borne.
 * @returns La valeur du contexte socket.
 */
export function useKioskSocket(): KioskSocketContextValue {
  return useContext(KioskSocketContext);
}
