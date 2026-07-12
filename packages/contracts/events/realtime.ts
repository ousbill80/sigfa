/**
 * CONTRACT-002 — Contrat des événements Socket.io temps réel SIGFA
 *
 * Chaque événement est un objet exporté : { name, payloadSchema, emitter, consumers, room }
 * Les types sont tous inférés via z.infer — aucun type manuel.
 *
 * Modèle de rooms : agency:{agencyId}
 *   - L'authentification socket se fait par JWT (claim bankId + agencyId)
 *   - Un socket ne peut joindre que les rooms de sa banque (scope tenant vérifié côté serveur)
 *
 * Sémantique de reconnexion :
 *   - Quand un client se reconnecte, il émet sync:request avec son agencyId
 *   - Le serveur répond avec sync:state contenant l'état courant de la file
 *
 * Contrainte de validation :
 *   - Si un payload ne valide pas son schéma Zod à l'émission, l'événement ne part pas
 *   - Contrat consommé par l'implémentation F3 (API-006)
 *
 * Contexte de charge contractualisé pour ticket:called :
 *   - 50 agences × 100 tickets/min via Redis pub/sub
 *   - Réception garantie < TICKET_CALLED_SLA_MS (mesure réelle : RT-002)
 */
import { z } from "zod";
import { uuidSchema } from "@sigfa/schemas";

// ─── Constantes ────────────────────────────────────────────────────────────

/**
 * SLA de réception de l'événement ticket:called en millisecondes.
 * Contexte : 50 agences × 100 tickets/min via Redis pub/sub.
 * Mesure réelle : RT-002.
 */
export const TICKET_CALLED_SLA_MS = 500 as const;

/**
 * CONTRACT-012 : Nombre maximum de tickets CALLED récents renvoyés dans sync:state.
 * Permet la reconstruction complète de l'écran TV après reconnexion.
 */
export const SYNC_RECENT_CALLS = 4 as const;

/**
 * CONTRACT-013 : Durée de vie du token d'affichage TV public en secondes (12 h).
 * Alignée sur la session borne (KioskSessionResponse). Le token est lecture seule,
 * scope une seule agence, et non renouvelable.
 */
export const TV_SESSION_TTL_SECONDS = 43200 as const;

/**
 * CONTRACT-013 : Rôle de contrat du token d'affichage TV public.
 * Sémantique RBAC (lecture seule, orthogonale) implémentée côté serveur (agent-api).
 * Ici, valeur de contrat uniquement, exposée dans TvSessionResponse.role.
 */
export const TV_DISPLAY_ROLE = "DISPLAY" as const;

// ─── Schémas partiels réutilisés ──────────────────────────────────────────

/**
 * Statuts possibles d'un ticket (aligné sur core.yaml TicketStatus)
 */
const ticketStatusSchema = z.enum([
  "WAITING",
  "CALLED",
  "SERVING",
  "DONE",
  "NO_SHOW",
  "ABANDONED",
  "TRANSFERRED",
]);

/**
 * Canaux d'émission d'un ticket (aligné sur core.yaml TicketChannel)
 */
const ticketChannelSchema = z.enum(["KIOSK", "QR", "MOBILE", "WHATSAPP"]);

/**
 * Statut d'un guichet (aligné sur core.yaml CounterStatus)
 */
const counterStatusEnumSchema = z.enum(["OPEN", "PAUSED", "CLOSED"]);

/**
 * Statut d'une file d'attente (aligné sur core.yaml QueueStatus)
 */
const queueStatusEnumSchema = z.enum(["OPEN", "PAUSED", "CLOSED"]);

/**
 * Résumé d'un ticket embarqué dans les événements temps réel
 */
const ticketSummarySchema = z.object({
  /** Identifiant UUID du ticket */
  id: uuidSchema,
  /** Numéro lisible du ticket (ex. "A001") */
  number: z.string().min(1),
  /** État courant du ticket */
  status: ticketStatusSchema,
  /** Identifiant UUID du service */
  serviceId: uuidSchema,
  /** Identifiant UUID de l'agence */
  agencyId: uuidSchema,
  /** Canal d'émission du ticket */
  channel: ticketChannelSchema,
  /** Date/heure de création ISO 8601 */
  createdAt: z.string().datetime(),
});

/**
 * Résumé d'un guichet embarqué dans les événements temps réel
 */
const counterSummarySchema = z.object({
  /** Identifiant UUID du guichet */
  id: uuidSchema,
  /** Libellé du guichet (ex. "Guichet 1") */
  label: z.string().min(1),
});

