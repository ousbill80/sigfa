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

  it("uses DISTINCT humane copy for expired vs invalid (never a raw code)", () => {
    // Titles + bodies must differ so the two situations read differently.
    expect(pt("pwa.token.expired_title", "fr")).not.toEqual(pt("pwa.token.invalid_title", "fr"));
    expect(pt("pwa.token.expired_body", "fr")).not.toEqual(pt("pwa.token.invalid_body", "fr"));
    // Human sentences, not opaque codes.
    for (const key of ["pwa.token.expired_body", "pwa.token.invalid_body"] as const) {
      const copy = pt(key, "fr");
      expect(copy).not.toMatch(/^[A-Z_]+$/);
      expect(copy.length).toBeGreaterThan(20);
    }
  });
});
