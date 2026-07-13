/**
 * Tests unitaires — config/sms : sélection fournisseur + résolution SMPP depuis
 * l'environnement (SMS-SMPP). Le MOCK reste le DÉFAUT ; SMPP n'est activé que si
 * demandé ET config complète. AUCUNE valeur en dur : tout vient de `process.env`.
 * Nommage strict : `SMS-SMPP: <description>`.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  getSmsConfig,
  resolveSmsProvider,
  resolveSmppConfig,
  DEFAULT_SMS_SENDER_ID,
} from "src/config/sms.js";

const SMPP_KEYS = [
  "SMS_PROVIDER",
  "SMPP_HOST",
  "SMPP_PORT",
  "SMPP_SYSTEM_ID",
  "SMPP_PASSWORD",
  "SMS_SENDER_ID",
  "SMPP_SOURCE_TON",
  "SMPP_SOURCE_NPI",
  "SMPP_DEST_TON",
  "SMPP_DEST_NPI",
  "SMPP_ENABLE_DLR",
] as const;

function clearEnv(): void {
  for (const k of SMPP_KEYS) delete process.env[k];
}

describe("config/sms", () => {
  beforeEach(clearEnv);
  afterEach(clearEnv);

  it("SMS-SMPP: défaut = mock (aucune variable) → provider mock, smpp null", () => {
    const cfg = getSmsConfig();
    expect(cfg.provider).toBe("mock");
    expect(cfg.smpp).toBeNull();
  });

  it("SMS-SMPP: SMS_PROVIDER inconnu → repli mock (jamais smpp par erreur)", () => {
    process.env["SMS_PROVIDER"] = "carrier-pigeon";
    expect(resolveSmsProvider()).toBe("mock");
  });

  it("SMS-SMPP: provider=smpp mais SMPP_HOST manquant → provider effectif mock", () => {
    process.env["SMS_PROVIDER"] = "smpp";
    process.env["SMPP_SYSTEM_ID"] = "sysid";
    process.env["SMPP_PASSWORD"] = "secret";
    const cfg = getSmsConfig();
    expect(cfg.provider).toBe("mock");
    expect(cfg.smpp).toBeNull();
  });

  it("SMS-SMPP: config complète → provider smpp + valeurs lues depuis env", () => {
    process.env["SMS_PROVIDER"] = "smpp";
    process.env["SMPP_HOST"] = "smsc.iam.example";
    process.env["SMPP_PORT"] = "2775";
    process.env["SMPP_SYSTEM_ID"] = "sysid";
    process.env["SMPP_PASSWORD"] = "secret";
    process.env["SMS_SENDER_ID"] = "ZENAPI";
    process.env["SMPP_SOURCE_TON"] = "5";
    process.env["SMPP_SOURCE_NPI"] = "0";
    process.env["SMPP_DEST_TON"] = "0";
    process.env["SMPP_DEST_NPI"] = "1";
    process.env["SMPP_ENABLE_DLR"] = "1";
    const cfg = getSmsConfig();
    expect(cfg.provider).toBe("smpp");
    expect(cfg.smpp).toEqual({
      host: "smsc.iam.example",
      port: 2775,
      systemId: "sysid",
      password: "secret",
      senderId: "ZENAPI",
      sourceTon: 5,
      sourceNpi: 0,
      destTon: 0,
      destNpi: 1,
      enableDlr: true,
    });
  });

  it("SMS-SMPP: défauts sûrs quand seuls host/id/pwd fournis (port 2775, sender ZENAPI, DLR on)", () => {
    process.env["SMS_PROVIDER"] = "smpp";
    process.env["SMPP_HOST"] = "smsc.example";
    process.env["SMPP_SYSTEM_ID"] = "sysid";
    process.env["SMPP_PASSWORD"] = "secret";
    const smpp = resolveSmppConfig();
    expect(smpp).not.toBeNull();
    expect(smpp?.port).toBe(2775);
    expect(smpp?.senderId).toBe(DEFAULT_SMS_SENDER_ID);
    expect(smpp?.sourceTon).toBe(5);
    expect(smpp?.destNpi).toBe(1);
    expect(smpp?.enableDlr).toBe(true);
  });

  it("SMS-SMPP: SMPP_ENABLE_DLR=0 → enableDlr false ; port invalide → défaut", () => {
    process.env["SMS_PROVIDER"] = "smpp";
    process.env["SMPP_HOST"] = "smsc.example";
    process.env["SMPP_SYSTEM_ID"] = "sysid";
    process.env["SMPP_PASSWORD"] = "secret";
    process.env["SMPP_ENABLE_DLR"] = "0";
    process.env["SMPP_PORT"] = "not-a-number";
    const smpp = resolveSmppConfig();
    expect(smpp?.enableDlr).toBe(false);
    expect(smpp?.port).toBe(2775);
  });

  it("SMS-SMPP: resolveSmppConfig retourne null si provider mock (pas de lecture secrète inutile)", () => {
    // provider mock ⇒ getSmsConfig ne lit PAS la config SMPP.
    process.env["SMPP_HOST"] = "smsc.example";
    process.env["SMPP_SYSTEM_ID"] = "sysid";
    process.env["SMPP_PASSWORD"] = "secret";
    const cfg = getSmsConfig();
    expect(cfg.provider).toBe("mock");
    expect(cfg.smpp).toBeNull();
  });
});
