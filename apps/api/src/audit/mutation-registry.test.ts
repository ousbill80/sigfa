/**
 * Test de PARITÉ registre↔routes — SEC-001a.
 *
 * Filet anti-régression : le `MUTATION_REGISTRY` est la source de vérité de
 * l'audit des mutations. Ce test le confronte au `ROUTE_RBAC_MAP` (routes
 * réellement mappées/montées) :
 *
 *  - TOUTE route mutante (POST/PATCH/PUT/DELETE) du `ROUTE_RBAC_MAP` DOIT avoir
 *    une entrée de registre → une mutation ajoutée sans entrée fait ÉCHOUER ici.
 *  - TOUTE entrée de registre DOIT correspondre à une route mappée → un registre
 *    qui dérive du contrat réel fait ÉCHOUER ici.
 *  - Cohérence des dispositions : `app` ⇒ action non nulle ; `exempt` ⇒ raison.
 *
 * Ce test est STATIQUE (aucune DB) : c'est le garde-fou de couverture exigé par
 * SEC-001a (« une route mutante absente du registre → échec »).
 *
 * @module
 */

import { describe, it, expect } from "vitest";
import { ROUTE_RBAC_MAP } from "src/middleware/rbac-route-map.js";
import {
  MUTATION_REGISTRY,
  findMutationEntry,
  type MutationEntry,
} from "src/audit/mutation-registry.js";

/** Méthodes de lecture (jamais des mutations auditables). */
const READ_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD", "OPTIONS"]);

/** Clé stable méthode+chemin. */
function key(method: string, path: string): string {
  return `${method.toUpperCase()} ${path}`;
}

/** Toutes les routes mutantes du contrat (RBAC map). */
const RBAC_MUTATIONS = ROUTE_RBAC_MAP.filter(
  (e) => !READ_METHODS.has(e.method.toUpperCase())
);

describe("SEC-001a: parité mutation-registry ↔ routes montées", () => {
  it("SEC-001a: chaque route mutante du ROUTE_RBAC_MAP a une entrée de registre (aucune oubliée)", () => {
    const missing = RBAC_MUTATIONS.filter(
      (e) => !findMutationEntry(e.method, e.path)
    ).map((e) => key(e.method, e.path));
    expect(missing).toEqual([]);
  });

  it("SEC-001a: chaque entrée de registre correspond à une route mutante mappée (pas d'entrée fantôme)", () => {
    const mappedKeys = new Set(
      RBAC_MUTATIONS.map((e) => key(e.method, e.path))
    );
    const orphan = MUTATION_REGISTRY.filter(
      (m) => !mappedKeys.has(key(m.method, m.path))
    ).map((m) => key(m.method, m.path));
    expect(orphan).toEqual([]);
  });

  it("SEC-001a: cardinalité identique registre ↔ mutations mappées (bijection)", () => {
    expect(MUTATION_REGISTRY.length).toBe(RBAC_MUTATIONS.length);
  });

  it("SEC-001a: aucune entrée de registre en double (méthode+chemin unique)", () => {
    const keys = MUTATION_REGISTRY.map((m) => key(m.method, m.path));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("SEC-001a: disposition `app` ⇒ action stable non nulle", () => {
    const bad = MUTATION_REGISTRY.filter(
      (m) => m.disposition === "app" && (m.action === null || m.action.length === 0)
    ).map((m) => key(m.method, m.path));
    expect(bad).toEqual([]);
  });

  it("SEC-001a: disposition `exempt` ⇒ justification obligatoire + action nulle", () => {
    const bad = MUTATION_REGISTRY.filter(
      (m) =>
        m.disposition === "exempt" &&
        (!m.exemptReason || m.exemptReason.length === 0 || m.action !== null)
    ).map((m) => key(m.method, m.path));
    expect(bad).toEqual([]);
  });

  it("SEC-001a: les transitions de ticket (API-003) sont TOUTES auditées applicativement", () => {
    const ticketMutations: Array<[MutationEntry["method"], string]> = [
      ["POST", "/tickets"],
      ["POST", "/tickets/{id}/call"],
      ["POST", "/tickets/{id}/serve"],
      ["POST", "/tickets/{id}/close"],
      ["POST", "/tickets/{id}/no-show"],
      ["POST", "/tickets/{id}/transfer"],
      ["POST", "/tickets/{id}/abandon"],
      ["POST", "/counters/{counterId}/call-next"],
      ["POST", "/tickets/sync"],
    ];
    for (const [method, path] of ticketMutations) {
      const entry = findMutationEntry(method, path);
      expect(entry, `${method} ${path} doit être au registre`).toBeDefined();
      expect(entry?.disposition, `${method} ${path} doit être auditée (app)`).toBe("app");
    }
  });

  it("SEC-001a: la révocation de session borne (API-011) est auditée applicativement", () => {
    const entry = findMutationEntry("DELETE", "/kiosk/session/{kioskId}");
    expect(entry?.disposition).toBe("app");
  });

  it("SEC-001a: le feedback client (API-010) est audité applicativement", () => {
    const entry = findMutationEntry("POST", "/public/tickets/{trackingId}/feedback");
    expect(entry?.disposition).toBe("app");
  });
});
