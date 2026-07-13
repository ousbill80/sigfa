/**
 * Tests for demo-login — connexion démo directe par rôle (phase de test).
 * Garanties : OFF par défaut (fail-closed), liste fermée de rôles (jamais
 * SUPER_ADMIN), secrets lus UNIQUEMENT dans l'env serveur, emails
 * déterministes alignés sur le seed (packages/database).
 * @module lib/demo-login.test
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import {
  DEMO_LOGIN_ROLES,
  isDemoLoginEnabled,
  isDemoLoginRole,
  demoEmailForRole,
  getDemoCredentials,
  getAvailableDemoRoles,
} from "./demo-login";

/** Active le flag + les 5 mots de passe démo. */
function stubAllDemoEnv(): void {
  vi.stubEnv("SIGFA_DEMO_LOGIN", "1");
  for (const role of DEMO_LOGIN_ROLES) {
    vi.stubEnv(`DEMO_LOGIN_PASSWORD_${role}`, `pw-${role.toLowerCase()}`);
  }
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("demo-login — liste fermée de rôles", () => {
  it("expose exactement les 5 rôles démo, sans SUPER_ADMIN", () => {
    expect(DEMO_LOGIN_ROLES).toEqual([
      "BANK_ADMIN",
      "AGENCY_DIRECTOR",
      "MANAGER",
      "AGENT",
      "AUDITOR",
    ]);
  });

  it("isDemoLoginRole accepte uniquement la liste fermée", () => {
    expect(isDemoLoginRole("BANK_ADMIN")).toBe(true);
    expect(isDemoLoginRole("AUDITOR")).toBe(true);
    expect(isDemoLoginRole("SUPER_ADMIN")).toBe(false);
    expect(isDemoLoginRole("bank_admin")).toBe(false);
    expect(isDemoLoginRole("")).toBe(false);
    expect(isDemoLoginRole(42)).toBe(false);
    expect(isDemoLoginRole(undefined)).toBe(false);
  });
});

describe("demo-login — flag SIGFA_DEMO_LOGIN (fail-closed)", () => {
  it("OFF par défaut quand la variable est absente", () => {
    vi.stubEnv("SIGFA_DEMO_LOGIN", "");
    expect(isDemoLoginEnabled()).toBe(false);
  });

  it("OFF pour toute valeur autre que '1'", () => {
    vi.stubEnv("SIGFA_DEMO_LOGIN", "true");
    expect(isDemoLoginEnabled()).toBe(false);
    vi.stubEnv("SIGFA_DEMO_LOGIN", "0");
    expect(isDemoLoginEnabled()).toBe(false);
  });

  it("ON uniquement quand SIGFA_DEMO_LOGIN=1", () => {
    vi.stubEnv("SIGFA_DEMO_LOGIN", "1");
    expect(isDemoLoginEnabled()).toBe(true);
  });
});

describe("demo-login — emails déterministes du seed", () => {
  it("dérive demo.<role minuscules, _ → .>@sigfa-demo.ci", () => {
    expect(demoEmailForRole("BANK_ADMIN")).toBe("demo.bank.admin@sigfa-demo.ci");
    expect(demoEmailForRole("AGENCY_DIRECTOR")).toBe("demo.agency.director@sigfa-demo.ci");
    expect(demoEmailForRole("MANAGER")).toBe("demo.manager@sigfa-demo.ci");
    expect(demoEmailForRole("AGENT")).toBe("demo.agent@sigfa-demo.ci");
    expect(demoEmailForRole("AUDITOR")).toBe("demo.auditor@sigfa-demo.ci");
  });
});

describe("demo-login — getDemoCredentials", () => {
  it("retourne email + mot de passe env quand le flag est ON", () => {
    stubAllDemoEnv();
    expect(getDemoCredentials("AGENT")).toEqual({
      email: "demo.agent@sigfa-demo.ci",
      password: "pw-agent",
    });
  });

  it("retourne null quand le flag est OFF, même avec le mot de passe présent", () => {
    vi.stubEnv("SIGFA_DEMO_LOGIN", "");
    vi.stubEnv("DEMO_LOGIN_PASSWORD_AGENT", "pw-agent");
    expect(getDemoCredentials("AGENT")).toBeNull();
  });

  it("retourne null quand le mot de passe env est absent ou vide", () => {
    vi.stubEnv("SIGFA_DEMO_LOGIN", "1");
    vi.stubEnv("DEMO_LOGIN_PASSWORD_MANAGER", "");
    expect(getDemoCredentials("AGENT")).toBeNull();
    expect(getDemoCredentials("MANAGER")).toBeNull();
  });
});

describe("demo-login — getAvailableDemoRoles", () => {
  it("retourne [] quand le flag est OFF (page login strictement inchangée)", () => {
    vi.stubEnv("SIGFA_DEMO_LOGIN", "");
    vi.stubEnv("DEMO_LOGIN_PASSWORD_AGENT", "pw-agent");
    expect(getAvailableDemoRoles()).toEqual([]);
  });

  it("retourne uniquement les rôles dont le mot de passe env est fourni", () => {
    vi.stubEnv("SIGFA_DEMO_LOGIN", "1");
    vi.stubEnv("DEMO_LOGIN_PASSWORD_MANAGER", "pw-manager");
    vi.stubEnv("DEMO_LOGIN_PASSWORD_AUDITOR", "pw-auditor");
    expect(getAvailableDemoRoles()).toEqual(["MANAGER", "AUDITOR"]);
  });

  it("retourne les 5 rôles quand tout est fourni", () => {
    stubAllDemoEnv();
    expect(getAvailableDemoRoles()).toEqual([...DEMO_LOGIN_ROLES]);
  });
});
