import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
// packages/config/src -> packages/config -> packages -> root (sigfa-kit)
const ROOT = resolve(__dirname, "../../..");

describe("Root configuration inspection", () => {
  it("package.json has correct engines", () => {
    const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf-8")) as {
      engines: { node: string; pnpm: string };
      packageManager: string;
    };
    expect(pkg.engines.node).toBe(">=22 <23");
    expect(pkg.engines.pnpm).toBe(">=10 <11");
  });

  it("package.json has correct packageManager", () => {
    const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf-8")) as {
      packageManager: string;
    };
    expect(pkg.packageManager).toBe("pnpm@10.30.3");
  });

  it(".npmrc has engine-strict=true", () => {
    const npmrc = readFileSync(resolve(ROOT, ".npmrc"), "utf-8");
    expect(npmrc).toContain("engine-strict=true");
  });

  it("turbo.json test.dependsOn contains only ^build (not build)", () => {
    const turbo = JSON.parse(readFileSync(resolve(ROOT, "turbo.json"), "utf-8")) as {
      tasks: { test: { dependsOn: string[] } };
    };
    const deps = turbo.tasks.test.dependsOn;
    expect(deps).toContain("^build");
    expect(deps).not.toContain("build");
  });
});