// ─── Types des alertes manager ──────────────────────────────────────────────

/**
 * Types d'alertes pour le dashboard manager.
 * Frontière avec CONTRACT-008 (anomalies IA) :
 *   - Alerte : instantanée (1 occurrence)
 *   - Anomalie IA : motif agrégé sur une fenêtre temporelle
 *
 * CONTRACT-012 : ajout de KIOSK_SYSTEM_ERROR — émis par api-server sur
 * échecs système borne remontés par sync/heartbeat.
 */
const alertManagerTypeSchema = z.enum([
  "AGENT_INACTIVE",
  "AGENT_DISCONNECTED_WITH_TICKET",
  "SLA_BREACH",
  "QUEUE_CRITICAL",
  "KIOSK_SYSTEM_ERROR",
]);

// ─── Événements Socket.io ──────────────────────────────────────────────────

/**
 * ticket:created — Ticket créé dans la file
 * Émis par : borne kiosque / serveur API
 * Consommateurs : borne (affichage confirmation), dashboard
 */
export const ticketCreatedEvent = {
  name: "ticket:created",
  payloadSchema: z.object({
    /** Ticket créé */
    ticket: ticketSummarySchema,
    /** Position dans la file (entier ≥ 0) */
    position: z.number().int().min(0),
    /** Estimation d'attente en secondes (entier ≥ 0) */
    estimate: z.number().int().min(0),
  }),
  /** Composant qui émet l'événement */
  emitter: "api-server",
  /** Composants abonnés à cet événement */
  consumers: ["kiosk", "dashboard"],
  /** Room Socket.io : préfixe agency:{agencyId} — scope tenant contrôlé par JWT */
  room: "agency:{agencyId}",
} as const;

/** Type inféré du payload ticket:created */
export type TicketCreatedPayload = z.infer<
  typeof ticketCreatedEvent.payloadSchema
>;

/**
 * ticket:called — Ticket appelé à un guichet
 * SLA : réception garantie < TICKET_CALLED_SLA_MS (500 ms)
 * Contexte de charge : 50 agences × 100 tickets/min via Redis pub/sub
 * Émis par : serveur API (après appel agent)
 * Consommateurs : écran TV (annonce visuelle), dashboard, mobile (notification)
 */
export const ticketCalledEvent = {
  name: "ticket:called",
  payloadSchema: z.object({
    /** Ticket appelé */
    ticket: ticketSummarySchema,
    /** Guichet appelant */
    counter: counterSummarySchema,
  }),
  emitter: "api-server",
  consumers: ["tv-screen", "dashboard", "mobile"],
  room: "agency:{agencyId}",
} as const;

/** Type inféré du payload ticket:called */
export type TicketCalledPayload = z.infer<
  typeof ticketCalledEvent.payloadSchema
>;

/**
 * ticket:closed — Ticket clôturé (DONE, NO_SHOW, ABANDONED, TRANSFERRED)
 * Émis par : serveur API
 * Consommateurs : dashboard (statistiques)
 */
export const ticketClosedEvent = {
  name: "ticket:closed",
  payloadSchema: z.object({
    /** Identifiant UUID du ticket clôturé */
    ticketId: uuidSchema,
    /** Temps d'attente en secondes (de la création à l'appel) */
    waitTime: z.number().int().min(0),
    /** Temps de service en secondes (de l'appel à la clôture) */
    serviceTime: z.number().int().min(0),
  }),
  emitter: "api-server",
  consumers: ["dashboard"],
  room: "agency:{agencyId}",
} as const;

/** Type inféré du payload ticket:closed */
export type TicketClosedPayload = z.infer<
  typeof ticketClosedEvent.payloadSchema
>;

/**
 * counter:status — Changement de statut d'un guichet
 * Émis par : serveur API (après action agent : ouverture, pause, fermeture)
 * Consommateurs : dashboard
 */
export const counterStatusEvent = {
  name: "counter:status",
  payloadSchema: z.object({
    /** Identifiant UUID du guichet */
    counterId: uuidSchema,
    /** Nouveau statut du guichet */
    status: counterStatusEnumSchema,
    /** Identifiant UUID de l'agent affecté (absent si guichet fermé) */
    agentId: uuidSchema.optional(),
  }),
  emitter: "api-server",
  consumers: ["dashboard"],
  room: "agency:{agencyId}",
} as const;

