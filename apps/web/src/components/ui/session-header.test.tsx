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

  it("WEB-002-HDR: logo banque provisionné → <img> alt=nom banque + nom affiché à gauche", () => {
    render(
      <SessionHeader
        name="Awa Koné"
        role="AGENT"
        locale="fr"
        bankName="Banque Atlantique"
        bankLogoUrl="https://cdn.example/logo.svg"
      />
    );
    const logo = screen.getByTestId("session-bank-logo");
    expect(logo.getAttribute("src")).toBe("https://cdn.example/logo.svg");
    expect(logo.getAttribute("alt")).toBe("Banque Atlantique");
    expect(screen.getByTestId("session-bank-name")).toHaveTextContent("Banque Atlantique");
    expect(screen.queryByTestId("session-bank-badge")).not.toBeInTheDocument();
  });

  it("WEB-002-HDR: sans logo → repli pastille --brand + initiale (même convention que kiosk-branding)", () => {
    render(
      <SessionHeader name="Awa Koné" role="AGENT" locale="fr" bankName="Ecobank" bankLogoUrl={null} />
    );
    const badge = screen.getByTestId("session-bank-badge");
    expect(badge).toHaveTextContent("E");
    expect(badge.getAttribute("style")).toContain("var(--brand)");
    expect(badge.getAttribute("style")).toContain("var(--brand-contrast)");
    expect(screen.queryByTestId("session-bank-logo")).not.toBeInTheDocument();
    expect(screen.getByTestId("session-bank-name")).toHaveTextContent("Ecobank");
  });

  it("WEB-002-HDR: sans provisionnement → nom de banque repli SIGFA (le bandeau ne casse jamais)", () => {
    render(<SessionHeader name="Awa Koné" role="AGENT" locale="fr" />);
    expect(screen.getByTestId("session-bank-name")).toHaveTextContent("SIGFA");
    expect(screen.getByTestId("session-bank-badge")).toHaveTextContent("S");
  });

  it("WEB-002-HDR: agence de rattachement affichée à côté du nom de l'utilisateur", () => {
    render(
      <SessionHeader name="Awa Koné" role="AGENT" locale="fr" agencyLabel="Agence Plateau" />
    );
    const user = screen.getByTestId("session-user");
    const agency = screen.getByTestId("session-user-agency");
    expect(agency).toHaveTextContent("Agence Plateau");
    expect(user.contains(agency)).toBe(true);
  });

  it("WEB-002-HDR: plusieurs agences → libellé « première +N » rendu tel quel", () => {
    render(
      <SessionHeader name="Awa Koné" role="MANAGER" locale="fr" agencyLabel="Agence Plateau +2" />
    );
    expect(screen.getByTestId("session-user-agency")).toHaveTextContent("Agence Plateau +2");
  });

  it("WEB-002-HDR: 0 agence (bank admin) → pas de nœud agence, la banque seule à gauche", () => {
    render(
      <SessionHeader
        name="Adjoua B."
        role="BANK_ADMIN"
        locale="fr"
        bankName="Banque Atlantique"
        agencyLabel={null}
      />
    );
    expect(screen.queryByTestId("session-user-agency")).not.toBeInTheDocument();
    expect(screen.getByTestId("session-bank-name")).toHaveTextContent("Banque Atlantique");
  });
});
