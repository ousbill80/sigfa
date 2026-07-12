/**
 * Tests for useAgentFlow (WEB-002) — call-next / close against the mock (MSW).
 * @module lib/use-agent-flow.test
 */
import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw-server";
import { createSigfaClient } from "@sigfa/contracts";
import { useAgentFlow } from "./use-agent-flow";

const BASE = "http://localhost:4010";
const COUNTER_ID = "cccccccc-cccc-4ccc-accc-cccccccccccc";
const TICKET_ID = "ffffffff-ffff-4fff-afff-ffffffffffff";

function makeFlow() {
  const client = createSigfaClient("core", BASE);
  return renderHook(() => useAgentFlow({ counterId: COUNTER_ID, client }));
}

describe("useAgentFlow — call-next", () => {
  beforeEach(() => {
    server.use(
      http.post(`${BASE}/counters/${COUNTER_ID}/call-next`, () =>
        HttpResponse.json({
          id: TICKET_ID,
          number: "A042",
          status: "CALLED",
          counterId: COUNTER_ID,
          serviceId: "77777777-7777-4777-a777-777777777777",
          position: 0,
          estimatedWaitMinutes: 0,
          calledAt: "2026-07-11T09:30:00Z",
        }),
      ),
    );
  });

  it("WEB-002: APPELER LE SUIVANT → POST /counters/{counterId}/call-next, ticket affiché", async () => {
    const { result } = makeFlow();
    await act(async () => {
      await result.current.callNext();
    });
    expect(result.current.status).toBe("serving");
    expect(result.current.ticket?.number).toBe("A042");
    expect(result.current.ticket?.id).toBe(TICKET_ID);
  });

  it("RT-003: call-next sans `number` → numéro lu via GET /tickets/{id}", async () => {
    server.use(
      http.post(`${BASE}/counters/${COUNTER_ID}/call-next`, () =>
        // Réponse réelle callView : id présent, PAS de `number`.
        HttpResponse.json({ id: TICKET_ID, status: "CALLED", counterId: COUNTER_ID }),
      ),
      http.get(`${BASE}/tickets/${TICKET_ID}`, () =>
        HttpResponse.json({ id: TICKET_ID, number: "A007", status: "CALLED" }),
      ),
    );
    const { result } = makeFlow();
    await act(async () => {
      await result.current.callNext();
    });
    expect(result.current.status).toBe("serving");
    expect(result.current.ticket?.number).toBe("A007");
  });

  it("RT-003: call-next sans `number` et GET en échec → numéro vide, pas de crash", async () => {
    server.use(
      http.post(`${BASE}/counters/${COUNTER_ID}/call-next`, () =>
        HttpResponse.json({ id: TICKET_ID, status: "CALLED", counterId: COUNTER_ID }),
      ),
      http.get(`${BASE}/tickets/${TICKET_ID}`, () => HttpResponse.error()),
    );
    const { result } = makeFlow();
    await act(async () => {
      await result.current.callNext();
    });
    expect(result.current.status).toBe("serving");
    expect(result.current.ticket?.number).toBe("");
  });

  it("WEB-002: appelle bien /call-next (jamais /call) — route canonique", async () => {
    let calledPath = "";
    server.use(
      http.post(`${BASE}/counters/${COUNTER_ID}/call-next`, ({ request }) => {
        calledPath = new URL(request.url).pathname;
        return HttpResponse.json({ id: TICKET_ID, number: "A042", status: "CALLED", counterId: COUNTER_ID });
      }),
    );
    const { result } = makeFlow();
    await act(async () => {
      await result.current.callNext();
    });
    expect(calledPath).toContain("/call-next");
    expect(calledPath).not.toMatch(/\/call$/);
  });
});

describe("useAgentFlow — file vide & erreur", () => {
  it("WEB-002: file vide → 404 QUEUE_EMPTY → 'Aucun client en attente', pas d'alerte", async () => {
    server.use(
      http.post(`${BASE}/counters/${COUNTER_ID}/call-next`, () =>
        HttpResponse.json({ error: { code: "QUEUE_EMPTY", message: "vide" } }, { status: 404 }),
      ),
    );
    const { result } = makeFlow();
    await act(async () => {
      await result.current.callNext();
    });
    expect(result.current.status).toBe("empty");
    expect(result.current.message).toBe("agent.queue_empty");
    expect(result.current.ticket).toBeNull();
  });

  it("WEB-002: état error → message humain (clé i18n, pas de code d'erreur)", async () => {
    server.use(
      http.post(`${BASE}/counters/${COUNTER_ID}/call-next`, () =>
        HttpResponse.json({ error: { code: "INTERNAL" } }, { status: 500 }),
      ),
    );
    const { result } = makeFlow();
    await act(async () => {
      await result.current.callNext();
    });
    expect(result.current.status).toBe("error");
    expect(result.current.message).toBe("agent.error");
  });
});

