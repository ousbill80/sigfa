/**
 * Tests for DemoLoginPanel — bloc « Mode démo — connexion directe » (phase de
 * test). Le composant ne reçoit que la liste des rôles disponibles (jamais de
 * secret) ; clic → POST /api/auth/demo-login {role} puis même redirection que
 * le login normal.
 * @module components/auth/demo-login-panel.test
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { server } from "@/test/msw-server";
import { http, HttpResponse } from "msw";
import React from "react";
import { DemoLoginPanel } from "./demo-login-panel";

// Mock next/navigation (même convention que login-form.test)
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("next=/dashboard"),
}));

const ALL_ROLES = [
  "BANK_ADMIN",
  "AGENCY_DIRECTOR",
  "MANAGER",
  "AGENT",
  "AUDITOR",
] as const;

beforeEach(() => {
  // window.location remplaçable pour observer la redirection sans navigation
  // jsdom. href reste une URL absolue valide : MSW résout les chemins
  // relatifs des handlers contre location.href.
  Object.defineProperty(window, "location", {
    value: { href: "http://localhost:3000/login" },
    writable: true,
    configurable: true,
  });
});

describe("DemoLoginPanel — rendu", () => {
  it("affiche le titre « Mode démo — connexion directe » et les 5 boutons rôle en français", () => {
    render(<DemoLoginPanel roles={[...ALL_ROLES]} />);
    expect(screen.getByText("Mode démo — connexion directe")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Administrateur banque" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Directeur d'agence" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Manager" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Agent" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Auditeur" })).toBeTruthy();
    expect(screen.getAllByRole("button")).toHaveLength(5);
  });

  it("n'affiche que les rôles fournis par le serveur", () => {
    render(<DemoLoginPanel roles={["AGENT", "AUDITOR"]} />);
    expect(screen.getAllByRole("button")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Manager" })).toBeNull();
  });
});

describe("DemoLoginPanel — connexion directe", () => {
  it("clic sur un rôle → POST /api/auth/demo-login {role} puis redirection `next`", async () => {
    let requestBody: unknown;
    server.use(
      http.post("/api/auth/demo-login", async ({ request }) => {
        requestBody = await request.json();
        return HttpResponse.json({ ok: true });
      })
    );

    render(<DemoLoginPanel roles={[...ALL_ROLES]} />);
    fireEvent.click(screen.getByRole("button", { name: "Directeur d'agence" }));

    await waitFor(() => {
      expect(requestBody).toEqual({ role: "AGENCY_DIRECTOR" });
      expect(window.location.href).toBe("/dashboard");
    });
  });

  it("affiche une erreur (role=alert) quand la route refuse", async () => {
    server.use(
      http.post("/api/auth/demo-login", () =>
        HttpResponse.json({ error: "Invalid credentials" }, { status: 401 })
      )
    );

    render(<DemoLoginPanel roles={[...ALL_ROLES]} />);
    fireEvent.click(screen.getByRole("button", { name: "Agent" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeTruthy();
    });
    // Aucune redirection en cas d'échec
    expect(window.location.href).toBe("http://localhost:3000/login");
  });

  it("affiche « Service indisponible » sur erreur réseau", async () => {
    server.use(http.post("/api/auth/demo-login", () => HttpResponse.error()));

    render(<DemoLoginPanel roles={[...ALL_ROLES]} />);
    fireEvent.click(screen.getByRole("button", { name: "Auditeur" }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("indisponible");
    });
  });

  it("désactive les boutons pendant la connexion", async () => {
    server.use(
      http.post("/api/auth/demo-login", async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return HttpResponse.json({ ok: true });
      })
    );

    render(<DemoLoginPanel roles={[...ALL_ROLES]} />);
    fireEvent.click(screen.getByRole("button", { name: "Agent" }));

    await waitFor(() => {
      const buttons = screen.getAllByRole("button") as HTMLButtonElement[];
      expect(buttons.every((b) => b.disabled)).toBe(true);
    });
  });
});
