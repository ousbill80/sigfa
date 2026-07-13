/**
 * Tests d'intégration — magasins Redis d'onboarding (ADM-002a, Redis réel).
 *
 * Prouve : enrôlement single-use via GETDEL (2e consommation → null), TTL appliqué,
 * parcours d'onboarding scopé tenant (un autre bankId ne résout pas), round-trip.
 *
 * @module
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Redis } from "ioredis";
import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";
import {
  RedisEnrollmentTokenStore,
  RedisOnboardingStore,
  ONBOARDING_STATE_TTL_SECONDS,
} from "src/services/onboarding-stores.js";
import { generateEnrollmentToken, type EnrollmentBinding } from "src/lib/enrollment-token.js";
import { createJourney, markStep } from "src/lib/onboarding-journey.js";

let container: StartedTestContainer;
let redis: Redis;

const BINDING: EnrollmentBinding = {
  kioskId: "14141414-1414-4141-a141-141414141414",
  bankId: "22222222-2222-4222-a222-222222222222",
  agencyId: "66666666-6666-4666-a666-666666666666",
};

beforeAll(async () => {
  container = await new GenericContainer("redis:7")
    .withExposedPorts(6379)
    .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
    .start();
  redis = new Redis(`redis://${container.getHost()}:${container.getMappedPort(6379)}`);
}, 120_000);

afterAll(async () => {
  await redis.quit();
  await container.stop();
}, 30_000);

describe("ADM-002a: RedisEnrollmentTokenStore single-use", () => {
  it("ADM-002a: put + consume résout le binding puis l'invalide (GETDEL atomique)", async () => {
    const store = new RedisEnrollmentTokenStore(redis);
    const g = generateEnrollmentToken();
    await store.put(g.storageKey, BINDING, g.ttlSeconds);
    expect(await store.consume(g.storageKey)).toEqual(BINDING);
    // 2e consommation → null (usage unique).
    expect(await store.consume(g.storageKey)).toBeNull();
  });

  it("ADM-002a: le TTL est appliqué en Redis (EX)", async () => {
    const store = new RedisEnrollmentTokenStore(redis);
    const g = generateEnrollmentToken(5);
    await store.put(g.storageKey, BINDING, g.ttlSeconds);
    const ttl = await redis.ttl(`kiosk:enroll:${g.storageKey}`);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(300);
  });

  it("ADM-002a: consume d'une clé absente → null", async () => {
    const store = new RedisEnrollmentTokenStore(redis);
    expect(await store.consume("absent-key")).toBeNull();
  });
});

describe("ADM-002a: RedisOnboardingStore scopé tenant", () => {
  it("ADM-002a: save + load round-trip et applique un TTL de sécurité", async () => {
    const store = new RedisOnboardingStore(redis);
    let journey = createJourney({
      onboardingId: "77777777-7777-4777-a777-777777777777",
      agencyId: BINDING.agencyId,
      bankId: BINDING.bankId,
    });
    journey = markStep(journey, "agency_created", "DONE");
    await store.save(journey);

    const loaded = await store.load(BINDING.bankId, journey.onboardingId);
    expect(loaded?.onboardingId).toBe(journey.onboardingId);
    expect(loaded?.steps.find((s) => s.key === "agency_created")?.status).toBe("DONE");

    const ttl = await redis.ttl(`onboarding:${BINDING.bankId}:${journey.onboardingId}`);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(ONBOARDING_STATE_TTL_SECONDS);
  });

  it("ADM-002a: un onboardingId d'un AUTRE tenant ne résout pas (garde d'isolation)", async () => {
    const store = new RedisOnboardingStore(redis);
    const journey = createJourney({
      onboardingId: "88888888-8888-4888-a888-888888888888",
      agencyId: BINDING.agencyId,
      bankId: BINDING.bankId,
    });
    await store.save(journey);
    // Même onboardingId, mauvais tenant → null.
    expect(await store.load("99999999-9999-4999-a999-999999999999", journey.onboardingId)).toBeNull();
  });
});
