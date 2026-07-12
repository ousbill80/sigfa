import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Dialog } from "./Dialog.js";

describe("Dialog", () => {
  it("renders nothing when closed", () => {
    render(
      <Dialog open={false} onClose={() => {}} title="Confirmer">
        body
      </Dialog>,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("is a labelled modal dialog when open", () => {
    render(
      <Dialog open onClose={() => {}} title="Confirmer la fermeture">
        body
      </Dialog>,
    );
    const dialog = screen.getByRole("dialog", {
      name: "Confirmer la fermeture",
    });
    expect(dialog).toHaveAttribute("aria-modal", "true");
  });

  it("moves focus to the panel on open", () => {
    render(
      <Dialog open onClose={() => {}} title="t">
        body
      </Dialog>,
    );
    expect(screen.getByRole("dialog")).toHaveFocus();
  });

  it("closes on Escape", async () => {
    const onClose = vi.fn();
    render(
      <Dialog open onClose={onClose} title="t">
        body
      </Dialog>,
    );
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("closes on backdrop mousedown but not on panel click", async () => {
    const onClose = vi.fn();
    render(
      <Dialog open onClose={onClose} title="t">
        body
      </Dialog>,
    );
    await userEvent.click(screen.getByRole("dialog"));
    expect(onClose).not.toHaveBeenCalled();
    await userEvent.click(screen.getByTestId("dialog-backdrop"));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("renders actions from props", () => {
    render(
      <Dialog
        open
        onClose={() => {}}
        title="t"
        actions={<button>Confirmer</button>}
      >
        body
      </Dialog>,
    );
    expect(
      screen.getByRole("button", { name: "Confirmer" }),
    ).toBeInTheDocument();
  });
});