/** Type inféré du payload counter:status */
export type CounterStatusPayload = z.infer<
  typeof counterStatusEvent.payloadSchema
>;

/**
 * queue:updated — Mise à jour de l'état d'une file
 * Émis par : serveur API (après création/clôture de ticket)
 * Consommateurs : borne (affichage temps réel), dashboard, mobile
 */
export const queueUpdatedEvent = {
  name: "queue:updated",
  payloadSchema: z.object({
    /** Identifiant UUID de la file */
    queueId: uuidSchema,
    /** Nombre de tickets en attente (entier ≥ 0) */
    length: z.number().int().min(0),
    /** Estimation d'attente globale en secondes (entier ≥ 0) */
    estimate: z.number().int().min(0),
  }),
  emitter: "api-server",
  consumers: ["kiosk", "dashboard", "mobile"],
  room: "agency:{agencyId}",
} as const;

/** Type inféré du payload queue:updated */
export type QueueUpdatedPayload = z.infer<
  typeof queueUpdatedEvent.payloadSchema
>;

/**
 * agency:offline — Agence passée hors ligne
 * Émis par : serveur API (heartbeat timeout)
 * Consommateurs : dashboard réseau (supervision)
 */
export const agencyOfflineEvent = {
  name: "agency:offline",
  payloadSchema: z.object({
    /** Identifiant UUID de l'agence */
    agencyId: uuidSchema,
    /** Horodatage ISO 8601 du passage hors ligne */
    since: z.string().datetime(),
  }),
  emitter: "api-server",
  consumers: ["network-dashboard"],
  room: "agency:{agencyId}",
} as const;

/** Type inféré du payload agency:offline */
export type AgencyOfflinePayload = z.infer<
  typeof agencyOfflineEvent.payloadSchema
>;

/**
 * alert:manager — Alerte instantanée vers le dashboard manager
 * Frontière avec CONTRACT-008 : l'alerte est une occurrence unique,
 * l'anomalie IA est un motif agrégé sur une fenêtre temporelle.
 * Émis par : serveur API
 * Consommateurs : dashboard manager
 */
export const alertManagerEvent = {
  name: "alert:manager",
  payloadSchema: z.object({
    /** Type d'alerte (énuméré — pas de type ouvert pour éviter la fuite hors contrat) */
    type: alertManagerTypeSchema,
    /** Payload contextuel libre selon le type d'alerte */
    payload: z.record(z.unknown()),
  }),
  emitter: "api-server",
  consumers: ["manager-dashboard"],
  room: "agency:{agencyId}",
} as const;

/** Type inféré du payload alert:manager */
export type AlertManagerPayload = z.infer<
  typeof alertManagerEvent.payloadSchema
>;

/** Type union des types d'alerte */
export type AlertManagerType = z.infer<typeof alertManagerTypeSchema>;

/**
 * kiosk:printer-error — Erreur d'impression sur une borne kiosque
 * Alimenté par le heartbeat borne (CONTRACT-003).
 * Émis par : borne kiosque (via serveur API)
 * Consommateurs : dashboard manager
 */
export const kioskPrinterErrorEvent = {
  name: "kiosk:printer-error",
  payloadSchema: z.object({
    /** Identifiant UUID de la borne */
    kioskId: uuidSchema,
    /** Identifiant UUID de l'agence hébergeant la borne */
    agencyId: uuidSchema,
    /** Horodatage ISO 8601 du début de l'erreur */
    since: z.string().datetime(),
  }),
  emitter: "kiosk",
  consumers: ["manager-dashboard"],
  room: "agency:{agencyId}",
} as const;

/** Type inféré du payload kiosk:printer-error */
export type KioskPrinterErrorPayload = z.infer<
  typeof kioskPrinterErrorEvent.payloadSchema
>;

/**
 * join:agency — Demande de rattachement à la room d'une agence
 * Sémantique : QUAND un client (écran TV, borne, dashboard) veut recevoir les
 * événements temps réel d'une agence, il émet join:agency avec l'agencyId cible.
 * Le serveur valide le scope tenant (JWT : bankId + agencyId, ou token DISPLAY
 * public scope agency) avant de rattacher le socket à la room agency:{agencyId}.
 *
 * CONTRACT-013 : forme UNIQUE et validée du rattachement — web et kiosk s'alignent
 * dessus. Émise aujourd'hui par les clients sans schéma au contrat (couture consignée).
 * Émis par : client (écran TV, borne, dashboard, mobile)
 * Consommateurs : serveur API
 */
