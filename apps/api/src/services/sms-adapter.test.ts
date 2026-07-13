/**
 * Tests unitaires — adaptateur SMS MOCK (NOTIF-002). AUCUN appel réseau réel.
 * Nommage strict : `NOTIF-002: <description>`.
 */

import { describe, it, expect } from "vitest";
import { createMockSmsAdapter } from "src/services/sms-adapter.js";
import { NotificationSendError } from "src/services/notification-jobs.js";

describe("createMockSmsAdapter", () => {
  it("NOTIF-002: 2xx simulé → renvoie providerMessageId sans appel réel", async () => {
    const adapter = createMockSmsAdapter({
      outcomeFor: () => ({ kind: "accepted", providerMessageId: "mid-1" }),
    });
    const res = await adapter.send({ to: "+2250700000047", body: "Bonjour" });
    expect(res.providerMessageId).toBe("mid-1");
  });

  it("NOTIF-002: 429 simulé → NotificationSendError QUOTA_EXCEEDED (transitoire)", async () => {
    const adapter = createMockSmsAdapter({ outcomeFor: () => ({ kind: "rate_limited" }) });
    await expect(adapter.send({ to: "+2250700000047", body: "x" })).rejects.toMatchObject({
      name: "NotificationSendError",
      reason: "QUOTA_EXCEEDED",
    });
  });

  it("NOTIF-002: timeout simulé → NotificationSendError PROVIDER_UNREACHABLE", async () => {
    const adapter = createMockSmsAdapter({ outcomeFor: () => ({ kind: "timeout" }) });
    await expect(adapter.send({ to: "+2250700000047", body: "x" })).rejects.toMatchObject({
      reason: "PROVIDER_UNREACHABLE",
    });
  });

  it("NOTIF-002: numéro invalide simulé → INVALID_NUMBER", async () => {
    const adapter = createMockSmsAdapter({ outcomeFor: () => ({ kind: "invalid_number" }) });
    await expect(adapter.send({ to: "x", body: "x" })).rejects.toMatchObject({
      reason: "INVALID_NUMBER",
    });
  });

  it("NOTIF-002: défaut = accepté avec id déterministe non dérivé du clair", async () => {
    const adapter = createMockSmsAdapter({ idFactory: () => "fixed-id" });
    const res = await adapter.send({ to: "+2250700000047", body: "x" });
    expect(res.providerMessageId).toBe("fixed-id");
    // L'id ne contient jamais de fragment du numéro en clair.
    expect(res.providerMessageId).not.toContain("0700");
    expect(NotificationSendError).toBeTypeOf("function");
  });

  it("NOTIF-002: adaptateur sans options → id auto mock-sms-<n> (aucune PII)", async () => {
    const adapter = createMockSmsAdapter();
    const res = await adapter.send({ to: "+2250700000047", body: "x" });
    expect(res.providerMessageId).toMatch(/^mock-sms-\d+$/);
  });
});
