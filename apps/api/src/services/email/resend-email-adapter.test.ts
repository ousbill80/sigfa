/**
 * Tests unitaires — RESEND-EMAIL : adaptateur RÉEL `ResendEmailAdapter` (SDK resend)
 * derrière l'interface `EmailAdapter` (NOTIF-004) + factory `createEmailAdapter`.
 *
 * ZÉRO appel réseau réel : le client Resend est INJECTÉ (double de test). Chaque
 * issue fournisseur (2xx succès / 429 quota / 5xx transitoire / auth / adresse
 * invalide) est simulée de façon déterministe et mappée sur `NotificationFailureReason`.
 *
 * Nommage strict : `RESEND-EMAIL: <description>`.
 *
 * @module
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  ResendEmailAdapter,
  createEmailAdapter,
  mapResendError,
  type ResendClientLike,
  type ResendErrorLike,
} from "src/services/email/resend-email-adapter.js";
import {
  MockResendAdapter,
  EmailSendError,
  type EmailMessage,
} from "src/services/email/email-adapter.js";

function msg(overrides: Partial<EmailMessage> = {}): EmailMessage {
  return {
    to: ["manager@banque.example"],
    from: "no-reply@banque.example",
    subject: "Rapport journalier",
    html: "<p>corps</p>",
    ...overrides,
  };
}

/**
 * Fabrique un client Resend simulé injectable : capture les options d'appel et
 * retourne le `Response` fourni. AUCUN réseau.
 */
function fakeClient(
  response:
    | { data: { id: string }; error: null }
    | { data: null; error: ResendErrorLike }
): { client: ResendClientLike; calls: Parameters<ResendClientLike["emails"]["send"]>[0][] } {
  const calls: Parameters<ResendClientLike["emails"]["send"]>[0][] = [];
  const client: ResendClientLike = {
    emails: {
      send: async (options) => {
        calls.push(options);
        return response;
      },
    },
  };
  return { client, calls };
}

const ok = { data: { id: "resend-msg-123" }, error: null } as const;

