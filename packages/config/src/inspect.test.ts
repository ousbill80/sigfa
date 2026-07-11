import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
// packages/config/src -> packages/config -> packages -> root (sigfa-kit)
const ROOT = resolve(__dirname, "../../..");

describe("Root configuration inspection", () => {
  it("INFRA-001: package.json has correct engines", () => {
    const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf-8")) as {
      engines: { node: string; pnpm: string };
      packageManager: string;
    };
    expect(pkg.engines.node).toBe(">=22 <23");
    expect(pkg.engines.pnpm).toBe(">=10 <11");
  });

  it("INFRA-001: package.json has correct packageManager", () => {
    const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf-8")) as {
      packageManager: string;
    };
    expect(pkg.packageManager).toBe("pnpm@10.30.3");
  });

  it("INFRA-001: .npmrc has engine-strict=true", () => {
    const npmrc = readFileSync(resolve(ROOT, ".npmrc"), "utf-8");
    expect(npmrc).toContain("engine-strict=true");
  });

  it("INFRA-001: turbo.json test.dependsOn contains only ^build (not build)", () => {
    const turbo = JSON.parse(readFileSync(resolve(ROOT, "turbo.json"), "utf-8")) as {
      tasks: { test: { dependsOn: string[] } };
    };
    const deps = turbo.tasks.test.dependsOn;
    expect(deps).toContain("^build");
    expect(deps).not.toContain("build");
  });

  it("INFRA-002: turbo.json typecheck.dependsOn contains ^build (deps compiled) but NOT build (own package)", () => {
    const turbo = JSON.parse(readFileSync(resolve(ROOT, "turbo.json"), "utf-8")) as {
      tasks: { typecheck?: { dependsOn?: string[] } };
    };
    const deps = turbo.tasks.typecheck?.dependsOn ?? [];
    // Dépendances workspace doivent être compilées avant le typecheck
    expect(deps).toContain("^build");
    // Mais le package courant ne doit PAS se builder lui-même avant son propre typecheck
    expect(deps).not.toContain("build");
  });

  it("INFRA-001: .env.example contient l'en-tête de sécurité et NODE_ENV", () => {
    const envExample = readFileSync(resolve(ROOT, ".env.example"), "utf-8");
    // Doit contenir l'en-tête indiquant de ne pas committer .env
    expect(envExample).toMatch(/Ne jamais committer|never commit/i);
    // Doit contenir NODE_ENV
    expect(envExample).toContain("NODE_ENV");
  });

  it("INFRA-001: .gitignore contient .env pour protéger les secrets", () => {
    const gitignore = readFileSync(resolve(ROOT, ".gitignore"), "utf-8");
    // .env doit figurer dans .gitignore (ligne exacte)
    const lines = gitignore.split("\n").map((l) => l.trim());
    expect(lines).toContain(".env");
  });
});
