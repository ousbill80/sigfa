/**
 * NOTIF-005-B — tests for the typed public PWA client (API-First).
 * @module lib/pwa/pwa-client.test
 */
import { describe, it, expect, afterEach } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw-server";
import { emitQrTicket, trackTicket, listOperations } from "./pwa-client";

const BASE = "http://localhost:4010";

afterEach(() => server.resetHandlers());

describe("NOTIF-005-B: pwa-client emitQrTicket (channel QR, idempotent)", () => {
  it("emits a QR ticket without phone (tracking via trackingId)", async () => {
    let captured: { header?: string | null; body?: unknown } = {};
    server.use(
      http.post(`${BASE}/public/tickets`, async ({ request }) => {
        captured = {
          header: request.headers.get("X-Idempotency-Key"),
          body: await request.json(),
        };
        return HttpResponse.json(
          {
            trackingId: "V9k2mXpLqRwZsYn8fBjH3",
            number: "A042",
            displayNumber: "OC-042",
            status: "WAITING",
            priority: "STANDARD",
            channel: "QR",
            position: 5,
            estimatedWaitMinutes: 10,
            serviceId: "svc-1",
            agencyId: "ag-1",
            createdAt: "2026-07-11T09:00:00Z",
          },
          { status: 201 },
        );
      }),
    );

    const res = await emitQrTicket(BASE, {
      agencyId: "ag-1",
      serviceId: "svc-1",
      idempotencyKey: "key-abc",
    });

    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.trackingId).toBe("V9k2mXpLqRwZsYn8fBjH3");
    expect(captured.header).toBe("key-abc");
    expect(captured.body).toMatchObject({ channel: "QR", serviceId: "svc-1", agencyId: "ag-1" });
    expect(captured.body).not.toHaveProperty("phoneNumber");
  });

  it("includes phone + smsConsent when a phone is provided", async () => {
    let body: Record<string, unknown> = {};
    server.use(
      http.post(`${BASE}/public/tickets`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(
          {
            trackingId: "Xp3nBmKqLrTs7vWzYj9cD",
            number: "A043",
            status: "WAITING",
            channel: "QR",
            position: 6,
            estimatedWaitMinutes: 12,
            serviceId: "svc-1",
            agencyId: "ag-1",
            createdAt: "2026-07-11T09:01:00Z",
          },
          { status: 201 },
        );
      }),
    );

    await emitQrTicket(BASE, {
      agencyId: "ag-1",
      serviceId: "svc-1",
      operationId: "op-1",
      phoneNumber: "+2250700000001",
      smsConsent: true,
      idempotencyKey: "key-def",
    });

    expect(body).toMatchObject({
      phoneNumber: "+2250700000001",
      smsConsent: true,
      operationId: "op-1",
    });
  });

  it("returns a typed failure with opaque code on 4xx", async () => {
    server.use(
      http.post(`${BASE}/public/tickets`, () =>
        HttpResponse.json({ error: { code: "SERVICE_NOT_FOUND" } }, { status: 404 }),
      ),
    );
    const res = await emitQrTicket(BASE, {
      agencyId: "ag-1",
      serviceId: "missing",
      idempotencyKey: "k",
    });
    expect(res).toEqual({ ok: false, status: 404, code: "SERVICE_NOT_FOUND" });
  });
});

describe("NOTIF-005-B: pwa-client trackTicket", () => {
  it("returns the live status on 200", async () => {
    server.use(
      http.get(`${BASE}/public/tickets/:trackingId`, ({ params }) =>
        HttpResponse.json(
          {
            trackingId: params.trackingId,
            number: "A042",
            displayNumber: "OC-042",
            status: "CALLED",
            channel: "QR",
            position: 0,
            estimatedWaitMinutes: 0,
            agencyId: "ag-1",
            serviceId: "svc-1",
            createdAt: "2026-07-11T09:00:00Z",
          },
          { status: 200 },
        ),
      ),
    );
    const res = await trackTicket(BASE, "V9k2mXpLqRwZsYn8fBjH3");
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.status).toBe("CALLED");
  });

  it("returns a typed failure on 404", async () => {
    server.use(
      http.get(`${BASE}/public/tickets/:trackingId`, () =>
        HttpResponse.json({ error: { code: "TICKET_NOT_FOUND" } }, { status: 404 }),
      ),
    );
    const res = await trackTicket(BASE, "does-not-exist-000000");
    expect(res).toEqual({ ok: false, status: 404, code: "TICKET_NOT_FOUND" });
  });
});

describe("NOTIF-005-B: pwa-client listOperations", () => {
  it("returns the operation list on 200", async () => {
    server.use(
      http.get(`${BASE}/public/agencies/:agencyId/operations`, () =>
        HttpResponse.json(
          { data: [{ id: "op-1", code: "DEP", name: "Dépôt", slaMinutes: 8 }] },
          { status: 200 },
        ),
      ),
    );
    const res = await listOperations(BASE, "ag-1", "svc-1");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data).toHaveLength(1);
      expect(res.data[0]?.code).toBe("DEP");
    }
  });

  it("returns a typed failure on 404", async () => {
    server.use(
      http.get(`${BASE}/public/agencies/:agencyId/operations`, () =>
        HttpResponse.json({ error: { code: "SERVICE_NOT_FOUND" } }, { status: 404 }),
      ),
    );
    const res = await listOperations(BASE, "ag-1", "missing");
    expect(res.ok).toBe(false);
  });
});
