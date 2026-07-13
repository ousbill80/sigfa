/**
 * Tests unitaires — NOTIF-004 : interface EmailAdapter + adaptateur MOCK Resend.
 * ZÉRO envoi réseau : chaque issue fournisseur (succès / transitoire / limite /
 * bounce dur) est simulée de façon déterministe.
 *
 * Nommage strict : `NOTIF-004: <description>`.
 *
 * @module
 */

import { describe, it, expect } from "vitest";
import {
  MockResendAdapter,
  EmailSendError,
  defaultMockDecider,
  type EmailMessage,
} from "src/services/email/email-adapter.js";

function msg(to: string[], overrides: Partial<EmailMessage> = {}): EmailMessage {
  return {
    to,
    from: "alerts@banque.example",
    subject: "Sujet",
    html: "<p>corps</p>",
    ...overrides,
  };
}

describe("NOTIF-004 MockResendAdapter — aucun envoi réel", () => {
  it("NOTIF-004: 2xx Resend (mock) → ACCEPTED + providerMessageId", async () => {
    const adapter = new MockResendAdapter();
    const res = await adapter.send(msg(["manager@banque.example"]));
    expect(res.status).toBe("ACCEPTED");
    expect(res.providerMessageId).toBeTruthy();
    expect(adapter.calls).toBe(1);
    expect(adapter.lastMessage?.to).toEqual(["manager@banque.example"]);
  });

  it("NOTIF-004: 429/erreur transitoire (mock) → EmailSendError retryable (retry NOTIF-001)", async () => {
    const adapter = new MockResendAdapter();
    // 429
    await expect(adapter.send(msg(["ratelimit@banque.example"]))).rejects.toMatchObject({
      name: "EmailSendError",
      reason: "QUOTA_EXCEEDED",
      retryable: true,
    });
    // 5xx transitoire
    await expect(adapter.send(msg(["transient@banque.example"]))).rejects.toMatchObject({
      reason: "PROVIDER_UNREACHABLE",
      retryable: true,
    });
  });

  it("NOTIF-004: bounce dur (mock) → EmailSendError NON retryable (INVALID_NUMBER, pas de retry infini)", async () => {
    const adapter = new MockResendAdapter();
    await expect(adapter.send(msg(["bounce@banque.example"]))).rejects.toMatchObject({
      name: "EmailSendError",
      reason: "INVALID_NUMBER",
      retryable: false,
    });
  });

  it("NOTIF-004: décideur injecté force l'issue de façon déterministe", async () => {
    const adapter = new MockResendAdapter({
      decide: () => "HARD_BOUNCE",
      makeMessageId: () => "fixed-id",
    });
    await expect(adapter.send(msg(["ok@banque.example"]))).rejects.toBeInstanceOf(
      EmailSendError
    );
    const accepting = new MockResendAdapter({ decide: () => "ACCEPT", makeMessageId: () => "fixed-id" });
    const res = await accepting.send(msg(["ok@banque.example"]));
    expect(res.providerMessageId).toBe("fixed-id");
  });

  it("NOTIF-004: décideur par défaut route par localpart (ACCEPT sinon)", () => {
    expect(defaultMockDecider(msg(["bounce@x"]))).toBe("HARD_BOUNCE");
    expect(defaultMockDecider(msg(["transient@x"]))).toBe("TRANSIENT");
    expect(defaultMockDecider(msg(["ratelimit@x"]))).toBe("RATE_LIMIT");
    expect(defaultMockDecider(msg(["normal@x"]))).toBe("ACCEPT");
    expect(defaultMockDecider(msg([]))).toBe("ACCEPT");
  });
});
