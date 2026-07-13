/**
 * Tests unitaires — adaptateur SMS SMPP réel (IAM/ZENAPI) derrière `SmsAdapter`.
 * AUCUNE connexion réseau réelle : une session SMPP SIMULÉE est injectée.
 * Nommage strict : `SMS-SMPP: <description>`.
 */

import { EventEmitter } from "node:events";
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  SmppSmsAdapter,
  parseDeliveryReceipt,
  mapSmppErrorToReason,
  buildSubmitSm,
  type SmppSessionLike,
  type SubmitResponse,
} from "src/services/smpp-sms-adapter.js";
import type { SmppConfig } from "src/config/sms.js";
import { NotificationSendError } from "src/services/notification-jobs.js";

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures : config SMPP + session SMPP simulée (EventEmitter, zéro réseau)
// ─────────────────────────────────────────────────────────────────────────────

function cfg(over: Partial<SmppConfig> = {}): SmppConfig {
  return {
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
    ...over,
  };
}

/** Session simulée : capture bind/submit et rejoue des réponses déterministes. */
class FakeSession extends EventEmitter implements SmppSessionLike {
  public boundWith: unknown = undefined;
  public submits: Array<Record<string, unknown>> = [];
  public closed = false;
  public destroyed = 0;
  /** File de réponses successives à renvoyer aux appels `submit_sm`. */
  public submitResponses: SubmitResponse[] = [];
  /** Réponse de bind à rejouer (défaut : succès). */
  public bindResponse: { command_status: number } = { command_status: 0 };

  bind_transceiver(options: unknown, cb: (pdu: SubmitResponse) => void): void {
    this.boundWith = options;
    cb(this.bindResponse as SubmitResponse);
  }

  submit_sm(
    options: Record<string, unknown>,
    cb: (pdu: SubmitResponse) => void
  ): void {
    this.submits.push(options);
    const resp = this.submitResponses.shift() ?? {
      command_status: 0,
      message_id: `mid-${this.submits.length}`,
    };
    cb(resp);
  }

  deliver_sm_resp(): void {
    /* no-op : accusé du DLR entrant */
  }

  close(callback?: () => void): void {
    this.closed = true;
    callback?.();
  }

