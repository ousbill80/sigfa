/**
 * Tests unitaires — NOTIF-003 : extraction PURE du message d'un payload Meta.
 *
 * Nommage strict : `NOTIF-003: <description>`.
 *
 * @module
 */

import { describe, it, expect } from "vitest";
import { extractInboundMessage } from "src/services/whatsapp/whatsapp-inbound.js";

function payload(from: string, id: string, body: string): unknown {
  return {
    object: "whatsapp_business_account",
    entry: [
      { id: "acc", changes: [{ value: { messaging_product: "whatsapp", messages: [{ from, id, type: "text", text: { body } }] } }] },
    ],
  };
}

describe("extractInboundMessage", () => {
  it("NOTIF-003: extrait from/text/providerMessageId du premier message texte", () => {
    expect(extractInboundMessage(payload("+2250700000001", "wamid-1", "Bonjour"))).toEqual({
      from: "+2250700000001",
      text: "Bonjour",
      providerMessageId: "wamid-1",
    });
  });

  it("NOTIF-003: payload sans messages texte → null (ignoré)", () => {
    const statusOnly = { object: "whatsapp_business_account", entry: [{ changes: [{ value: { statuses: [{ id: "x" }] } }] }] };
    expect(extractInboundMessage(statusOnly)).toBeNull();
  });

  it("NOTIF-003: message non-texte (image) → null", () => {
    const img = { entry: [{ changes: [{ value: { messages: [{ from: "+225", id: "m", type: "image" }] } }] }] };
    expect(extractInboundMessage(img)).toBeNull();
  });

  it("NOTIF-003: payload malformé (non objet / entry absent) → null", () => {
    expect(extractInboundMessage(null)).toBeNull();
    expect(extractInboundMessage("nope")).toBeNull();
    expect(extractInboundMessage({})).toBeNull();
    expect(extractInboundMessage({ entry: "x" })).toBeNull();
  });
});
