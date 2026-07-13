/**
 * NOTIF-005-B — tests for the 3-step ticket flow state machine.
 * @module lib/pwa/use-ticket-flow.test
 */
import { describe, it, expect, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw-server";
import { useTicketFlow, FLOW_STEPS } from "./use-ticket-flow";

const BASE = "http://localhost:4010";
const AGENCY = "ag-1";
const SVC = "77777777-7777-4777-a777-777777777777";

function created() {
  return {
    trackingId: "V9k2mXpLqRwZsYn8fBjH3",
    number: "A042",
    displayNumber: "OC-042",
    status: "WAITING",
    channel: "QR",
    position: 5,
    estimatedWaitMinutes: 10,
    serviceId: SVC,
    agencyId: AGENCY,
    createdAt: "2026-07-11T09:00:00Z",
  };
}

function render(makeKey?: () => string) {
  return renderHook(() => useTicketFlow({ baseUrl: BASE, agencyId: AGENCY, makeKey }));
}

afterEach(() => server.resetHandlers());

describe("NOTIF-005-B: useTicketFlow", () => {
  it("starts on the service step", () => {
    const { result } = render();
    expect(result.current.step).toBe("service");
    expect(result.current.stepIndex).toBe(0);
    expect(FLOW_STEPS).toEqual(["service", "confirm", "ticket"]);
  });

  it("advances to confirm when a service is selected", () => {
    const { result } = render();
    act(() => result.current.selectService(SVC));
    expect(result.current.step).toBe("confirm");
    expect(result.current.selectedServiceId).toBe(SVC);
  });

  it("allows submit without a phone (tracking via trackingId)", () => {
    const { result } = render();
    act(() => result.current.selectService(SVC));
    expect(result.current.canSubmit).toBe(true);
  });

  it("requires consent when a phone is provided", () => {
    const { result } = render();
    act(() => result.current.selectService(SVC));
    act(() => result.current.setPhone("+2250700000001"));
    expect(result.current.canSubmit).toBe(false);
    act(() => result.current.setConsent(true));
    expect(result.current.canSubmit).toBe(true);
  });

  it("blocks submit on an invalid phone", () => {
    const { result } = render();
    act(() => result.current.selectService(SVC));
    act(() => result.current.setPhone("abc"));
    expect(result.current.canSubmit).toBe(false);
  });

  it("clears consent when the phone is emptied", () => {
    const { result } = render();
    act(() => result.current.selectService(SVC));
    act(() => result.current.setPhone("+2250700000001"));
    act(() => result.current.setConsent(true));
    act(() => result.current.setPhone(""));
    expect(result.current.consent).toBe(false);
  });

  it("emits a ticket and advances to the ticket step", async () => {
    server.use(http.post(`${BASE}/public/tickets`, () => HttpResponse.json(created(), { status: 201 })));
    const { result } = render();
    act(() => result.current.selectService(SVC));
    await act(async () => {
      await result.current.submit();
    });
    expect(result.current.step).toBe("ticket");
    expect(result.current.created?.trackingId).toBe("V9k2mXpLqRwZsYn8fBjH3");
  });

  it("reuses the same idempotency key across submit attempts", async () => {
    const keys: string[] = [];
    let attempt = 0;
    server.use(
      http.post(`${BASE}/public/tickets`, ({ request }) => {
        keys.push(request.headers.get("X-Idempotency-Key") ?? "");
        attempt += 1;
        // First attempt fails, second succeeds — key must be identical.
        return attempt === 1
          ? HttpResponse.json({ error: { code: "INTERNAL" } }, { status: 500 })
          : HttpResponse.json(created(), { status: 201 });
      }),
    );
    const { result } = render(() => "fixed-key");
    act(() => result.current.selectService(SVC));
    await act(async () => {
      await result.current.submit();
    });
    expect(result.current.emitStatus).toBe("error");
    await act(async () => {
      await result.current.submit();
    });
    await waitFor(() => expect(result.current.step).toBe("ticket"));
    expect(keys).toEqual(["fixed-key", "fixed-key"]);
  });

  it("surfaces an error status when emission fails", async () => {
    server.use(
      http.post(`${BASE}/public/tickets`, () =>
        HttpResponse.json({ error: { code: "SERVICE_NOT_FOUND" } }, { status: 404 }),
      ),
    );
    const { result } = render();
    act(() => result.current.selectService(SVC));
    await act(async () => {
      await result.current.submit();
    });
    expect(result.current.emitStatus).toBe("error");
    expect(result.current.step).toBe("confirm");
  });

  it("back returns from confirm to service", () => {
    const { result } = render();
    act(() => result.current.selectService(SVC));
    act(() => result.current.back());
    expect(result.current.step).toBe("service");
  });

  it("reset returns to a clean service step", async () => {
    server.use(http.post(`${BASE}/public/tickets`, () => HttpResponse.json(created(), { status: 201 })));
    const { result } = render();
    act(() => result.current.selectService(SVC));
    await act(async () => {
      await result.current.submit();
    });
    act(() => result.current.reset());
    expect(result.current.step).toBe("service");
    expect(result.current.created).toBeNull();
    expect(result.current.selectedServiceId).toBeNull();
  });
});
