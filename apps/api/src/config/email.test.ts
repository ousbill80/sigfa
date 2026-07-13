/**
 * Tests unitaires — NOTIF-004 : configuration du canal email (env injectable).
 *
 * Nommage strict : `NOTIF-004: <description>`.
 *
 * @module
 */

import { describe, it, expect, afterEach } from "vitest";
import {
  getEmailConfig,
  getEmailAdapter,
  DEFAULT_INTERNAL_DOMAINS,
  DEFAULT_EMAIL_FROM,
} from "src/config/email.js";
import { DEFAULT_ATTACHMENT_LIMIT_BYTES } from "src/services/email/attachment-storage.js";
import { MockResendAdapter } from "src/services/email/email-adapter.js";
import { ResendEmailAdapter } from "src/services/email/resend-email-adapter.js";

const KEYS = [
  "EMAIL_INTERNAL_DOMAINS",
  "EMAIL_FROM",
  "EMAIL_ATTACHMENT_SIGNING_SECRET",
  "EMAIL_ATTACHMENT_BASE_URL",
  "EMAIL_ATTACHMENT_LIMIT_BYTES",
  "EMAIL_PROVIDER",
  "RESEND_API_KEY",
  "RESEND_FROM",
];

afterEach(() => {
  for (const k of KEYS) delete process.env[k];
});

describe("NOTIF-004 config email", () => {
  it("NOTIF-004: défauts sûrs quand l'environnement est vide", () => {
    const cfg = getEmailConfig();
    expect(cfg.internalDomains).toEqual([...DEFAULT_INTERNAL_DOMAINS]);
    expect(cfg.from).toBe(DEFAULT_EMAIL_FROM);
    expect(cfg.attachmentLimitBytes).toBe(DEFAULT_ATTACHMENT_LIMIT_BYTES);
    expect(cfg.attachmentSigningSecret.length).toBeGreaterThan(0);
  });

  it("NOTIF-004: override par l'environnement (domaines, from, plafond)", () => {
    process.env["EMAIL_INTERNAL_DOMAINS"] = "banque.example, Filiale.Example ,";
    process.env["EMAIL_FROM"] = "alerts@banque.example";
    process.env["EMAIL_ATTACHMENT_LIMIT_BYTES"] = "1048576";
    const cfg = getEmailConfig();
    expect(cfg.internalDomains).toEqual(["banque.example", "filiale.example"]);
    expect(cfg.from).toBe("alerts@banque.example");
    expect(cfg.attachmentLimitBytes).toBe(1_048_576);
  });

  it("NOTIF-004: liste vide ou plafond invalide → repli sur les défauts", () => {
    process.env["EMAIL_INTERNAL_DOMAINS"] = "  ,  ";
    process.env["EMAIL_ATTACHMENT_LIMIT_BYTES"] = "-5";
    const cfg = getEmailConfig();
    expect(cfg.internalDomains).toEqual([...DEFAULT_INTERNAL_DOMAINS]);
    expect(cfg.attachmentLimitBytes).toBe(DEFAULT_ATTACHMENT_LIMIT_BYTES);
  });

  it("RESEND-EMAIL: getEmailAdapter → mock par défaut (aucune config resend)", () => {
    expect(getEmailAdapter()).toBeInstanceOf(MockResendAdapter);
  });

  it("RESEND-EMAIL: getEmailAdapter → Resend si provider+clé+from présents (client injecté)", () => {
    process.env["EMAIL_PROVIDER"] = "resend";
    process.env["RESEND_API_KEY"] = "re_test_key";
    process.env["RESEND_FROM"] = "no-reply@prodestic.net";
    const adapter = getEmailAdapter({
      clientFactory: () => ({
        emails: { send: async () => ({ data: { id: "x" }, error: null }) },
      }),
    });
    expect(adapter).toBeInstanceOf(ResendEmailAdapter);
  });
});
