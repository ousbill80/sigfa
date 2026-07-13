/**
 * NOTIF-005-B — tests for the 5-state PWA view.
 * @module components/pwa/PwaStateView.test
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PwaStateView } from "./PwaStateView";
import { pt } from "@/lib/pwa/pwa-i18n";

describe("NOTIF-005-B: PwaStateView (5 states)", () => {
  it("renders the loading state with a busy status", () => {
    render(<PwaStateView state="loading" locale="fr" />);
    const node = screen.getByTestId("pwa-state-loading");
    expect(node).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText(pt("pwa.state.loading", "fr"))).toBeInTheDocument();
  });

  it("renders the offline state with a hint (EN)", () => {
    render(<PwaStateView state="offline" locale="en" />);
    expect(screen.getByTestId("pwa-state-offline")).toBeInTheDocument();
    expect(screen.getByText(pt("pwa.state.offline_hint", "en"))).toBeInTheDocument();
  });

  it("renders the error state with a working retry action", async () => {
    const onRetry = vi.fn();
    render(<PwaStateView state="error" locale="fr" onRetry={onRetry} />);
    const node = screen.getByTestId("pwa-state-error");
    expect(node).toHaveAttribute("role", "alert");
    await userEvent.click(screen.getByText(pt("pwa.state.error_action", "fr")));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("renders the error state without a retry button when no handler", () => {
    render(<PwaStateView state="error" locale="fr" />);
    expect(screen.queryByText(pt("pwa.state.error_action", "fr"))).not.toBeInTheDocument();
  });

  it("renders the empty state", () => {
    render(<PwaStateView state="empty" locale="fr" />);
    expect(screen.getByTestId("pwa-state-empty")).toBeInTheDocument();
  });
});
