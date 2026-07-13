/**
 * Tests for LoginPage — gate serveur de la connexion démo directe.
 * Flag OFF (défaut) → la page est STRICTEMENT inchangée : aucun bloc démo,
 * aucun bouton rôle. Flag ON + mots de passe env → bloc « Mode démo »
 * avec les 5 boutons rôle sous le formulaire.
 * @module app/login/page.test
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import LoginPage from "./page";

// Mock next/navigation (LoginForm et DemoLoginPanel lisent `next`)
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

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("LoginPage — flag OFF (défaut, garantie prod)", () => {
  it("ne rend AUCUN bloc démo ni bouton rôle", () => {
    vi.stubEnv("SIGFA_DEMO_LOGIN", "");
    render(<LoginPage />);
    expect(screen.getByText("Connexion")).toBeTruthy();
    expect(screen.queryByText("Mode démo — connexion directe")).toBeNull();
    expect(screen.queryByRole("button", { name: "Administrateur banque" })).toBeNull();
    // Seul le bouton de soumission du formulaire est présent
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("ne rend pas le bloc démo si le flag est ON mais sans aucun mot de passe env", () => {
    vi.stubEnv("SIGFA_DEMO_LOGIN", "1");
    render(<LoginPage />);
    expect(screen.queryByText("Mode démo — connexion directe")).toBeNull();
  });
});

describe("LoginPage — flag ON (SIGFA_DEMO_LOGIN=1, phase de test)", () => {
  it("rend le bloc « Mode démo » avec les 5 boutons rôle sous le formulaire", () => {
    vi.stubEnv("SIGFA_DEMO_LOGIN", "1");
    for (const role of ALL_ROLES) {
      vi.stubEnv(`DEMO_LOGIN_PASSWORD_${role}`, `pw-${role.toLowerCase()}`);
    }
    render(<LoginPage />);
    expect(screen.getByText("Mode démo — connexion directe")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Administrateur banque" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Directeur d'agence" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Manager" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Agent" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Auditeur" })).toBeTruthy();
    // 1 bouton de soumission + 5 boutons rôle
    expect(screen.getAllByRole("button")).toHaveLength(6);
  });
});
