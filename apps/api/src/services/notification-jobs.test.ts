/**
 * Tests unitaires PURS — NOTIF-001 : clé d'idempotence, backoff full-jitter borné,
 * santé des files. Déterministes (fake-timers via `rng` injecté, pas de sleep réel,
 * pas de conteneur). Le cycle de vie complet (retry/DLQ/idempotence/tenant D5) est
 * couvert par `notification-queue.integration.test.ts` (Testcontainers réels).
 *
 * Nommage strict : `NOTIF-001: <description>`.
 *
 * @module
 */

import { describe, it, expect, vi } from "vitest";
import {
  notificationDedupeKey,
  computeBackoffDelay,
  backoffUpperBound,
  getQueueHealth,
  processNotificationJob,
  markNotificationFailed,
  TenantMismatchError,
  NotificationSendError,
  type CountableQueue,
  type DedupeKeyInput,
  type NotificationJobData,
  type QueryFn,
} from "src/services/notification-jobs.js";
import {
  getNotificationConfig,
  DEFAULT_BACKOFF_BASE_MS,
  DEFAULT_BACKOFF_CAP_MS,
  DEFAULT_MAX_ATTEMPTS,
} from "src/config/notifications.js";

const baseInput: DedupeKeyInput = {
  bankId: "11111111-1111-1111-1111-111111111111",
  ticketId: "22222222-2222-2222-2222-222222222222",
  type: "TICKET_CONFIRMATION",
  channel: "SMS",
  phoneHash: "abc",
};