describe("RESEND-EMAIL ResendEmailAdapter — client injecté, aucun réseau", () => {
  it("RESEND-EMAIL: 2xx Resend → ACCEPTED + providerMessageId (id renvoyé)", async () => {
    const { client, calls } = fakeClient(ok);
    const adapter = new ResendEmailAdapter({ client, from: "no-reply@banque.example" });
    const res = await adapter.send(msg());
    expect(res).toEqual({ status: "ACCEPTED", providerMessageId: "resend-msg-123" });
    expect(calls).toHaveLength(1);
  });

  it("RESEND-EMAIL: from = RESEND_FROM injecté (jamais celui du message si config présente)", async () => {
    const { client, calls } = fakeClient(ok);
    const adapter = new ResendEmailAdapter({ client, from: "config@banque.example" });
    await adapter.send(msg({ from: "autre@banque.example" }));
    expect(calls[0]?.from).toBe("config@banque.example");
  });

  it("RESEND-EMAIL: to/subject/html du gabarit transmis tels quels", async () => {
    const { client, calls } = fakeClient(ok);
    const adapter = new ResendEmailAdapter({ client, from: "no-reply@banque.example" });
    await adapter.send(
      msg({
        to: ["a@banque.example", "b@banque.example"],
        subject: "Sujet X",
        html: "<h1>Bonjour</h1>",
      })
    );
    expect(calls[0]?.to).toEqual(["a@banque.example", "b@banque.example"]);
    expect(calls[0]?.subject).toBe("Sujet X");
    expect(calls[0]?.html).toBe("<h1>Bonjour</h1>");
  });

  it("RESEND-EMAIL: pièces jointes en ligne → mappées (filename/content base64/contentType)", async () => {
    const { client, calls } = fakeClient(ok);
    const adapter = new ResendEmailAdapter({ client, from: "no-reply@banque.example" });
    await adapter.send(
      msg({
        attachments: [
          { filename: "rapport.pdf", contentBase64: "QUJD", contentType: "application/pdf" },
        ],
      })
    );
    expect(calls[0]?.attachments).toEqual([
      { filename: "rapport.pdf", content: "QUJD", contentType: "application/pdf" },
    ]);
  });

  it("RESEND-EMAIL: sans pièce jointe → champ attachments omis", async () => {
    const { client, calls } = fakeClient(ok);
    const adapter = new ResendEmailAdapter({ client, from: "no-reply@banque.example" });
    await adapter.send(msg());
    expect(calls[0]?.attachments).toBeUndefined();
  });

  it("RESEND-EMAIL: 429 rate_limit → EmailSendError QUOTA_EXCEEDED retryable", async () => {
    const { client } = fakeClient({
      data: null,
      error: { name: "rate_limit_exceeded", statusCode: 429, message: "slow down" },
    });
    const adapter = new ResendEmailAdapter({ client, from: "no-reply@banque.example" });
    await expect(adapter.send(msg())).rejects.toMatchObject({
      name: "EmailSendError",
      reason: "QUOTA_EXCEEDED",
      retryable: true,
    });
  });

  it("RESEND-EMAIL: quota mensuel → QUOTA_EXCEEDED retryable", async () => {
    const { client } = fakeClient({
      data: null,
      error: { name: "monthly_quota_exceeded", statusCode: 422, message: "quota" },
    });
    const adapter = new ResendEmailAdapter({ client, from: "no-reply@banque.example" });
    await expect(adapter.send(msg())).rejects.toMatchObject({
      reason: "QUOTA_EXCEEDED",
      retryable: true,
    });
  });

  it("RESEND-EMAIL: 5xx internal_server_error → PROVIDER_UNREACHABLE retryable", async () => {
    const { client } = fakeClient({
      data: null,
      error: { name: "internal_server_error", statusCode: 500, message: "boom" },
    });
    const adapter = new ResendEmailAdapter({ client, from: "no-reply@banque.example" });
    await expect(adapter.send(msg())).rejects.toMatchObject({
      reason: "PROVIDER_UNREACHABLE",
      retryable: true,
    });
  });

  it("RESEND-EMAIL: adresse invalide (validation_error) → INVALID_NUMBER définitif (bounce dur)", async () => {
    const { client } = fakeClient({
      data: null,
      error: { name: "validation_error", statusCode: 422, message: "bad to" },
    });
    const adapter = new ResendEmailAdapter({ client, from: "no-reply@banque.example" });
    await expect(adapter.send(msg())).rejects.toMatchObject({
      reason: "INVALID_NUMBER",
      retryable: false,
    });
  });

  it("RESEND-EMAIL: from invalide → INVALID_NUMBER définitif", async () => {
    const { client } = fakeClient({
      data: null,
      error: { name: "invalid_from_address", statusCode: 422, message: "bad from" },
    });
    const adapter = new ResendEmailAdapter({ client, from: "no-reply@banque.example" });
    await expect(adapter.send(msg())).rejects.toMatchObject({
      reason: "INVALID_NUMBER",
      retryable: false,
    });
  });

  it("RESEND-EMAIL: clé API invalide/auth → UNKNOWN définitif (DLQ, jamais retry infini)", async () => {
    const { client } = fakeClient({
      data: null,
      error: { name: "invalid_api_key", statusCode: 401, message: "auth" },
    });
    const adapter = new ResendEmailAdapter({ client, from: "no-reply@banque.example" });
    await expect(adapter.send(msg())).rejects.toMatchObject({
      reason: "UNKNOWN",
      retryable: false,
    });
  });

  it("RESEND-EMAIL: réponse sans data ni error (dégénérée) → PROVIDER_UNREACHABLE retryable", async () => {
    const client: ResendClientLike = {
      emails: {
        send: async () => ({ data: null, error: null } as unknown as { data: { id: string }; error: null }),
      },
    };
    const adapter = new ResendEmailAdapter({ client, from: "no-reply@banque.example" });
    await expect(adapter.send(msg())).rejects.toMatchObject({
      reason: "PROVIDER_UNREACHABLE",
      retryable: true,
    });
  });

  it("RESEND-EMAIL: rejet réseau du SDK (throw) → PROVIDER_UNREACHABLE retryable", async () => {
    const client: ResendClientLike = {
      emails: {
        send: async () => {
          throw new Error("ECONNRESET");
        },
      },
    };
    const adapter = new ResendEmailAdapter({ client, from: "no-reply@banque.example" });
    await expect(adapter.send(msg())).rejects.toMatchObject({
      name: "EmailSendError",
      reason: "PROVIDER_UNREACHABLE",
      retryable: true,
    });
  });

  it("RESEND-EMAIL: erreur Resend inconnue → UNKNOWN non retryable", () => {
    const err = mapResendError({
      name: "something_unheard_of",
      statusCode: 418,
      message: "teapot",
    } as unknown as ResendErrorLike);
    expect(err).toBeInstanceOf(EmailSendError);
    expect(err.reason).toBe("UNKNOWN");
    expect(err.retryable).toBe(false);
  });

  it("RESEND-EMAIL: 5xx sans name reconnu → PROVIDER_UNREACHABLE retryable (fallback statusCode)", () => {
    const err = mapResendError({
      name: "application_error",
      statusCode: 503,
      message: "unavailable",
    });
    expect(err.reason).toBe("PROVIDER_UNREACHABLE");
    expect(err.retryable).toBe(true);
  });

  it("RESEND-EMAIL: statusCode null + code inconnu → UNKNOWN définitif (branche statusCode ?? 0)", () => {
    const err = mapResendError({ name: "invalid_access", statusCode: null, message: "no" });
    expect(err.reason).toBe("UNKNOWN");
    expect(err.retryable).toBe(false);
  });

  it("RESEND-EMAIL: rejet SDK non-Error (throw d'une valeur) → PROVIDER_UNREACHABLE retryable", async () => {
    const client: ResendClientLike = {
      emails: {
        send: async () => {
          throw "panne opaque";
        },
      },
    };
    const adapter = new ResendEmailAdapter({ client, from: "no-reply@banque.example" });
    await expect(adapter.send(msg())).rejects.toMatchObject({
      reason: "PROVIDER_UNREACHABLE",
      retryable: true,
    });
  });
});

