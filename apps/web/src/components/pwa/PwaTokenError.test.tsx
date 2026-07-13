/**
 * NOTIF-005-B — tests for the QR token error screen.
 * @module components/pwa/PwaTokenError.test
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PwaTokenError } from "./PwaTokenError";
import { pt } from "@/lib/pwa/pwa-i18n";

describe("NOTIF-005-B: PwaTokenError (humane, no crash)", () => {
  it("renders the invalid-token screen", () => {
    render(<PwaTokenError kind="invalid" locale="fr" />);
    expect(screen.getByTestId("pwa-token-error")).toBeInTheDocument();
    expect(screen.getByText(pt("pwa.token.invalid_title", "fr"))).toBeInTheDocument();
    expect(screen.getByText(pt("pwa.token.invalid_body", "fr"))).toBeInTheDocument();
  });

  it("renders the expired-token screen (EN)", () => {
    render(<PwaTokenError kind="expired" locale="en" />);
    expect(screen.getByText(pt("pwa.token.expired_title", "en"))).toBeInTheDocument();
    expect(screen.getByText(pt("pwa.token.expired_body", "en"))).toBeInTheDocument();
  });
});
