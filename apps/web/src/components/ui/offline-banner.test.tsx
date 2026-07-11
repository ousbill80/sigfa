/**
 * Tests for OfflineBanner — WEB-001
 * @module components/ui/offline-banner.test
 */
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { OfflineBanner } from "./offline-banner";
import React from "react";

describe("WEB-001: état offline — shell charge depuis cache Next.js, bandeau discret", () => {
  beforeEach(() => {
    Object.defineProperty(navigator, "onLine", {
      writable: true,
      value: true,
    });
  });

  it("shows no banner when online", () => {
    render(<OfflineBanner />);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows offline banner when navigator.onLine is false", () => {
    Object.defineProperty(navigator, "onLine", { writable: true, value: false });
    render(<OfflineBanner />);
    expect(screen.getByRole("status")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("hors ligne");
  });

  it("shows banner when offline event fires", () => {
    render(<OfflineBanner />);
    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(screen.getByRole("status")).toBeTruthy();
  });

  it("hides banner when online event fires after going offline", () => {
    Object.defineProperty(navigator, "onLine", { writable: true, value: false });
    render(<OfflineBanner />);
    expect(screen.getByRole("status")).toBeTruthy();
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    expect(screen.queryByRole("status")).toBeNull();
  });
});