export const joinAgencyEvent = {
  name: "join:agency",
  payloadSchema: z.object({
    /** Identifiant UUID de l'agence dont on veut rejoindre la room temps réel */
    agencyId: uuidSchema,
  }),
  emitter: "client",
  consumers: ["api-server"],
  room: "agency:{agencyId}",
} as const;

/** Type inféré du payload join:agency */
export type JoinAgencyPayload = z.infer<typeof joinAgencyEvent.payloadSchema>;

/**
 * sync:request — Demande de resynchronisation après reconnexion
 * Sémantique : QUAND un client se reconnecte, il émet cet événement
 * Le serveur répond avec sync:state contenant l'état courant de la file.
 * Émis par : client (borne, dashboard, mobile)
 * Consommateurs : serveur API
 */
export const syncRequestEvent = {
  name: "sync:request",
  payloadSchema: z.object({
    /** Identifiant UUID de l'agence dont on veut resynchroniser l'état */
    agencyId: uuidSchema,
  }),
  emitter: "client",
  consumers: ["api-server"],
  room: "agency:{agencyId}",
} as const;

/** Type inféré du payload sync:request */
export type SyncRequestPayload = z.infer<typeof syncRequestEvent.payloadSchema>;

/**
 * sync:state — État courant de la file envoyé après sync:request
 * Contient l'état complet des files et guichets de l'agence demandée.
 * Émis par : serveur API
 * Consommateurs : client (borne, dashboard, mobile)
 *
 * CONTRACT-012 : ajout de recentCalls — les SYNC_RECENT_CALLS (4) derniers
 * tickets CALLED, pour reconstruction complète de l'écran TV après reconnexion.
 */
export const syncStateEvent = {
  name: "sync:state",
  payloadSchema: z.object({
    /** Identifiant UUID de l'agence */
    agencyId: uuidSchema,
    /** État courant de toutes les files de l'agence */
    queues: z.array(
      z.object({
        /** Identifiant UUID de la file */
        queueId: uuidSchema,
        /** Nombre de tickets en attente */
        length: z.number().int().min(0),
        /** Estimation d'attente en secondes */
        estimate: z.number().int().min(0),
        /** Statut de la file */
        status: queueStatusEnumSchema,
      })
    ),
    /** État courant de tous les guichets de l'agence */
    counters: z.array(
      z.object({
        /** Identifiant UUID du guichet */
        counterId: uuidSchema,
        /** Statut du guichet */
        status: counterStatusEnumSchema,
        /** Identifiant UUID de l'agent affecté (absent si guichet fermé) */
        agentId: uuidSchema.optional(),
      })
    ),
    /**
     * CONTRACT-012 : Les SYNC_RECENT_CALLS (4) derniers tickets CALLED de l'agence.
     * Permet la reconstruction complète de l'écran TV après reconnexion.
     * Trié du plus récent au plus ancien.
     */
    recentCalls: z.array(
      z.object({
        /** Numéro lisible du ticket (ex. "A001") */
        ticketNumber: z.string().min(1),
        /** Numéro affiché sur l'écran TV au format {code}-{NNN} (ex. "OC-047") */
        displayNumber: z.string().min(1),
        /** Libellé du guichet appelant (ex. "Guichet 1") */
        counterLabel: z.string().min(1),
        /** Horodatage ISO 8601 de l'appel */
        calledAt: z.string().datetime(),
      })
    ),
    /** Horodatage ISO 8601 de la snapshot */
    timestamp: z.string().datetime(),
  }),
  emitter: "api-server",
  consumers: ["client"],
  room: "agency:{agencyId}",
} as const;

/** Type inféré du payload sync:state */
export type SyncStatePayload = z.infer<typeof syncStateEvent.payloadSchema>;

// ─── Inventaire complet des événements ──────────────────────────────────────

/**
 * Tableau de tous les événements temps réel — utilisé pour l'inventaire,
 * la génération de types et la validation exhaustive.
 */
export const ALL_EVENTS = [
  ticketCreatedEvent,
  ticketCalledEvent,
  ticketClosedEvent,
  counterStatusEvent,
  queueUpdatedEvent,
  agencyOfflineEvent,
  alertManagerEvent,
  kioskPrinterErrorEvent,
  joinAgencyEvent,
  syncRequestEvent,
  syncStateEvent,
] as const;

/** Type union de tous les noms d'événements */
export type RealtimeEventName = (typeof ALL_EVENTS)[number]["name"];
