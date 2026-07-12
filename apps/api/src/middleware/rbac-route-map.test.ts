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
});
