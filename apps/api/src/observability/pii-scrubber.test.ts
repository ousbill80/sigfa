/**
 * Tests unitaires — NET-003 : scrubbing PII OBLIGATOIRE des traces Sentry.
 *
 * Critère : Sentry capture les erreurs — PII scrubbée (aucun phone/tracking_id
 * dans breadcrumbs/traces). Preuve : l'événement sérialisé de sortie ne contient
 * AUCUNE PII injectée (risque R6).
 *
 * @module
 */

import { describe, it, expect } from "vitest";
import {
  scrubEvent,
  scrubValue,
  scrubString,
  REDACTED,
  PII_KEYS,
  type SentryLikeEvent,
} from "src/observability/pii-scrubber.js";

const PHONE = "+2250700000047";
const TRACKING_ID = "TRK-9f2c1a8b-4d6e-11ee-be56-0242ac120002";
const JWT =
  "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N";

describe("NET-003: Sentry — PII scrubbée (aucun phone/tracking_id dans breadcrumbs/traces)", () => {
  it("NET-003: redaction par CLÉ — phone/trackingId/token expurgés récursivement", () => {
    const event: SentryLikeEvent = {
      message: "erreur de traitement",
      tags: { phone: PHONE, agencyId: "ag-1" },
      extra: {
        ticket: { trackingId: TRACKING_ID, position: 3 },
        auth: { accessToken: JWT },
      },
      user: { phoneNumber: PHONE, id: "u-1" },
    };
    const scrubbed = scrubEvent(event);
    const serialized = JSON.stringify(scrubbed);

    // Preuve d'absence : aucune PII injectée ne survit.
    expect(serialized).not.toContain(PHONE);
    expect(serialized).not.toContain(TRACKING_ID);
    expect(serialized).not.toContain(JWT);
    expect(serialized).toContain(REDACTED);

    // Les champs non-PII sont préservés.
    expect((scrubbed.tags as Record<string, unknown>)["agencyId"]).toBe("ag-1");
    expect(((scrubbed.extra as Record<string, unknown>)["ticket"] as Record<string, unknown>)["position"]).toBe(3);
  });

  it("NET-003: redaction par VALEUR — phone/JWT dans un message libre expurgés", () => {
    const event: SentryLikeEvent = {
      message: `échec envoi vers ${PHONE} token=${JWT}`,
    };
    const scrubbed = scrubEvent(event);
    expect(scrubbed.message).not.toContain(PHONE);
    expect(scrubbed.message).not.toContain(JWT);
    expect(scrubbed.message).toContain(REDACTED);
  });

  it("NET-003: breadcrumbs — PII expurgée dans chaque entrée", () => {
    const event: SentryLikeEvent = {
      breadcrumbs: [
        { message: "sms", data: { phone: PHONE } },
        { message: `lookup tracking ${TRACKING_ID}` },
      ],
    };
    const serialized = JSON.stringify(scrubEvent(event));
    expect(serialized).not.toContain(PHONE);
    expect(serialized).not.toContain(TRACKING_ID);
  });

  it("NET-003: ne mute PAS l'entrée (copie pure)", () => {
    const event: SentryLikeEvent = { tags: { phone: PHONE } };
    scrubEvent(event);
    expect((event.tags as Record<string, unknown>)["phone"]).toBe(PHONE);
  });

  it("NET-003: clés PII insensibles à la casse et aux séparateurs (_/-)", () => {
    const scrubbed = scrubValue({
      Phone_Number: PHONE,
      "tracking-id": TRACKING_ID,
    }) as Record<string, unknown>;
    expect(scrubbed["Phone_Number"]).toBe(REDACTED);
    expect(scrubbed["tracking-id"]).toBe(REDACTED);
  });

  it("NET-003: valeurs primitives et null traversées sans erreur", () => {
    expect(scrubValue(null)).toBeNull();
    expect(scrubValue(42)).toBe(42);
    expect(scrubValue(true)).toBe(true);
    expect(scrubString("aucune pii ici")).toBe("aucune pii ici");
  });

  it("NET-003: la liste PII couvre phone et trackingId (contrat de sécurité)", () => {
    expect(PII_KEYS).toContain("phone");
    expect(PII_KEYS).toContain("trackingid");
  });
});
