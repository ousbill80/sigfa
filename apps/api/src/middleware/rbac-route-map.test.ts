/**
 * Tests unitaires — Boucle 3 F3 : durcissement RBAC AUDITOR (orthogonal).
 *
 * LA LOI de sécurité : AUDITOR est un rôle LECTURE SEULE orthogonal à la
 * hiérarchie numérique. Il ne doit JAMAIS dériver un accès mutant d'AGENT :
 *   - AUDITOR autorise UNIQUEMENT les routes en lecture (méthode GET) de son
 *     scope + les routes explicitement `requiredRole:"AUDITOR"`.
 *   - AUDITOR est REFUSÉ (403) sur toute route mutante (POST/PATCH/PUT/DELETE),
 *     quel que soit le `requiredRole`.
 *   - SUPER_ADMIN conserve son accès total.
 *   - Les autres rôles (AGENT/MANAGER/...) restent INCHANGÉS.
 *
 * @module
 */

import { describe, it, expect } from "vitest";
import { hasRequiredRole } from "src/middleware/rbac-route-map.js";

describe("SEC-F3: RBAC AUDITOR orthogonal (lecture seule)", () => {
  it("SEC-F3: AUDITOR REFUSÉ sur POST /tickets (requiredRole AGENT, méthode mutante)", () => {
    expect(hasRequiredRole("AUDITOR", "AGENT", "POST")).toBe(false);
  });

  it("SEC-F3: AUDITOR REFUSÉ sur toutes les mutations AGENT du lot F3", () => {
    for (const method of ["POST", "PATCH", "PUT", "DELETE"]) {
      expect(hasRequiredRole("AUDITOR", "AGENT", method)).toBe(false);
    }
  });

  it("SEC-F3: AUDITOR AUTORISÉ sur GET requiredRole AGENT (lecture de son scope)", () => {
    expect(hasRequiredRole("AUDITOR", "AGENT", "GET")).toBe(true);
  });

  it("SEC-F3: AUDITOR AUTORISÉ sur GET /audit-logs (requiredRole AUDITOR)", () => {
    expect(hasRequiredRole("AUDITOR", "AUDITOR", "GET")).toBe(true);
  });

  it("SEC-F3: AUDITOR REFUSÉ sur une route mutante requiredRole AUDITOR (défense en profondeur)", () => {
    expect(hasRequiredRole("AUDITOR", "AUDITOR", "POST")).toBe(false);
  });

  it("SEC-F3: SUPER_ADMIN conserve son accès mutant", () => {
    expect(hasRequiredRole("SUPER_ADMIN", "AGENT", "POST")).toBe(true);
    expect(hasRequiredRole("SUPER_ADMIN", "AUDITOR", "GET")).toBe(true);
  });

  it("SEC-F3: AGENT/MANAGER inchangés (matrice existante)", () => {
    // AGENT satisfait AGENT en mutation
    expect(hasRequiredRole("AGENT", "AGENT", "POST")).toBe(true);
    // MANAGER (rang supérieur) satisfait AGENT
    expect(hasRequiredRole("MANAGER", "AGENT", "POST")).toBe(true);
    // AGENT ne satisfait PAS MANAGER
    expect(hasRequiredRole("AGENT", "MANAGER", "GET")).toBe(false);
    // AGENT ne satisfait PAS une route AUDITOR (orthogonal, pas dérivable)
    expect(hasRequiredRole("AGENT", "AUDITOR", "GET")).toBe(false);
    expect(hasRequiredRole("MANAGER", "AUDITOR", "GET")).toBe(false);
  });

  it("SEC-F3: AUTHENTICATED/NONE inchangés", () => {
    expect(hasRequiredRole("AGENT", "NONE", "POST")).toBe(true);
    expect(hasRequiredRole("AGENT", "AUTHENTICATED", "POST")).toBe(true);
    expect(hasRequiredRole("NONE", "AUTHENTICATED", "GET")).toBe(false);
  });

  // ── CONTRACT-013 : DISPLAY orthogonal socket-only, REFUSÉ sur tout HTTP ──
  it("SEC-CONTRACT-013: DISPLAY REFUSÉ sur toute route HTTP protégée (mutation ET lecture)", () => {
    // Mutations : jamais.
    for (const method of ["POST", "PATCH", "PUT", "DELETE"]) {
      expect(hasRequiredRole("DISPLAY", "AGENT", method)).toBe(false);
    }
    // Lectures : jamais non plus (rôle d'affichage socket pur, aucune surface HTTP).
    expect(hasRequiredRole("DISPLAY", "AGENT", "GET")).toBe(false);
    expect(hasRequiredRole("DISPLAY", "MANAGER", "GET")).toBe(false);
    expect(hasRequiredRole("DISPLAY", "AUDITOR", "GET")).toBe(false);
  });

  it("SEC-CONTRACT-013: DISPLAY autorisé sur route publique NONE mais REFUSÉ sur AUTHENTICATED", () => {
    // Une route publique (`requiredRole:NONE`) n'exige aucun rôle — DISPLAY passe
    // au même titre que n'importe qui (ex. re-mint de son propre token TV).
    expect(hasRequiredRole("DISPLAY", "NONE", "POST")).toBe(true);
    // Mais une route AUTHENTICATED (/auth/me, heartbeat, devices) lui est REFUSÉE :
    // le refus DISPLAY intervient AVANT la garde AUTHENTICATED (défense en profondeur).
    expect(hasRequiredRole("DISPLAY", "AUTHENTICATED", "GET")).toBe(false);
    expect(hasRequiredRole("DISPLAY", "AUTHENTICATED", "POST")).toBe(false);
  });
});
