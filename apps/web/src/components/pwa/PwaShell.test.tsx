/**
 * NOTIF-005-B — integration tests for the PWA shell (3-step + tracking).
 * @module components/pwa/PwaShell.test
 */
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw-server";
import { PwaShell } from "./PwaShell";
import { getServices, serviceName } from "@/lib/pwa/pwa-services";
import { pt } from "@/lib/pwa/pwa-i18n";

const BASE = "http://localhost:4010";

/** Builds a valid non-expired agency token. */
function validToken(agencyId = "agency-1"): string {
  const payload = { agencyId, exp: Math.floor(Date.now() / 1000) + 3600, keyVersion: 2 };
  const b64 = Buffer.from(JSON.stringify(payload), "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `v2.${b64}.sig`;
}

function setOnLine(value: boolean): void {
  Object.defineProperty(navigator, "onLine", { value, configurable: true, writable: true });
}

beforeEach(() => setOnLine(true));
afterEach(() => {
  server.resetHandlers();
  setOnLine(true);
});

describe("NOTIF-005-B: PwaShell", () => {
  it("shows the invalid-token screen for a malformed token", () => {
    render(<PwaShell token="garbage" baseUrl={BASE} registerServiceWorker={false} />);
    expect(screen.getByTestId("pwa-token-error")).toBeInTheDocument();
    expect(screen.getByText(pt("pwa.token.invalid_title", "fr"))).toBeInTheDocument();
  });

  it("shows the expired-token screen for a past-exp token", () => {
    const payload = { agencyId: "a", exp: Math.floor(Date.now() / 1000) - 10 };
    const b64 = Buffer.from(JSON.stringify(payload), "utf-8")
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    render(<PwaShell token={`v2.${b64}.sig`} baseUrl={BASE} registerServiceWorker={false} />);
    expect(screen.getByText(pt("pwa.token.expired_title", "fr"))).toBeInTheDocument();
  });

  it("renders the stepper + service step for a valid token", () => {
    render(<PwaShell token={validToken()} baseUrl={BASE} registerServiceWorker={false} />);
    expect(screen.getByTestId("pwa-shell")).toBeInTheDocument();
    expect(screen.getByTestId("pwa-stepper")).toBeInTheDocument();
    expect(screen.getByTestId("pwa-service-step")).toBeInTheDocument();
  });

  it("switches the whole UI to English via the toggle", async () => {
    render(<PwaShell token={validToken()} baseUrl={BASE} registerServiceWorker={false} />);
    await userEvent.click(screen.getByTestId("pwa-lang-en"));
    expect(screen.getByText(pt("pwa.service.title", "en"))).toBeInTheDocument();
  });

  it("shows the offline banner when the browser goes offline", async () => {
    render(<PwaShell token={validToken()} baseUrl={BASE} registerServiceWorker={false} />);
    act(() => {
      setOnLine(false);
      window.dispatchEvent(new Event("offline"));
    });
    await waitFor(() => expect(screen.getByTestId("pwa-offline-banner")).toBeInTheDocument());
  });

  it("walks the full 3-step flow to a live ticket", async () => {
    server.use(
      http.post(`${BASE}/public/tickets`, () =>
        HttpResponse.json(
          {
            trackingId: "V9k2mXpLqRwZsYn8fBjH3",
            number: "A042",
            displayNumber: "OC-042",
            status: "WAITING",
            channel: "QR",
            position: 5,
            estimatedWaitMinutes: 10,
            serviceId: "svc-1",
            agencyId: "agency-1",
            createdAt: "2026-07-11T09:00:00Z",
          },
          { status: 201 },
        ),
      ),
      http.get(`${BASE}/public/tickets/:id`, () =>
        HttpResponse.json({
          trackingId: "V9k2mXpLqRwZsYn8fBjH3",
          number: "A042",
          displayNumber: "OC-042",
          status: "WAITING",
          channel: "QR",
          position: 4,
          estimatedWaitMinutes: 8,
          agencyId: "agency-1",
          serviceId: "svc-1",
          createdAt: "2026-07-11T09:00:00Z",
        }),
      ),
    );

    render(<PwaShell token={validToken()} baseUrl={BASE} registerServiceWorker={false} pollIntervalMs={999_999} />);

    // Step 1: choose the first open service.
    const firstOpen = getServices().find((s) => s.isOpen)!;
    await userEvent.click(screen.getByText(serviceName(firstOpen, "fr")));
    expect(screen.getByTestId("pwa-confirm-step")).toBeInTheDocument();

    // Step 2: submit without a phone.
    await userEvent.click(screen.getByTestId("pwa-confirm-submit"));

    // Step 3: Moment Ticket + live tracking.
    await waitFor(() => expect(screen.getByTestId("pwa-ticket-step")).toBeInTheDocument());
    expect(screen.getByText("OC-042")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("pwa-ticket-position")).toHaveTextContent("4"));
  });

  it("blocks the flow and reports emission errors humanely", async () => {
    server.use(
      http.post(`${BASE}/public/tickets`, () =>
        HttpResponse.json({ error: { code: "SERVICE_NOT_FOUND" } }, { status: 404 }),
      ),
    );
    render(<PwaShell token={validToken()} baseUrl={BASE} registerServiceWorker={false} />);
    const firstOpen = getServices().find((s) => s.isOpen)!;
    await userEvent.click(screen.getByText(serviceName(firstOpen, "fr")));
    await userEvent.click(screen.getByTestId("pwa-confirm-submit"));
    // Stays on the confirm step (no crash, no navigation to ticket).
    await waitFor(() => expect(screen.getByTestId("pwa-confirm-step")).toBeInTheDocument());
    expect(screen.queryByTestId("pwa-ticket-step")).not.toBeInTheDocument();
  });
});
