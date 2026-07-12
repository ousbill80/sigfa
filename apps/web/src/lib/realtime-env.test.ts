// @vitest-environment node
/**
 * Tests for lib/realtime-env — bascule d'env temps réel et origine socket.
 * @module lib/realtime-env.test
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import {
  resolveRealtimeMode,
  restApiBase,
  socketOrigin,
  DEFAULT_MOCK_URL,
} from "./realtime-env";

describe("realtime-env", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("resolveRealtimeMode: real seulement quand NEXT_PUBLIC_REALTIME_MODE=real", () => {
    vi.stubEnv("NEXT_PUBLIC_REALTIME_MODE", "real");
    expect(resolveRealtimeMode()).toBe("real");
    vi.stubEnv("NEXT_PUBLIC_REALTIME_MODE", "off");
    expect(resolveRealtimeMode()).toBe("off");
    vi.stubEnv("NEXT_PUBLIC_REALTIME_MODE", "");
    expect(resolveRealtimeMode()).toBe("off");
  });

  it("restApiBase: env sinon mock canonique", () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "https://api.example.ci/api/v1");
    expect(restApiBase()).toBe("https://api.example.ci/api/v1");
  });

  it("restApiBase: défaut mock Prism :4010", () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "");
    expect(restApiBase()).toBe(DEFAULT_MOCK_URL);
  });

  it("socketOrigin: rebase une URL /api/v1 sur son origine", () => {
    expect(socketOrigin("https://api.example.ci/api/v1")).toBe("https://api.example.ci");
    expect(socketOrigin("http://localhost:4010")).toBe("http://localhost:4010");
  });

  it("socketOrigin: URL invalide → renvoyée telle quelle", () => {
    expect(socketOrigin("not-a-url")).toBe("not-a-url");
  });
});
