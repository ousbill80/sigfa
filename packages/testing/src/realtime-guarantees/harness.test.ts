import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  createRealtimeHarness,
  type RealtimeHarness,
} from "./harness.js";

describe("INFRA-005: harness realtime-guarantees", () => {
  let harness: RealtimeHarness;

  beforeAll(async () => {
    harness = await createRealtimeHarness();
  }, 30_000);

  afterAll(async () => {
    await harness?.teardown();
  }, 15_000);

  it(
    "INFRA-005: harness realtime — événement Socket.io local reçu, latence mesurée et retournée",
    async () => {
      const latencyMs = await harness.measureEventLatency("test:ping", "test:pong");
      expect(typeof latencyMs).toBe("number");
      expect(latencyMs).toBeGreaterThanOrEqual(0);
      expect(latencyMs).toBeLessThan(1000); // aller simple local < 1 seconde
    },
    15_000
  );
});
