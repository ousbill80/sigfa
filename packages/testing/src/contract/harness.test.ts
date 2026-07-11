import { describe, it, expect } from "vitest";
import { runSchemathesis, type SchemathesisResult } from "./harness.js";

describe("INFRA-005: harness contract", () => {
  it(
    "INFRA-005: run-schemathesis.sh sans YAML → exit 0 + message SKIP référençant CONTRACT-009",
    async () => {
      const result: SchemathesisResult = await runSchemathesis({
        contractPath: undefined,
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("SKIP");
      expect(result.output).toContain("CONTRACT-009");
    },
    30_000
  );

  it(
    "INFRA-005: run-schemathesis.sh sans Docker → échec propre avec message explicite",
    async () => {
      const result: SchemathesisResult = await runSchemathesis({
        contractPath: "/tmp/fake-contract.yaml",
        dockerPath: "/usr/bin/nonexistent-docker-for-test",
      });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toMatch(/docker|Docker/i);
    },
    30_000
  );
});
