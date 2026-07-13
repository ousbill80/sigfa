/**
 * Tests unitaires — NOTIF-004 : orchestration transport email (producteur + SendFn).
 *  - Garde « internes uniquement » : email client refusé.
 *  - Producteur : rendu + repli pièce jointe (lien signé 24 h) + destinataires D5.
 *  - SendFn : transitoire → retry ; bounce dur → UnrecoverableError (DLQ).
 *  - Producteur : payload {type, destinataires, pièces, variables} accepté ; aucun KPI.
 *
 * La résolution des destinataires D5 est prouvée en intégration (recipients.integration.test.ts) ;
 * ici on injecte un `queryFn` stub pour tester l'orchestration pure.
 *
 * Nommage strict : `NOTIF-004: <description>`.
 *
 * @module
 */

import { describe, it, expect } from "vitest";
import type { QueryFn } from "@sigfa/database";
import {
  assertInternalOnly,
  injectSignedUrl,
  makeEmailSendFn,
  prepareEmailJob,
  defaultRolesFor,
  ClientEmailRefusedError,
} from "src/services/email/email-send.js";
import { MockResendAdapter, type EmailMessage } from "src/services/email/email-adapter.js";
import { InMemoryObjectStore } from "src/services/email/attachment-storage.js";
import { NoRecipientError } from "src/services/email/recipients.js";
import type {
  NotificationJobData,
  SendOutcome,
} from "src/services/notification-jobs.js";

const BANK = "11111111-1111-1111-1111-111111111111";
const AGENCY = "22222222-2222-2222-2222-222222222222";
const T0 = 1_752_000_000_000;

/**
 * Stub `queryFn` qui répond aux SELECT de résolution de destinataires par une liste
 * d'emails fixée (BEGIN/SET/COMMIT/ROLLBACK ignorés). Prouve l'orchestration sans PG.
 */
function stubQueryFn(emails: string[]): QueryFn {
  return async (sql: string) => {
    if (sql.trimStart().toUpperCase().startsWith("SELECT")) {
      return { rows: emails.map((email) => ({ email })) };
    }
    return { rows: [] };
  };
}

const reportProps = {
  bankName: "Banque X",
  agencyName: "Agence Plateau",
  periodKey: "2026-07-12",
  periodLabel: "12 juillet 2026",
  kpis: [{ label: "Servis", value: "10" }],
  attachmentSignedUrl: null,
};

const baseDeps = {
  internalDomains: ["banque.example"],
  objectStore: new InMemoryObjectStore(),
  signedLink: {
    signingSecret: "s",
    baseUrl: "https://storage.sigfa.ci/attachments",
    clock: () => T0,
  },
  objectKeyFn: () => "report.pdf",
};

describe("NOTIF-004 garde « internes uniquement »", () => {
  it("NOTIF-004: canal email n'adresse que des utilisateurs internes — email client refusé", () => {
    expect(() =>
      assertInternalOnly(["manager@banque.example"], ["banque.example"])
    ).not.toThrow();
    // Adresse client (autre domaine) → refusée.
    expect(() =>
      assertInternalOnly(["client@gmail.com"], ["banque.example"])
    ).toThrow(ClientEmailRefusedError);
    // Adresse sans domaine → refusée.
    expect(() => assertInternalOnly(["bogus"], ["banque.example"])).toThrow(
      ClientEmailRefusedError
    );
  });

  it("NOTIF-004: producteur refuse si un destinataire résolu est hors périmètre interne", async () => {
    await expect(
      prepareEmailJob(
        {
          bankId: BANK,
          type: "MANAGER_ALERT",
          lang: "FR",
          agencyId: AGENCY,
          from: "alerts@banque.example",
          props: {
            bankName: "B",
            agencyName: "A",
            alertKind: "SLA_BREACH",
            message: "m",
            occurredAt: "2026-07-12T09:00:00Z",
            severity: "WARNING",
          },
        },
        { ...baseDeps, queryFn: stubQueryFn(["intrus@client.com"]) }
      )
    ).rejects.toBeInstanceOf(ClientEmailRefusedError);
  });
});

describe("NOTIF-004 rôles destinataires par défaut", () => {
  it("NOTIF-004: MANAGER_ALERT → managers/directeurs ; rapports → +BANK_ADMIN", () => {
    expect(defaultRolesFor("MANAGER_ALERT")).toEqual(["MANAGER", "AGENCY_DIRECTOR"]);
    expect(defaultRolesFor("DAILY_REPORT")).toContain("BANK_ADMIN");
  });
});

