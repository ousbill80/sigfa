/**
 * Tests unitaires — factory de sélection d'adaptateur SMS (SMS-SMPP).
 * Le MOCK reste le DÉFAUT ; SMPP n'est retourné que si demandé ET config présente.
 * AUCUNE connexion réseau : la factory ne fait qu'INSTANCIER (pas de bind ici).
 * Nommage strict : `SMS-SMPP: <description>`.
 */

import { describe, it, expect } from "vitest";
import { createSmsAdapter } from "src/services/sms-adapter-factory.js";
import { SmppSmsAdapter } from "src/services/smpp-sms-adapter.js";
import type { SmsConfig } from "src/config/sms.js";

const SMPP_OK: SmsConfig = {
  provider: "smpp",
  smpp: {
    host: "smsc.example",
    port: 2775,
    systemId: "sysid",
    password: "secret",
    senderId: "ZENAPI",
    sourceTon: 5,
    sourceNpi: 0,
    destTon: 0,
    destNpi: 1,
    enableDlr: true,
  },
};

describe("createSmsAdapter", () => {
  it("SMS-SMPP: config par défaut (mock) → adaptateur MOCK, pas de SMPP", () => {
    const adapter = createSmsAdapter({ provider: "mock", smpp: null });
    expect(adapter).not.toBeInstanceOf(SmppSmsAdapter);
    // Le mock répond sans réseau.
    expect(adapter.send).toBeTypeOf("function");
  });

  it("SMS-SMPP: provider=smpp SANS config → repli MOCK (jamais de bind incomplet)", () => {
    const adapter = createSmsAdapter({ provider: "smpp", smpp: null });
    expect(adapter).not.toBeInstanceOf(SmppSmsAdapter);
  });

  it("SMS-SMPP: provider=smpp AVEC config → SmppSmsAdapter (session lazy, pas de connexion)", () => {
    const adapter = createSmsAdapter(SMPP_OK, {
      // Injection d'un connecteur factice : la factory ne connecte PAS ici.
      connect: () => {
        throw new Error("ne doit pas connecter à l'instanciation");
      },
    });
    expect(adapter).toBeInstanceOf(SmppSmsAdapter);
  });
});
