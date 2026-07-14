/**
 * Tests for SessionHeader (WEB-002-HDR) — agent connecté visible + déconnexion.
 * @module components/ui/session-header.test
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SessionHeader } from "./session-header";
import { t } from "@/lib/i18n";

describe("SessionHeader — utilisateur connecté + déconnexion (WEB-002-HDR)", () => {
  it("WEB-002-HDR: affiche le nom (claim displayName) et le rôle traduit (FR)", () => {
    render(<SessionHeader name="Awa Koné" role="AGENT" locale="fr" />);
    expect(screen.getByTestId("session-user-name")).toHaveTextContent("Awa Koné");
    expect(screen.getByTestId("session-user-role")).toHaveTextContent(t("role.AGENT", "fr"));
  });

  it("WEB-002-HDR: sans nom (token historique) → rôle seul, pas de nœud nom vide", () => {
    render(<SessionHeader name={null} role="MANAGER" locale="fr" />);
    expect(screen.queryByTestId("session-user-name")).not.toBeInTheDocument();
    expect(screen.getByTestId("session-user-role")).toHaveTextContent(t("role.MANAGER", "fr"));
  });

  it("WEB-002-HDR: bouton « Se déconnecter » = form POST /api/auth/logout (zéro JS client)", () => {
    render(<SessionHeader name="Awa Koné" role="AGENT" locale="fr" />);
    const button = screen.getByTestId("session-logout");
    expect(button).toHaveTextContent(t("session.logout", "fr"));
    const form = button.closest("form");
    expect(form).not.toBeNull();
    expect(form?.getAttribute("action")).toBe("/api/auth/logout");
    expect(form?.getAttribute("method")).toBe("post");
  });

  it("WEB-002-HDR: tokens design v2 uniquement — aucune couleur hexadécimale en dur", () => {
    render(<SessionHeader name="Awa Koné" role="AGENT" locale="fr" />);
    const header = screen.getByTestId("session-header");
    expect(header.outerHTML).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
    expect(header.getAttribute("style")).toContain("var(--hairline)");
  });
});