describe("NOTIF-004 producteur d'email (transport pur)", () => {
  it("NOTIF-004: payload {type,destinataires,pièces,variables} accepté et rendu ; aucun KPI calculé", async () => {
    const prepared = await prepareEmailJob(
      {
        bankId: BANK,
        type: "DAILY_REPORT",
        lang: "FR",
        agencyId: null,
        from: "reports@banque.example",
        props: reportProps,
      },
      { ...baseDeps, queryFn: stubQueryFn(["dir@banque.example", "mgr@banque.example"]) }
    );
    expect(prepared.recipients).toEqual(["dir@banque.example", "mgr@banque.example"]);
    expect(prepared.message.subject).toContain("Rapport journalier");
    expect(prepared.message.html).toContain("Servis");
    expect(prepared.attachmentSignedUrl).toBeNull();
  });

  it("NOTIF-004: destinataires vides → NO_RECIPIENT, aucun rendu ni envoi", async () => {
    await expect(
      prepareEmailJob(
        {
          bankId: BANK,
          type: "WEEKLY_REPORT",
          lang: "EN",
          from: "reports@banque.example",
          props: reportProps,
        },
        { ...baseDeps, queryFn: stubQueryFn([]) }
      )
    ).rejects.toBeInstanceOf(NoRecipientError);
  });

  it("NOTIF-004: pièce jointe hors limite → lien signé (attachmentSignedUrl), pas jointe", async () => {
    const store = new InMemoryObjectStore();
    const prepared = await prepareEmailJob(
      {
        bankId: BANK,
        type: "MONTHLY_REPORT",
        lang: "FR",
        from: "reports@banque.example",
        props: reportProps,
        attachments: [
          {
            filename: "gros.pdf",
            contentBase64: "AAAA",
            contentType: "application/pdf",
            sizeBytes: 100 * 1024 * 1024,
          },
        ],
      },
      { ...baseDeps, objectStore: store, queryFn: stubQueryFn(["dir@banque.example"]) }
    );
    expect(prepared.attachmentSignedUrl).toContain("storage.sigfa.ci");
    // Pas de pièce jointe en ligne (externalisée).
    expect(prepared.message.attachments).toBeUndefined();
    // Le bouton de téléchargement figure dans le HTML.
    expect(prepared.message.html).toContain("Télécharger le document");
    // Le fichier est bien stocké.
    expect(await store.get("report.pdf")).not.toBeNull();
  });

  it("NOTIF-004: pièce jointe sous le plafond → jointe en ligne, aucun lien signé", async () => {
    const prepared = await prepareEmailJob(
      {
        bankId: BANK,
        type: "MONTHLY_REPORT",
        lang: "EN",
        from: "reports@banque.example",
        props: reportProps,
        attachments: [
          {
            filename: "petit.pdf",
            contentBase64: "AAAA",
            contentType: "application/pdf",
            sizeBytes: 1024,
          },
        ],
      },
      { ...baseDeps, queryFn: stubQueryFn(["dir@banque.example"]) }
    );
    expect(prepared.attachmentSignedUrl).toBeNull();
    expect(prepared.message.attachments).toHaveLength(1);
  });
});

describe("NOTIF-004 injectSignedUrl", () => {
  it("NOTIF-004: injecte le lien dans les props rapport ; laisse MANAGER_ALERT intact", () => {
    const injected = injectSignedUrl("DAILY_REPORT", { a: 1 }, "https://link") as Record<
      string,
      unknown
    >;
    expect(injected["attachmentSignedUrl"]).toBe("https://link");
    // MANAGER_ALERT : props inchangées.
    const alert = { x: 1 };
    expect(injectSignedUrl("MANAGER_ALERT", alert, "https://link")).toBe(alert);
    // Non-objet : inchangé (Zod tranchera).
    expect(injectSignedUrl("DAILY_REPORT", null, "https://link")).toBeNull();
  });
});

describe("NOTIF-004 SendFn (adapte EmailAdapter au worker NOTIF-001)", () => {
  const job: NotificationJobData = {
    bankId: BANK,
    dedupeKey: "dk",
    logId: "log-1",
    ticketId: null,
    type: "MANAGER_ALERT",
    channel: "EMAIL",
  };
  const message: EmailMessage = {
    to: ["mgr@banque.example"],
    from: "alerts@banque.example",
    subject: "s",
    html: "<p>x</p>",
  };

  it("NOTIF-004: 2xx → SendOutcome.providerMessageId (SENT côté worker)", async () => {
    const adapter = new MockResendAdapter({ makeMessageId: () => "mid-1" });
    const send = makeEmailSendFn(adapter, () => message);
    const out: SendOutcome = await send(job);
    expect(out.providerMessageId).toBe("mid-1");
  });

  it("NOTIF-004: erreur transitoire → EmailSendError retryable propagé (retry/backoff NOTIF-001)", async () => {
    const adapter = new MockResendAdapter({ decide: () => "RATE_LIMIT" });
    const send = makeEmailSendFn(adapter, () => message);
    await expect(send(job)).rejects.toMatchObject({
      name: "EmailSendError",
      retryable: true,
      reason: "QUOTA_EXCEEDED",
    });
  });

  it("NOTIF-004: bounce dur → EmailSendError non retryable (le worker route en DLQ, pas de retry infini)", async () => {
    const adapter = new MockResendAdapter({ decide: () => "HARD_BOUNCE" });
    const send = makeEmailSendFn(adapter, () => message);
    // Se propage tel quel ; NOTIF-001 (isNonRetryable) coupe le retry sur `retryable=false`.
    await expect(send(job)).rejects.toMatchObject({
      name: "EmailSendError",
      retryable: false,
      reason: "INVALID_NUMBER",
    });
  });
});
