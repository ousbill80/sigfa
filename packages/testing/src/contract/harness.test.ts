import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile, chmod, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

describe("INFRA-008: harness contract — couverture branches", () => {
  it(
    "INFRA-008: contractPath inexistant → exit 1 + message fichier introuvable",
    async () => {
      // docker exists (real docker or stub), contract path given but file missing
      const result = await runSchemathesis({
        contractPath: "/tmp/nonexistent-contract-infra008.yaml",
        dockerPath: process.execPath, // node is always available, "node --version" works
      });
      expect(result.exitCode).toBe(1);
      expect(result.output).toMatch(/introuvable|not found|ENOENT/i);
    },
    30_000
  );

  it(
    "INFRA-008: docker stub succès → exit 0 + output du stub",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "infra008-"));
      const contractPath = join(dir, "contract.yaml");
      const dockerStub = join(dir, "docker-stub.sh");
      await writeFile(
        contractPath,
        "openapi: '3.0.0'\ninfo:\n  title: test\n  version: '1.0.0'\n"
      );
      // Stub: --version succeeds, run also succeeds
      await writeFile(
        dockerStub,
        `#!/bin/sh\necho "Docker version stub 24.0.0"\nexit 0\n`
      );
      await chmod(dockerStub, 0o755);
      try {
        const result = await runSchemathesis({ contractPath, dockerPath: dockerStub });
        expect(result.exitCode).toBe(0);
        expect(result.output).toContain("stub");
      } finally {
        await rm(dir, { recursive: true });
      }
    },
    30_000
  );

  it(
    "INFRA-008: docker stub échec (exit 1) → exitCode non-0 + output",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "infra008-"));
      const contractPath = join(dir, "contract.yaml");
      const dockerStub = join(dir, "docker-fail.sh");
      await writeFile(
        contractPath,
        "openapi: '3.0.0'\ninfo:\n  title: test\n  version: '1.0.0'\n"
      );
      // Stub: --version succeeds, run fails with exit 1
      await writeFile(
        dockerStub,
        `#!/bin/sh\nif [ "$1" = "--version" ]; then\n  echo "Docker version stub 24.0.0"\n  exit 0\nfi\necho "Schemathesis error output"\nexit 1\n`
      );
      await chmod(dockerStub, 0o755);
      try {
        const result = await runSchemathesis({ contractPath, dockerPath: dockerStub });
        expect(result.exitCode).not.toBe(0);
      } finally {
        await rm(dir, { recursive: true });
      }
    },
    30_000
  );
});
