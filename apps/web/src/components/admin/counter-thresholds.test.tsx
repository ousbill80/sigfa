/**
 * Tests for ThresholdsForm + CounterForm (WEB-006).
 * @module components/admin/counter-thresholds.test
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThresholdsForm } from "./thresholds-form";
import { CounterForm } from "./counter-form";

describe("ThresholdsForm — validation inline", () => {
  it("WEB-006: seuils MANAGER+ — file critique / inactivité / no-show validés inline (sans modale)", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<ThresholdsForm onSubmit={onSubmit} initial={{ queueCriticalThreshold: 0, agentInactivityMinutes: 15, noShowTimeoutMinutes: 3 }} />);
    await user.click(screen.getByTestId("thresholds-submit"));
    // Hors bornes → erreur inline, pas de modale, pas de submit.
    expect(screen.getByTestId("error-queue")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("WEB-006: seuils valides → onSubmit avec payload contractuel", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<ThresholdsForm onSubmit={onSubmit} initial={{ queueCriticalThreshold: 50, agentInactivityMinutes: 15, noShowTimeoutMinutes: 3 }} />);
    await user.click(screen.getByTestId("thresholds-submit"));
    expect(onSubmit).toHaveBeenCalledWith({ queueCriticalThreshold: 50, agentInactivityMinutes: 15, noShowTimeoutMinutes: 3 });
  });

  it("WEB-006: seuils édités (3 champs) → payload reflète la saisie", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<ThresholdsForm onSubmit={onSubmit} />);
    await user.clear(screen.getByTestId("th-queue"));
    await user.type(screen.getByTestId("th-queue"), "100");
    await user.clear(screen.getByTestId("th-inactivity"));
    await user.type(screen.getByTestId("th-inactivity"), "20");
    await user.clear(screen.getByTestId("th-noshow"));
    await user.type(screen.getByTestId("th-noshow"), "5");
    await user.click(screen.getByTestId("thresholds-submit"));
    expect(onSubmit).toHaveBeenCalledWith({ queueCriticalThreshold: 100, agentInactivityMinutes: 20, noShowTimeoutMinutes: 5 });
  });

  it("WEB-006: défaut sans initial → 50/15/3 (bornes contrat)", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<ThresholdsForm onSubmit={onSubmit} />);
    await user.click(screen.getByTestId("thresholds-submit"));
    expect(onSubmit).toHaveBeenCalledWith({ queueCriticalThreshold: 50, agentInactivityMinutes: 15, noShowTimeoutMinutes: 3 });
  });
});

describe("CounterForm — guichets numérotés", () => {
  it("WEB-006: guichet CRUD — label obligatoire (erreur inline) + affectation service", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<CounterForm services={[{ id: "s1", name: "Virements" }]} onSubmit={onSubmit} />);
    // Sans label → erreur inline.
    await user.click(screen.getByTestId("counter-submit"));
    expect(screen.getByTestId("counter-error")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
    // Avec label + service coché → submit avec serviceIds.
    await user.type(screen.getByTestId("counter-label"), "Guichet 9");
    await user.click(screen.getByTestId("counter-service-s1"));
    await user.click(screen.getByTestId("counter-submit"));
    expect(onSubmit).toHaveBeenCalledWith({ label: "Guichet 9", serviceIds: ["s1"] });
  });

  it("WEB-006: cocher puis décocher un service → serviceIds vide", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<CounterForm services={[{ id: "s1", name: "Virements" }]} onSubmit={onSubmit} />);
    await user.type(screen.getByTestId("counter-label"), "Guichet 1");
    await user.click(screen.getByTestId("counter-service-s1"));
    await user.click(screen.getByTestId("counter-service-s1"));
    await user.click(screen.getByTestId("counter-submit"));
    expect(onSubmit).toHaveBeenCalledWith({ label: "Guichet 1", serviceIds: [] });
  });
});