describe("useAgentFlow — TERMINER", () => {
  beforeEach(() => {
    server.use(
      http.post(`${BASE}/counters/${COUNTER_ID}/call-next`, () =>
        HttpResponse.json({ id: TICKET_ID, number: "A042", status: "CALLED", counterId: COUNTER_ID }),
      ),
      http.post(`${BASE}/tickets/${TICKET_ID}/serve`, () =>
        HttpResponse.json({ id: TICKET_ID, status: "SERVING", counterId: COUNTER_ID }),
      ),
      http.post(`${BASE}/tickets/${TICKET_ID}/close`, () =>
        HttpResponse.json({ id: TICKET_ID, number: "A042", status: "DONE", counterId: COUNTER_ID, waitTime: 600, serviceTime: 300, closedAt: "2026-07-11T09:36:00Z" }),
      ),
    );
  });

  it("WEB-002: TERMINER → serve puis POST /tickets/{id}/close → zone ticket réinitialisée", async () => {
    const { result } = makeFlow();
    await act(async () => {
      await result.current.callNext();
    });
    expect(result.current.ticket).not.toBeNull();
    await act(async () => {
      await result.current.finish();
    });
    expect(result.current.ticket).toBeNull();
    expect(result.current.status).toBe("idle");
  });
});

describe("useAgentFlow — robustesse réseau", () => {
  it("WEB-002: call-next réseau en échec (exception) → état error, message humain", async () => {
    server.use(
      http.post(`${BASE}/counters/${COUNTER_ID}/call-next`, () => HttpResponse.error()),
    );
    const { result } = makeFlow();
    await act(async () => {
      await result.current.callNext();
    });
    expect(result.current.status).toBe("error");
    expect(result.current.message).toBe("agent.error");
  });

  it("WEB-002: TERMINER sans ticket courant → no-op (aucun appel)", async () => {
    const { result } = makeFlow();
    // pas de ticket → finish ne doit rien faire
    await act(async () => {
      await result.current.finish();
    });
    expect(result.current.status).toBe("idle");
    expect(result.current.ticket).toBeNull();
  });

  it("WEB-002: TERMINER en erreur serveur → état error", async () => {
    server.use(
      http.post(`${BASE}/counters/${COUNTER_ID}/call-next`, () =>
        HttpResponse.json({ id: TICKET_ID, number: "A042", status: "CALLED", counterId: COUNTER_ID }),
      ),
      http.post(`${BASE}/tickets/${TICKET_ID}/serve`, () =>
        HttpResponse.json({ id: TICKET_ID, status: "SERVING", counterId: COUNTER_ID }),
      ),
      http.post(`${BASE}/tickets/${TICKET_ID}/close`, () =>
        HttpResponse.json({ error: { code: "ILLEGAL_TRANSITION" } }, { status: 409 }),
      ),
    );
    const { result } = makeFlow();
    await act(async () => {
      await result.current.callNext();
    });
    await act(async () => {
      await result.current.finish();
    });
    expect(result.current.status).toBe("error");
    expect(result.current.message).toBe("agent.error");
  });

  it("WEB-002: TERMINER exception réseau → état error", async () => {
    server.use(
      http.post(`${BASE}/counters/${COUNTER_ID}/call-next`, () =>
        HttpResponse.json({ id: TICKET_ID, number: "A042", status: "CALLED", counterId: COUNTER_ID }),
      ),
      http.post(`${BASE}/tickets/${TICKET_ID}/serve`, () =>
        HttpResponse.json({ id: TICKET_ID, status: "SERVING", counterId: COUNTER_ID }),
      ),
      http.post(`${BASE}/tickets/${TICKET_ID}/close`, () => HttpResponse.error()),
    );
    const { result } = makeFlow();
    await act(async () => {
      await result.current.callNext();
    });
    await act(async () => {
      await result.current.finish();
    });
    expect(result.current.status).toBe("error");
  });
});

describe("useAgentFlow — transfert inline", () => {
  it("WEB-002: TRANSFÉRER → ouvre/ferme le sélecteur inline (zéro modale)", () => {
    const { result } = makeFlow();
    expect(result.current.transferOpen).toBe(false);
    act(() => result.current.openTransfer());
    expect(result.current.transferOpen).toBe(true);
    act(() => result.current.closeTransfer());
    expect(result.current.transferOpen).toBe(false);
  });
});
