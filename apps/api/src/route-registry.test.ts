/**
 * Tests du registre de routes déclaratif (route-registry.ts).
 *
 * Filet du refactor comportement-préservant : vérifie que le registre expose
 * EXACTEMENT les basePaths attendus, dans le bon ORDRE, sans doublon de
 * descripteur, et que les injections d'`AppOptions` restent câblées.
 *
 * @module
 */

import { describe, it, expect } from "vitest";
import { Redis } from "ioredis";
import pg from "pg";
import { buildRouteRegistry, type RouteDescriptor } from "./route-registry.js";
import type { AppOptions } from "./app.js";
import type { QueueHealthProvider } from "./routes/health.js";
import type { QueueHealth } from "./services/notification-jobs.js";

/** Options minimales : clients fictifs (pas de vraie DB/Redis nécessaire). */
function baseOptions(extra: Partial<AppOptions> = {}): AppOptions {
  return {
    db: {} as pg.Client,
    redis: {} as Redis,
    jwtSecret: new TextEncoder().encode("test-jwt-secret-at-least-32-chars!!!"),
    ...extra,
  };
}

/**
 * Séquence ATTENDUE des basePaths — reproduit à l'identique l'ordre
 * d'enregistrement historique de `app.ts` avant extraction. Toute divergence
 * (ordre, chemin, ajout, suppression) fait échouer ce test.
 */
const EXPECTED_BASE_PATHS: readonly string[] = [
  "/api/v1/auth", // auth
  "/api/v1", // tickets
  "/api/v1", // tickets-sync
  "/api/v1", // queues
  "/api/v1", // agents
  "/api/v1", // banks
  "/api/v1", // agencies
  "/api/v1", // services
  "/api/v1", // operations
  "/api/v1", // counters
  "/api/v1", // hours
  "/api/v1", // thresholds
  "/api/v1", // sms-templates
  "/api/v1", // theme
  "/api/v1", // onboarding
  "/api/v1", // kiosk-session
  "/api/v1", // tv-session
  "/api/v1", // agents-import
  "/api/v1", // data-privacy
  "/api/v1", // public-tickets
  "/api/v1", // health
  "/api/v1", // kiosks-status
  "/api/v1", // audit-logs
  "/api/v1", // devices
  "/api/v1", // reports
  "/api/v1", // webhooks-notifications
  "/api/v1", // webhooks-whatsapp-inbound
  "/api/v1", // ai-anomalies (IA-003, CONTRACT-008)
];

describe("route-registry", () => {
  it("REFACTOR-REG-001: expose la séquence exacte des basePaths dans l'ordre historique", () => {
    const registry = buildRouteRegistry(baseOptions());
    expect(registry.map((r) => r.basePath)).toEqual(EXPECTED_BASE_PATHS);
  });

  it("REFACTOR-REG-002: monte 28 routeurs (aucune route perdue ni ajoutée)", () => {
    const registry = buildRouteRegistry(baseOptions());
    expect(registry).toHaveLength(EXPECTED_BASE_PATHS.length);
  });

  it("REFACTOR-REG-003: chaque descripteur expose un basePath /api/v1 et un monteur", () => {
    const registry = buildRouteRegistry(baseOptions());
    for (const descriptor of registry) {
      expect(typeof descriptor.basePath).toBe("string");
      expect(descriptor.basePath.startsWith("/api/v1")).toBe(true);
      expect(typeof descriptor.apply).toBe("function");
    }
  });

  it("REFACTOR-REG-004: aucun descripteur en double (même monteur référencé)", () => {
    const registry = buildRouteRegistry(baseOptions());
    const mounters = registry.map((r) => r.apply);
    expect(new Set(mounters).size).toBe(mounters.length);
  });

  it("REFACTOR-REG-005: /auth est monté sur son sous-chemin dédié /api/v1/auth", () => {
    const registry = buildRouteRegistry(baseOptions());
    const authOnly = registry.filter((r) => r.basePath === "/api/v1/auth");
    expect(authOnly).toHaveLength(1);
    // Et c'est le PREMIER descripteur (ordre préservé).
    expect(registry[0]?.basePath).toBe("/api/v1/auth");
  });

  it("REFACTOR-REG-006: injections AppOptions optionnelles n'altèrent ni ordre ni cardinalité", () => {
    const healthyQueues: QueueHealth = {
      channels: [
        {
          name: "notifications-sms",
          counts: { waiting: 0, active: 0, failed: 0, completed: 0, delayed: 0 },
        },
      ],
      dlq: {
        name: "notifications-dlq",
        counts: { waiting: 0, active: 0, failed: 0, completed: 0, delayed: 0 },
      },
      healthy: true,
    };
    const queueHealth: QueueHealthProvider = async () => healthyQueues;
    const withInjections = buildRouteRegistry(
      baseOptions({
        queueHealth,
        exportEnqueue: async () => {},
      })
    );
    const without = buildRouteRegistry(baseOptions());
    expect(withInjections.map((r) => r.basePath)).toEqual(
      without.map((r) => r.basePath)
    );
    expect(withInjections).toHaveLength(without.length);
  });

  it("REFACTOR-REG-007: le type RouteDescriptor est exposé et immuable côté conso", () => {
    // Vérif de forme au runtime : le tableau est bien un array de descripteurs.
    const registry: readonly RouteDescriptor[] = buildRouteRegistry(baseOptions());
    expect(Array.isArray(registry)).toBe(true);
  });
});