describe("NOTIF-001 dedupe_key déterministe", () => {
  it("NOTIF-001: mêmes entrées → même clé (idempotence de re-enqueue)", () => {
    expect(notificationDedupeKey(baseInput)).toBe(notificationDedupeKey(baseInput));
  });

  it("NOTIF-001: entrée différente → clé différente (bank/ticket/type/channel/cible)", () => {
    const key = notificationDedupeKey(baseInput);
    expect(notificationDedupeKey({ ...baseInput, bankId: "x" })).not.toBe(key);
    expect(notificationDedupeKey({ ...baseInput, ticketId: "y" })).not.toBe(key);
    expect(notificationDedupeKey({ ...baseInput, type: "YOUR_TURN" })).not.toBe(key);
    expect(notificationDedupeKey({ ...baseInput, channel: "WHATSAPP" })).not.toBe(key);
    expect(notificationDedupeKey({ ...baseInput, phoneHash: "zzz" })).not.toBe(key);
  });

  it("NOTIF-001: pas de collision par concaténation (séparateur préservé)", () => {
    const a = notificationDedupeKey({ ...baseInput, type: "AB", channel: "SMS" });
    const b = notificationDedupeKey({ ...baseInput, type: "A", channel: "SMS" });
    expect(a).not.toBe(b);
  });

  it("NOTIF-001: PUSH sans phoneHash utilise deviceId", () => {
    const push: DedupeKeyInput = {
      ...baseInput,
      channel: "PUSH",
      phoneHash: null,
      deviceId: "dev-1",
    };
    expect(notificationDedupeKey(push)).not.toBe(
      notificationDedupeKey({ ...push, deviceId: "dev-2" })
    );
  });

  it("NOTIF-001: clé = SHA-256 hex 64 caractères", () => {
    expect(notificationDedupeKey(baseInput)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("NOTIF-001 backoff full-jitter borné (D3)", () => {
  const params = { baseMs: 5_000, capMs: 300_000 };

  it("NOTIF-001: borne supérieure = min(cap, base·2^(n-1)) — croissance expo puis plafond", () => {
    expect(backoffUpperBound(1, params)).toBe(5_000);
    expect(backoffUpperBound(2, params)).toBe(10_000);
    expect(backoffUpperBound(3, params)).toBe(20_000);
    expect(backoffUpperBound(4, params)).toBe(40_000);
    expect(backoffUpperBound(5, params)).toBe(80_000);
    // Plafond atteint : 5000·2^7 = 640000 > 300000 → plafonné.
    expect(backoffUpperBound(8, params)).toBe(300_000);
    expect(backoffUpperBound(20, params)).toBe(300_000);
  });

  it("NOTIF-001: délai ∈ [0, min(cap, base·2^n)] pour tout tirage rng (appartenance, pas 'présent')", () => {
    // Balaye tout l'intervalle de rng et toutes les tentatives : appartenance stricte.
    for (let attempt = 1; attempt <= DEFAULT_MAX_ATTEMPTS + 3; attempt++) {
      const upper = backoffUpperBound(attempt, params);
      for (const r of [0, 0.25, 0.5, 0.75, 0.999999]) {
        const delay = computeBackoffDelay(attempt, params, () => r);
        expect(delay).toBeGreaterThanOrEqual(0);
        expect(delay).toBeLessThanOrEqual(upper);
      }
    }
  });

  it("NOTIF-001: rng=0 → délai 0 ; rng→1 → délai = borne (full jitter)", () => {
    const upper = backoffUpperBound(3, params);
    expect(computeBackoffDelay(3, params, () => 0)).toBe(0);
    expect(computeBackoffDelay(3, params, () => 0.999999999)).toBe(upper);
  });

  it("NOTIF-001: défauts D3 verrouillés (base 5s, cap 5min, 5 tentatives)", () => {
    expect(DEFAULT_BACKOFF_BASE_MS).toBe(5_000);
    expect(DEFAULT_BACKOFF_CAP_MS).toBe(300_000);
    expect(DEFAULT_MAX_ATTEMPTS).toBe(5);
    const cfg = getNotificationConfig();
    expect(cfg.backoffBaseMs).toBe(5_000);
    expect(cfg.backoffCapMs).toBe(300_000);
    expect(cfg.maxAttempts).toBe(5);
  });

  it("NOTIF-001: config injectable via env (override backoff/concurrency/prefix)", () => {
    const saved = { ...process.env };
    try {
      process.env["NOTIF_BACKOFF_BASE_MS"] = "1000";
      process.env["NOTIF_CHANNEL_CONCURRENCY"] = "3";
      process.env["NOTIF_QUEUE_PREFIX"] = "sigfa-test";
      const cfg = getNotificationConfig();
      expect(cfg.backoffBaseMs).toBe(1000);
      expect(cfg.channelConcurrency).toBe(3);
      expect(cfg.queuePrefix).toBe("sigfa-test");
    } finally {
      process.env = saved;
    }
  });
});

describe("NOTIF-001 getQueueHealth", () => {
  function fakeQueue(name: string, counts: Record<string, number>): CountableQueue {
    return {
      name,
      getJobCounts: async (...types: string[]) => {
        const out: Record<string, number> = {};
        for (const t of types) out[t] = counts[t] ?? 0;
        return out;
      },
    };
  }

  it("NOTIF-001: retourne les compteurs par file (waiting/active/failed/completed/delayed)", async () => {
    const sms = fakeQueue("notifications:sms", {
      waiting: 2,
      active: 1,
      failed: 0,
      completed: 5,
      delayed: 3,
    });
    const dlq = fakeQueue("notifications:dlq", {});
    const health = await getQueueHealth([sms], dlq);
    const entry = health.channels[0];
    expect(entry).toBeDefined();
    expect(entry?.name).toBe("notifications:sms");
    expect(entry?.counts).toEqual({
      waiting: 2,
      active: 1,
      failed: 0,
      completed: 5,
      delayed: 3,
    });
    expect(health.dlq.name).toBe("notifications:dlq");
  });

  it("NOTIF-001: healthy=false dès qu'un job attend en DLQ", async () => {
    const dlqEmpty = fakeQueue("notifications:dlq", {});
    const dlqFull = fakeQueue("notifications:dlq", { waiting: 1 });
    expect((await getQueueHealth([], dlqEmpty)).healthy).toBe(true);
    expect((await getQueueHealth([], dlqFull)).healthy).toBe(false);
  });

  it("NOTIF-001: compteurs absents (file vide) → normalisés à 0", async () => {
    // getJobCounts retourne un objet SANS les clés → chaque compteur retombe à 0.
    const sparse: CountableQueue = {
      name: "notifications:push",
      getJobCounts: async () => ({}),
    };
    const dlq: CountableQueue = {
      name: "notifications:dlq",
      getJobCounts: async () => ({}),
    };
    const health = await getQueueHealth([sparse], dlq);
    expect(health.channels[0]?.counts).toEqual({
      waiting: 0,
      active: 0,
      failed: 0,
      completed: 0,
      delayed: 0,
    });
    expect(health.healthy).toBe(true);
  });
});

// ── Worker noop : garde tenant D5 + idempotence (queryFn stubbé, sans conteneur) ──

const job: NotificationJobData = {
  bankId: "bank-A",
  dedupeKey: "dk",
  logId: "log-1",
  ticketId: null,
  type: "TICKET_CONFIRMATION",
  channel: "SMS",
};

/** Construit un queryFn stub : SELECT renvoie `selectRows`, UPDATE/BEGIN/... vides. */
function stubQuery(selectRows: Record<string, unknown>[]): {
  queryFn: QueryFn;
  sql: string[];
} {
  const sql: string[] = [];
  const queryFn: QueryFn = async (s: string) => {
    sql.push(s);
    if (/^SELECT/i.test(s.trim())) return { rows: selectRows };
    return { rows: [] };
  };
  return { queryFn, sql };
}

describe("NOTIF-001 processNotificationJob (D5 + idempotence)", () => {
  it("NOTIF-001: QUEUED + envoi OK → SENT + UPDATE avec provider_message_id", async () => {
    const { queryFn, sql } = stubQuery([
      { id: "log-1", bank_id: "bank-A", status: "QUEUED" },
    ]);
    const send = vi.fn(async () => ({ providerMessageId: "MID-1" }));
    const res = await processNotificationJob(job, { queryFn, send });
    expect(res).toEqual({ status: "SENT", providerMessageId: "MID-1" });
    expect(send).toHaveBeenCalledOnce();
    // Garde tenant explicite dans les WHERE (D5) + transition status.
    expect(sql.some((s) => /SET LOCAL app.current_bank_id = 'bank-A'/.test(s))).toBe(true);
    expect(sql.some((s) => /UPDATE notification_log[\s\S]*SENT[\s\S]*MID-1/.test(s))).toBe(true);
    expect(sql.some((s) => /bank_id = 'bank-A'/.test(s))).toBe(true);
  });

  it("NOTIF-001: envoi OK SANS providerMessageId → SENT + provider_message_id NULL", async () => {
    const { queryFn, sql } = stubQuery([
      { id: "log-1", bank_id: "bank-A", status: "QUEUED" },
    ]);
    const res = await processNotificationJob(job, {
      queryFn,
      send: async () => ({}),
    });
    expect(res).toEqual({ status: "SENT" });
    expect(sql.some((s) => /provider_message_id = NULL/.test(s))).toBe(true);
  });

  it("NOTIF-001: log déjà SENT/DELIVERED → ALREADY_SENT, aucun envoi (idempotence)", async () => {
    for (const status of ["SENT", "DELIVERED"]) {
      const { queryFn } = stubQuery([{ id: "log-1", bank_id: "bank-A", status }]);
      const send = vi.fn(async () => ({ providerMessageId: "x" }));
      const res = await processNotificationJob(job, { queryFn, send });
      expect(res).toEqual({ status: "ALREADY_SENT" });
      expect(send).not.toHaveBeenCalled();
    }
  });

  it("NOTIF-001: log invisible sous le tenant du job → TenantMismatchError, aucun envoi (D5)", async () => {
    const { queryFn } = stubQuery([]); // SELECT bank_id filtré → 0 ligne
    const send = vi.fn(async () => ({ providerMessageId: "x" }));
    await expect(processNotificationJob(job, { queryFn, send })).rejects.toBeInstanceOf(
      TenantMismatchError
    );
    expect(send).not.toHaveBeenCalled();
  });

  it("NOTIF-001: échec d'envoi propage (retry) → le log NE passe PAS SENT", async () => {
    const { queryFn, sql } = stubQuery([
      { id: "log-1", bank_id: "bank-A", status: "QUEUED" },
    ]);
    await expect(
      processNotificationJob(job, {
        queryFn,
        send: async () => {
          throw new NotificationSendError("PROVIDER_UNREACHABLE");
        },
      })
    ).rejects.toBeInstanceOf(NotificationSendError);
    expect(sql.some((s) => /SET[\s\S]*status = 'SENT'/.test(s))).toBe(false);
  });
});

describe("NOTIF-001 markNotificationFailed (D5)", () => {
  it("NOTIF-001: passe le log FAILED avec failure_reason + garde bank_id (D5)", async () => {
    const { queryFn, sql } = stubQuery([]);
    await markNotificationFailed(job, "QUOTA_EXCEEDED", queryFn);
    const upd = sql.find((s) => /UPDATE notification_log/.test(s));
    expect(upd).toBeDefined();
    expect(upd).toMatch(/status = 'FAILED'/);
    expect(upd).toMatch(/failure_reason = 'QUOTA_EXCEEDED'/);
    expect(upd).toMatch(/bank_id = 'bank-A'/);
    expect(upd).toMatch(/status NOT IN \('SENT','DELIVERED'\)/);
  });
});
