import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TicketMoment } from "./TicketMoment.js";

describe("TicketMoment", () => {
  it("renders the ticket number, eyebrow and message from props", () => {
    render(
      <TicketMoment
        eyebrow="Votre ticket"
        ticketNumber="B-042"
        message="Nous vous appellerons très bientôt."
      />,
    );
    expect(screen.getByTestId("ticket-number")).toHaveTextContent("B-042");
    expect(screen.getByText("Votre ticket")).toBeInTheDocument();
    expect(
      screen.getByText("Nous vous appellerons très bientôt."),
    ).toBeInTheDocument();
  });

  it("exposes an accessible name combining eyebrow + number", () => {
    render(
      <TicketMoment
        eyebrow="Votre ticket"
        ticketNumber="B-042"
        message="msg"
      />,
    );
    expect(
      screen.getByRole("region", { name: "Votre ticket B-042" }),
    ).toBeInTheDocument();
  });

  it("renders the actions slot (SMS / voice)", () => {
    render(
      <TicketMoment
        eyebrow="e"
        ticketNumber="A-1"
        message="m"
        actions={<button>Recevoir par SMS</button>}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Recevoir par SMS" }),
    ).toBeInTheDocument();
  });

  it("omits the actions container when no actions are given", () => {
    const { container } = render(
      <TicketMoment eyebrow="e" ticketNumber="A-1" message="m" />,
    );
    expect(container.querySelector(".sig-ticket__actions")).toBeNull();
  });

  it("renders the brand halo layer and the themed number (v3 hooks)", () => {
    // v3 « Neutre Premium » : le halo et le numero sont stylés par tokens
    // (halo --brand discret, numero --brand-inv) via ces classes canoniques.
    const { container } = render(
      <TicketMoment eyebrow="e" ticketNumber="A-1" message="m" />,
    );
    expect(container.querySelector(".sig-ticket__halo")).not.toBeNull();
    expect(screen.getByTestId("ticket-number")).toHaveClass(
      "sig-ticket__number",
    );
  });
});
