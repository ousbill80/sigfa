/**
 * NOTIF-005-B — tests for step 1 (service selection).
 * @module components/pwa/PwaServiceStep.test
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PwaServiceStep } from "./PwaServiceStep";
import type { PwaService } from "@/lib/pwa/pwa-services";
import { pt } from "@/lib/pwa/pwa-i18n";

const OPEN: PwaService = {
  id: "svc-open",
  code: "OC",
  name: { fr: "Caisse", en: "Cash" },
  estimatedMinutes: 8,
  isOpen: true,
};
const CLOSED: PwaService = {
  id: "svc-closed",
  code: "CL",
  name: { fr: "Conseil", en: "Advisory" },
  estimatedMinutes: 12,
  isOpen: false,
};

describe("NOTIF-005-B: PwaServiceStep", () => {
  it("renders the empty state when the catalog is empty", () => {
    render(<PwaServiceStep services={[]} locale="fr" onSelect={() => {}} />);
    expect(screen.getByTestId("pwa-service-empty")).toBeInTheDocument();
  });

  it("lists services with localized names and wait pill", () => {
    render(<PwaServiceStep services={[OPEN]} locale="en" onSelect={() => {}} />);
    expect(screen.getByText("Cash")).toBeInTheDocument();
    expect(screen.getByText(pt("pwa.service.wait", "en", { minutes: 8 }))).toBeInTheDocument();
  });

  it("selects an open service on click", async () => {
    const onSelect = vi.fn();
    render(<PwaServiceStep services={[OPEN]} locale="fr" onSelect={onSelect} />);
    await userEvent.click(screen.getByText("Caisse"));
    expect(onSelect).toHaveBeenCalledWith("svc-open");
  });

  it("marks closed services and does not select them", async () => {
    const onSelect = vi.fn();
    render(<PwaServiceStep services={[CLOSED]} locale="fr" onSelect={onSelect} />);
    expect(screen.getByTestId("pwa-service-closed")).toBeInTheDocument();
    await userEvent.click(screen.getByText("Conseil"));
    expect(onSelect).not.toHaveBeenCalled();
  });
});