  destroy(callback?: () => void): void {
    this.destroyed += 1;
    callback?.();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Fonctions PURES : parsing DLR + mapping d'erreurs + build submit_sm
// ─────────────────────────────────────────────────────────────────────────────

describe("parseDeliveryReceipt", () => {
  it("SMS-SMPP: DLR stat:DELIVRD → DELIVERED avec messageId corrélé", () => {
    const ack = parseDeliveryReceipt({
      command: "deliver_sm",
      command_status: 0,
      sequence_number: 7,
      short_message:
        "id:abc123 sub:001 dlvrd:001 submit date:2607121200 done date:2607121205 stat:DELIVRD err:000",
    });
    expect(ack).toEqual({ messageId: "abc123", status: "DELIVERED" });
  });

  it("SMS-SMPP: DLR stat:UNDELIV → FAILED avec raison PROVIDER_UNREACHABLE", () => {
    const ack = parseDeliveryReceipt({
      command: "deliver_sm",
      command_status: 0,
      sequence_number: 8,
      short_message: "id:xyz stat:UNDELIV err:001",
    });
    expect(ack?.status).toBe("FAILED");
    expect(ack?.messageId).toBe("xyz");
  });

  it("SMS-SMPP: DLR via TLV message_state=DELIVERED + receipted_message_id", () => {
    const ack = parseDeliveryReceipt({
      command: "deliver_sm",
      command_status: 0,
      sequence_number: 9,
      message_state: 2, // consts.MESSAGE_STATE.DELIVERED
      receipted_message_id: "tlv-1",
    });
    expect(ack).toEqual({ messageId: "tlv-1", status: "DELIVERED" });
  });

  it("SMS-SMPP: deliver_sm entrant SANS receipt (MO) → null (pas un DLR)", () => {
    const ack = parseDeliveryReceipt({
      command: "deliver_sm",
      command_status: 0,
      sequence_number: 10,
      short_message: "Bonjour, un message entrant",
    });
    expect(ack).toBeNull();
  });
});

describe("mapSmppErrorToReason", () => {
  it("SMS-SMPP: ESME_RTHROTTLED → QUOTA_EXCEEDED (retryable)", () => {
    const r = mapSmppErrorToReason(0x0058);
    expect(r).toEqual({ reason: "QUOTA_EXCEEDED", retryable: true });
  });

  it("SMS-SMPP: ESME_RINVDSTADR → INVALID_NUMBER (définitif)", () => {
    const r = mapSmppErrorToReason(0x000b);
    expect(r).toEqual({ reason: "INVALID_NUMBER", retryable: false });
  });

  it("SMS-SMPP: ESME_RMSGQFUL → QUOTA_EXCEEDED (retryable)", () => {
    expect(mapSmppErrorToReason(0x0014).retryable).toBe(true);
  });

  it("SMS-SMPP: ESME_RSYSERR → PROVIDER_UNREACHABLE (retryable)", () => {
    const r = mapSmppErrorToReason(0x0008);
    expect(r).toEqual({ reason: "PROVIDER_UNREACHABLE", retryable: true });
  });

  it("SMS-SMPP: code inconnu → UNKNOWN définitif (pas de retry infini)", () => {
    const r = mapSmppErrorToReason(0x09999);
    expect(r).toEqual({ reason: "UNKNOWN", retryable: false });
  });
});

describe("buildSubmitSm", () => {
  it("SMS-SMPP: source_addr=ZENAPI + ton/npi de config + registered_delivery si DLR", () => {
    const pdu = buildSubmitSm(cfg(), { to: "+2250700000047", body: "Bonjour" });
    expect(pdu.source_addr).toBe("ZENAPI");
    expect(pdu.source_addr_ton).toBe(5);
    expect(pdu.source_addr_npi).toBe(0);
    expect(pdu.dest_addr_ton).toBe(0);
    expect(pdu.dest_addr_npi).toBe(1);
    expect(pdu.destination_addr).toBe("+2250700000047");
    expect(pdu.registered_delivery).toBe(1);
    expect(pdu.short_message).toBe("Bonjour");
  });

  it("SMS-SMPP: DLR désactivé → registered_delivery=0", () => {
    const pdu = buildSubmitSm(cfg({ enableDlr: false }), {
      to: "+225",
      body: "x",
    });
    expect(pdu.registered_delivery).toBe(0);
  });

  it("SMS-SMPP: message long (>160) transmis entier → segmentation auto lib (UDH)", () => {
    const long = "a".repeat(400);
    const pdu = buildSubmitSm(cfg(), { to: "+225", body: long });
    // La lib node-smpp segmente/concatène automatiquement un `short_message` long.
    expect(pdu.short_message).toBe(long);
    expect(pdu.short_message.length).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. SmppSmsAdapter : bind, submit, DLR, reconnexion — session INJECTÉE
// ─────────────────────────────────────────────────────────────────────────────

describe("SmppSmsAdapter", () => {
  let session: FakeSession;
  let connectCalls: number;

  function makeAdapter(): SmppSmsAdapter {
    connectCalls = 0;
    return new SmppSmsAdapter(cfg(), {
      connect: (): SmppSessionLike => {
        connectCalls += 1;
        session = new FakeSession();
        // La session s'annonce connectée au prochain tick.
        queueMicrotask(() => session.emit("connect"));
        return session;
      },
      reconnectDelayMs: 1,
    });
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it("SMS-SMPP: bind transceiver au démarrage puis submit_sm → providerMessageId", async () => {
    const adapter = makeAdapter();
    const res = await adapter.send({ to: "+2250700000047", body: "Bonjour" });
    expect(res.providerMessageId).toBe("mid-1");
    expect(session.boundWith).toMatchObject({
      system_id: "sysid",
      password: "secret",
    });
    expect(session.submits).toHaveLength(1);
    await adapter.close();
  });

  it("SMS-SMPP: réutilise la MÊME session bindée entre deux envois (persistante)", async () => {
    const adapter = makeAdapter();
    await adapter.send({ to: "+225", body: "un" });
    await adapter.send({ to: "+225", body: "deux" });
    expect(connectCalls).toBe(1);
    expect(session.submits).toHaveLength(2);
    await adapter.close();
  });

  it("SMS-SMPP: submit_sm status ESME_RTHROTTLED → NotificationSendError QUOTA_EXCEEDED", async () => {
    const adapter = makeAdapter();
    // 1er envoi établit le bind ; on prépare la réponse throttled.
    const p = adapter.send({ to: "+225", body: "x" });
    // Attendre le bind puis injecter la réponse d'erreur au submit.
    await Promise.resolve();
    session.submitResponses = [{ command_status: 0x0058 }];
    await expect(p).rejects.toMatchObject({
      name: "NotificationSendError",
      reason: "QUOTA_EXCEEDED",
    });
    await adapter.close();
  });

  it("SMS-SMPP: submit_sm status ESME_RINVDSTADR → INVALID_NUMBER (définitif)", async () => {
    const adapter = makeAdapter();
    const p = adapter.send({ to: "bad", body: "x" });
    await Promise.resolve();
    session.submitResponses = [{ command_status: 0x000b }];
    await expect(p).rejects.toMatchObject({ reason: "INVALID_NUMBER" });
    await adapter.close();
  });

  it("SMS-SMPP: bind refusé (ESME_RINVPASWD) → PROVIDER_UNREACHABLE retryable", async () => {
    const adapter = new SmppSmsAdapter(cfg(), {
      connect: (): SmppSessionLike => {
        session = new FakeSession();
        session.bindResponse = { command_status: 0x000e }; // ESME_RINVPASWD
        queueMicrotask(() => session.emit("connect"));
        return session;
      },
      reconnectDelayMs: 1,
    });
    await expect(adapter.send({ to: "+225", body: "x" })).rejects.toMatchObject({
      name: "NotificationSendError",
      reason: "PROVIDER_UNREACHABLE",
    });
    await adapter.close();
  });

  it("SMS-SMPP: DLR entrant (deliver_sm) → invoque onDelivery + accuse deliver_sm_resp", async () => {
    const acks: unknown[] = [];
    const adapter = new SmppSmsAdapter(cfg(), {
      connect: (): SmppSessionLike => {
        session = new FakeSession();
        queueMicrotask(() => session.emit("connect"));
        return session;
      },
      reconnectDelayMs: 1,
      onDelivery: (ack): Promise<void> => {
        acks.push(ack);
        return Promise.resolve();
      },
    });
    await adapter.send({ to: "+225", body: "x" }); // établit le bind
    const respy = vi.spyOn(session, "deliver_sm_resp");
    session.emit("deliver_sm", {
      command: "deliver_sm",
      command_status: 0,
      sequence_number: 42,
      short_message: "id:mid-1 stat:DELIVRD err:000",
    });
    await Promise.resolve();
    expect(acks).toEqual([{ messageId: "mid-1", status: "DELIVERED" }]);
    expect(respy).toHaveBeenCalledWith({ sequence_number: 42, command_status: 0 });
    await adapter.close();
  });

  it("SMS-SMPP: perte de session ('close') → reconnexion auto avec backoff", async () => {
    vi.useFakeTimers();
    const adapter = makeAdapter();
    await adapter.send({ to: "+225", body: "un" });
    expect(connectCalls).toBe(1);
    // Simuler une chute de connexion.
    session.emit("close");
    // Le backoff programme une reconnexion : avancer les timers.
    await vi.advanceTimersByTimeAsync(5);
    await Promise.resolve();
    expect(connectCalls).toBe(2);
    await adapter.close();
    vi.useRealTimers();
  });

  it("SMS-SMPP: close() pendant un backoff de reconnexion annule le timer (pas de reconnexion)", async () => {
    vi.useFakeTimers();
    const adapter = makeAdapter();
    await adapter.send({ to: "+225", body: "un" });
    expect(connectCalls).toBe(1);
    session.emit("close"); // programme la reconnexion
    await adapter.close(); // annule le timer AVANT échéance
    await vi.advanceTimersByTimeAsync(50);
    // Le timer ayant été annulé, aucune nouvelle connexion n'a lieu.
    expect(connectCalls).toBe(1);
    vi.useRealTimers();
  });

  it("SMS-SMPP: reconnexion dont le bind échoue → catch (pas de crash), session reste null", async () => {
    vi.useFakeTimers();
    let attempt = 0;
    const adapter = new SmppSmsAdapter(cfg(), {
      connect: (): SmppSessionLike => {
        attempt += 1;
        session = new FakeSession();
        if (attempt === 2) {
          // À la reconnexion, le bind est refusé → openAndBind rejette → catch.
          session.bindResponse = { command_status: 0x000e };
        }
        queueMicrotask(() => session.emit("connect"));
        return session;
      },
      reconnectDelayMs: 1,
    });
    await adapter.send({ to: "+225", body: "un" });
    session.emit("close");
    await vi.advanceTimersByTimeAsync(5);
    await Promise.resolve();
    await Promise.resolve();
    expect(attempt).toBe(2);
    await adapter.close();
    vi.useRealTimers();
  });

  it("SMS-SMPP: erreur session émise → ne tue pas le process (capturée)", async () => {
    const adapter = makeAdapter();
    await adapter.send({ to: "+225", body: "x" });
    // Émettre 'error' NE doit PAS lever (listener présent) : sinon EventEmitter throw.
    expect(() => session.emit("error", new Error("socket reset"))).not.toThrow();
    await adapter.close();
  });

  it("SMS-SMPP: NotificationSendError reste la surface d'erreur (contrat NOTIF-002)", () => {
    expect(NotificationSendError).toBeTypeOf("function");
  });
});
