/**
 * Tests unitaires — NOTIF-003 : adaptateur WhatsApp MOCK (zéro appel Meta réel).
 *
 * Nommage strict : `NOTIF-003: <description>`.
 *
 * @module
 */

import { describe, it, expect } from "vitest";
import {
  createMockWhatsAppAdapter,
  type WhatsAppSendRequest,
} from "src/services/whatsapp/whatsapp-adapter.js";
import { NotificationSendError } from "src/services/notification-jobs.js";

const req: WhatsAppSendRequest = { to: "+2250700000001", body: "Bonjour" };

describe("whatsapp-adapter (mock)", () => {
  it("NOTIF-003: mock accepté → providerMessageId, aucun appel réseau", async () => {
    const adapter = createMockWhatsAppAdapter({
      outcomeFor: () => ({ kind: "accepted", providerMessageId: "mid-1" }),
    });
    const res = await adapter.send(req);
    expect(res.providerMessageId).toBe("mid-1");
  });

  it("NOTIF-003: mock 429 → NotificationSendError QUOTA_EXCEEDED (transitoire)", async () => {
    const adapter = createMockWhatsAppAdapter({ outcomeFor: () => ({ kind: "rate_limited" }) });
    await expect(adapter.send(req)).rejects.toMatchObject({ reason: "QUOTA_EXCEEDED" });
  });

  it("NOTIF-003: mock timeout → PROVIDER_UNREACHABLE (transitoire)", async () => {
    const adapter = createMockWhatsAppAdapter({ outcomeFor: () => ({ kind: "timeout" }) });
    await expect(adapter.send(req)).rejects.toMatchObject({ reason: "PROVIDER_UNREACHABLE" });
  });

  it("NOTIF-003: mock invalid_number → INVALID_NUMBER (définitif)", async () => {
    const adapter = createMockWhatsAppAdapter({ outcomeFor: () => ({ kind: "invalid_number" }) });
    await expect(adapter.send(req)).rejects.toMatchObject({ reason: "INVALID_NUMBER" });
  });

  it("NOTIF-003: mock template_rejected → TEMPLATE_REJECTED (limite HSM Meta documentée)", async () => {
    const adapter = createMockWhatsAppAdapter({ outcomeFor: () => ({ kind: "template_rejected" }) });
    const err = await adapter.send(req).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NotificationSendError);
    expect((err as NotificationSendError).reason).toBe("TEMPLATE_REJECTED");
  });

  it("NOTIF-003: défaut → accepté avec id dérivé d'un compteur (jamais du clair)", async () => {
    const adapter = createMockWhatsAppAdapter();
    const res = await adapter.send(req);
    expect(res.providerMessageId).toMatch(/^mock-wa-\d+$/);
    // L'id ne contient jamais le numéro en clair.
    expect(res.providerMessageId).not.toContain("2250700000001");
  });
});
