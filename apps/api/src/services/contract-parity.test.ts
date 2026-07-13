/**
 * Tests de PARITÉ — RT-001a : les `EVENT_SCHEMAS` du bus (transcription) sont
 * équivalents, par événement, aux `payloadSchema` du CONTRAT
 * (`@sigfa/contracts/events/realtime.js`, LA LOI).
 *
 * On prouve l'équivalence par échantillons : un payload VALIDE selon le contrat
 * l'est aussi selon le bus, et un payload INVALIDE selon le contrat l'est aussi
 * selon le bus — pour CHACUN des 7 événements. Si le contrat évolue, cette suite
 * casse (garde-fou anti-dérive).
 *
 * Nommage strict : `RT-001a: <description>`.
 *
 * @module
 */

import { describe, it, expect } from "vitest";
import {
  ticketCreatedEvent,
  ticketCalledEvent,
  ticketClosedEvent,
  queueUpdatedEvent,
  counterStatusEvent,
  alertManagerEvent,
  kioskPrinterErrorEvent,
  kioskSilentEvent,
  kioskRecoveredEvent,
  kioskStatusEvent,
} from "@sigfa/contracts/events/realtime.js";
import { EVENT_SCHEMAS, type EventName } from "src/services/realtime.js";

const AGENCY_ID = "00000000-0000-4000-a000-0000000000aa";

/** Schémas du CONTRAT indexés par nom d'événement. */
const CONTRACT_SCHEMAS = {
  "ticket:created": ticketCreatedEvent.payloadSchema,
  "ticket:called": ticketCalledEvent.payloadSchema,
  "ticket:closed": ticketClosedEvent.payloadSchema,
  "queue:updated": queueUpdatedEvent.payloadSchema,
  "counter:status": counterStatusEvent.payloadSchema,
  "alert:manager": alertManagerEvent.payloadSchema,
  "kiosk:printer-error": kioskPrinterErrorEvent.payloadSchema,
  "kiosk:silent": kioskSilentEvent.payloadSchema,
  "kiosk:recovered": kioskRecoveredEvent.payloadSchema,
  "kiosk:status": kioskStatusEvent.payloadSchema,
} as const;

/** Échantillons { valid, invalid } par événement. */
const SAMPLES: Record<EventName, { valid: unknown; invalid: unknown }> = {
  "ticket:created": {
    valid: {
      ticket: {
        id: "00000000-0000-4000-a000-000000000001",
        number: "A001",
        status: "WAITING",
        serviceId: "00000000-0000-4000-a000-000000000002",
        agencyId: AGENCY_ID,
        channel: "KIOSK",
        createdAt: "2026-07-12T10:00:00.000Z",
      },
      position: 0,
      estimate: 0,
    },
    invalid: { ticket: { id: "nope" }, position: -1, estimate: 0 },
  },
  "ticket:called": {
    valid: {
      ticket: {
        id: "00000000-0000-4000-a000-000000000001",
        number: "A001",
        status: "CALLED",
        serviceId: "00000000-0000-4000-a000-000000000002",
        agencyId: AGENCY_ID,
        channel: "KIOSK",
        createdAt: "2026-07-12T10:00:00.000Z",
      },
      counter: { id: "00000000-0000-4000-a000-000000000003", label: "Guichet 1" },
    },
    invalid: {
      ticket: {
        id: "00000000-0000-4000-a000-000000000001",
        number: "A001",
        status: "CALLED",
        serviceId: "00000000-0000-4000-a000-000000000002",
        agencyId: AGENCY_ID,
        channel: "KIOSK",
        createdAt: "2026-07-12T10:00:00.000Z",
      },
      counter: { id: "not-a-uuid", label: "" },
    },
  },
  "ticket:closed": {
    valid: {
      ticketId: "00000000-0000-4000-a000-000000000001",
      waitTime: 10,
      serviceTime: 20,
    },
    invalid: { ticketId: "00000000-0000-4000-a000-000000000001", waitTime: -1, serviceTime: 20 },
  },
  "queue:updated": {
    valid: { queueId: "00000000-0000-4000-a000-000000000004", length: 3, estimate: 5 },
    invalid: { queueId: "bad", length: 3, estimate: 5 },
  },
  "counter:status": {
    valid: { counterId: "00000000-0000-4000-a000-000000000003", status: "OPEN" },
    invalid: { counterId: "00000000-0000-4000-a000-000000000003", status: "OFFLINE" },
  },
  "alert:manager": {
    valid: { type: "SLA_BREACH", payload: { ticketId: "x" } },
    invalid: { type: "UNKNOWN_ALERT", payload: {} },
  },
  "kiosk:printer-error": {
    valid: {
      kioskId: "00000000-0000-4000-a000-000000000006",
      agencyId: AGENCY_ID,
      since: "2026-07-12T10:00:00.000Z",
    },
    invalid: {
      kioskId: "00000000-0000-4000-a000-000000000006",
      agencyId: AGENCY_ID,
      since: "hier matin",
    },
  },
  // ── CONTRACT-013 / ADM-003 : supervision borne (3 événements STAFF) ─────────
  "kiosk:silent": {
    valid: {
      kioskId: "00000000-0000-4000-a000-000000000006",
      agencyId: AGENCY_ID,
      status: "SILENT",
      since: "2026-07-12T10:00:00.000Z",
    },
    invalid: {
      kioskId: "00000000-0000-4000-a000-000000000006",
      agencyId: AGENCY_ID,
      status: "OFFLINE", // hors enum KioskStatus
      since: "2026-07-12T10:00:00.000Z",
    },
  },
  "kiosk:recovered": {
    valid: {
      kioskId: "00000000-0000-4000-a000-000000000006",
      agencyId: AGENCY_ID,
      status: "ONLINE",
      since: "2026-07-12T10:00:00.000Z",
    },
    invalid: {
      kioskId: "not-a-uuid",
      agencyId: AGENCY_ID,
      status: "ONLINE",
      since: "2026-07-12T10:00:00.000Z",
    },
  },
  "kiosk:status": {
    valid: {
      kioskId: "00000000-0000-4000-a000-000000000006",
      agencyId: AGENCY_ID,
      status: "DEGRADED",
      since: "2026-07-12T10:00:00.000Z",
    },
    invalid: {
      kioskId: "00000000-0000-4000-a000-000000000006",
      agencyId: AGENCY_ID,
      status: "DEGRADED",
      since: "hier matin",
    },
  },
};

const ALL: EventName[] = [
  "ticket:created",
  "ticket:called",
  "ticket:closed",
  "queue:updated",
  "counter:status",
  "alert:manager",
  "kiosk:printer-error",
  "kiosk:silent",
  "kiosk:recovered",
  "kiosk:status",
];

describe("RT-001a: parité bus↔contrat (10 événements, LA LOI)", () => {
  it.each(ALL)(
    "RT-001a: %s — payload valide accepté par contrat ET bus (parité positive)",
    (event) => {
      const sample = SAMPLES[event].valid;
      expect(CONTRACT_SCHEMAS[event].safeParse(sample).success).toBe(true);
      expect(EVENT_SCHEMAS[event].safeParse(sample).success).toBe(true);
    }
  );

  it.each(ALL)(
    "RT-001a: %s — payload invalide rejeté par contrat ET bus (parité négative)",
    (event) => {
      const sample = SAMPLES[event].invalid;
      expect(CONTRACT_SCHEMAS[event].safeParse(sample).success).toBe(false);
      expect(EVENT_SCHEMAS[event].safeParse(sample).success).toBe(false);
    }
  );
});