describe("RESEND-EMAIL createEmailAdapter — factory gated, mock par défaut", () => {
  const OLD = { ...process.env };
  afterEach(() => {
    process.env = { ...OLD };
    vi.restoreAllMocks();
  });

  it("RESEND-EMAIL: EMAIL_PROVIDER absent → MockResendAdapter (défaut)", () => {
    const env = {} as NodeJS.ProcessEnv;
    const adapter = createEmailAdapter(env);
    expect(adapter).toBeInstanceOf(MockResendAdapter);
  });

  it("RESEND-EMAIL: EMAIL_PROVIDER=mock → MockResendAdapter", () => {
    const adapter = createEmailAdapter({ EMAIL_PROVIDER: "mock" } as NodeJS.ProcessEnv);
    expect(adapter).toBeInstanceOf(MockResendAdapter);
  });

  it("RESEND-EMAIL: EMAIL_PROVIDER=resend SANS clé → repli MockResendAdapter (jamais de crash)", () => {
    const adapter = createEmailAdapter({ EMAIL_PROVIDER: "resend" } as NodeJS.ProcessEnv);
    expect(adapter).toBeInstanceOf(MockResendAdapter);
  });

  it("RESEND-EMAIL: EMAIL_PROVIDER=resend + RESEND_API_KEY + RESEND_FROM → ResendEmailAdapter", () => {
    const adapter = createEmailAdapter({
      EMAIL_PROVIDER: "resend",
      RESEND_API_KEY: "re_test_key",
      RESEND_FROM: "no-reply@prodestic.net",
    } as NodeJS.ProcessEnv);
    expect(adapter).toBeInstanceOf(ResendEmailAdapter);
  });

  it("RESEND-EMAIL: client Resend injecté via factory (test) — aucun réseau", async () => {
    const { client, calls } = fakeClient(ok);
    const adapter = createEmailAdapter(
      {
        EMAIL_PROVIDER: "resend",
        RESEND_API_KEY: "re_test_key",
        RESEND_FROM: "no-reply@prodestic.net",
      } as NodeJS.ProcessEnv,
      { clientFactory: () => client }
    );
    expect(adapter).toBeInstanceOf(ResendEmailAdapter);
    const res = await adapter.send(msg());
    expect(res.providerMessageId).toBe("resend-msg-123");
    expect(calls[0]?.from).toBe("no-reply@prodestic.net");
  });

  it("RESEND-EMAIL: EMAIL_PROVIDER=resend + clé mais RESEND_FROM absent → repli mock (from requis)", () => {
    const adapter = createEmailAdapter({
      EMAIL_PROVIDER: "resend",
      RESEND_API_KEY: "re_test_key",
    } as NodeJS.ProcessEnv);
    expect(adapter).toBeInstanceOf(MockResendAdapter);
  });
});
