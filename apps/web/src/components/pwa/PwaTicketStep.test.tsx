/**
 * NOTIF-005-B — tests for step 3 (Moment Ticket + live tracking).
 * @module components/pwa/PwaTicketStep.test
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw-server";
import { PwaTicketStep } from "./PwaTicketStep";
import type { PublicTicketCreated } from "@/lib/pwa/pwa-client";
import { pt } from "@/lib/pwa/pwa-i18n";

const BASE = "http://localhost:4010";

const CREATED: PublicTicketCreated = {
  trackingId: "V9k2mXpLqRwZsYn8fBjH3",
  number: "A042",
  displayNumber: "OC-042",
  status: "WAITING",
  channel: "QR",
  position: 5,
  estimatedWaitMinutes: 10,
  serviceId: "svc-1",
  agencyId: "ag-1",
  createdAt: "2026-07-11T09:00:00Z",
};

function statusBody(status: string, position: number) {
  return {
    trackingId: CREATED.trackingId,
    number: "A042",
    displayNumber: "OC-042",
    status,
    channel: "QR",
    position,
    estimatedWaitMinutes: position * 2,
    agencyId: "ag-1",
    serviceId: "svc-1",
    createdAt: CREATED.createdAt,
  };
}

afterEach(() => server.resetHandlers());

describe("NOTIF-005-B: PwaTicketStep (Moment Ticket + live tracking)", () => {
  it("shows the Moment Ticket number immediately from the creation payload", () => {
    server.use(http.get(`${BASE}/public/tickets/:id`, () => HttpResponse.json(statusBody("WAITING", 5))));
    render(
      <PwaTicketStep baseUrl={BASE} created={CREATED} locale="fr" onNewTicket={() => {}} intervalMs={999_999} />,
    );
    expect(screen.getByTestId("pwa-ticket-moment")).toBeInTheDocument();
    expect(screen.getByText("OC-042")).toBeInTheDocument();
  });

  it("reflects the live position/wait once the status loads", async () => {
    server.use(http.get(`${BASE}/public/tickets/:id`, () => HttpResponse.json(statusBody("WAITING", 3))));
    render(
      <PwaTicketStep baseUrl={BASE} created={CREATED} locale="fr" onNewTicket={() => {}} intervalMs={999_999} />,
    );
    await waitFor(() => expect(screen.getByTestId("pwa-ticket-position")).toHaveTextContent("3"));
    expect(screen.getByTestId("pwa-ticket-wait")).toHaveTextContent(
      pt("pwa.ticket.minutes", "fr", { minutes: 6 }),
    );
  });

  it("highlights the called-now message when CALLED", async () => {
    server.use(http.get(`${BASE}/public/tickets/:id`, () => HttpResponse.json(statusBody("CALLED", 0))));
    render(
      <PwaTicketStep baseUrl={BASE} created={CREATED} locale="fr" onNewTicket={() => {}} intervalMs={999_999} />,
    );
    await waitFor(() =>
      expect(screen.getByText(pt("pwa.ticket.called_now", "fr"))).toBeInTheDocument(),
    );
  });

  it("shows a new-ticket action when the ticket is done", async () => {
    const onNew = vi.fn();
    server.use(http.get(`${BASE}/public/tickets/:id`, () => HttpResponse.json(statusBody("DONE", 0))));
    render(
      <PwaTicketStep baseUrl={BASE} created={CREATED} locale="fr" onNewTicket={onNew} intervalMs={999_999} />,
    );
    await waitFor(() => expect(screen.getByTestId("pwa-ticket-new")).toBeInTheDocument());
    await userEvent.click(screen.getByTestId("pwa-ticket-new"));
    expect(onNew).toHaveBeenCalledOnce();
  });

  it("shows the error state (with retry) when tracking fails and nothing cached", async () => {
    server.use(
      http.get(`${BASE}/public/tickets/:id`, () =>
        HttpResponse.json({ error: { code: "TICKET_NOT_FOUND" } }, { status: 404 }),
      ),
    );
    render(
      <PwaTicketStep baseUrl={BASE} created={CREATED} locale="fr" onNewTicket={() => {}} intervalMs={999_999} />,
    );
    await waitFor(() => expect(screen.getByTestId("pwa-state-error")).toBeInTheDocument());
  });
});
