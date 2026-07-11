/**
 * Test suite for require-test-in-commit.sh (INFRA-004)
 *
 * Tests run in isolated temporary git repositories created with mktemp.
 * The script under test is: scripts/require-test-in-commit.sh (relative to repo root).
 *
 * Naming convention: "INFRA-004: <description>" for traceability.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { fileURLToPath } from "node:url";

// Use fileURLToPath to correctly decode URL-encoded characters (e.g. %20 for spaces)
// This is critical because the repo lives under "PROJET 2026" which contains a space.
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Absolute path to the script under test (in the worktree, not the temp repo)
const SCRIPT_PATH = path.resolve(
  __dirname,
  "../../../scripts/require-test-in-commit.sh"
);

// Absolute path to exemptions file
const EXEMPTIONS_PATH = path.resolve(
  __dirname,
  "../../../lefthook/test-exemptions.txt"
);

// Absolute path to lefthook.yml
const LEFTHOOK_YML_PATH = path.resolve(
  __dirname,
  "../../../lefthook.yml"
);

// Absolute path to commitlint.config.mjs
const COMMITLINT_CONFIG_PATH = path.resolve(
  __dirname,
  "../../../commitlint.config.mjs"
);

/** Create an isolated temporary git repo and return its path */
function createTempRepo(): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sigfa-test-"));
  execSync("git init", { cwd: tmpDir });
  execSync('git config user.email "test@test.com"', { cwd: tmpDir });
  execSync('git config user.name "Test"', { cwd: tmpDir });
  // Initial commit required so git diff --cached works
  fs.writeFileSync(path.join(tmpDir, ".gitkeep"), "");
  execSync("git add .gitkeep", { cwd: tmpDir });
  execSync('git commit -m "chore: init"', { cwd: tmpDir });
  return tmpDir;
}

/** Remove temp repo after test */
function removeTempRepo(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // best effort
  }
}

/**
 * Stage files in the repo and run the script.
 * Returns { exitCode, stdout, stderr }
 */
function runScript(
  repoDir: string,
  files: Record<string, string>
): { exitCode: number; stdout: string; stderr: string } {
  // Create the files in the repo
  for (const [filePath, content] of Object.entries(files)) {
    const fullPath = path.join(repoDir, filePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
    execSync(`git add "${filePath}"`, { cwd: repoDir });
  }

  // Run the script (not via a hook, directly)
  const result = spawnSync("bash", [SCRIPT_PATH], {
    cwd: repoDir,
    env: {
      ...process.env,
      HOME: repoDir,
      GIT_DIR: path.join(repoDir, ".git"),
    },
  });

  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout?.toString() ?? "",
    stderr: result.stderr?.toString() ?? "",
  };
}

/**
 * Run script with custom name-status output (for rename testing)
 * We need to stage a rename in git
 */
function stageRename(
  repoDir: string,
  oldPath: string,
  newPath: string,
  content: string,
  similarity: number
): void {
  // Create old file and commit it first
  const fullOldPath = path.join(repoDir, oldPath);
  fs.mkdirSync(path.dirname(fullOldPath), { recursive: true });

  if (similarity === 100) {
    // Pure rename: same content
    fs.writeFileSync(fullOldPath, content);
  } else {
    // Partial rename: different content (to get R<100)
    // Write original content first
    fs.writeFileSync(fullOldPath, "original content that is quite different\n");
  }

  execSync(`git add "${oldPath}"`, { cwd: repoDir });
  execSync(`git commit -m "chore: add file for rename test"`, {
    cwd: repoDir,
  });

  // Now perform the rename
  const fullNewPath = path.join(repoDir, newPath);
  fs.mkdirSync(path.dirname(fullNewPath), { recursive: true });

  if (similarity === 100) {
    fs.renameSync(fullOldPath, fullNewPath);
  } else {
    // Write different content to simulate partial similarity
    fs.writeFileSync(fullNewPath, content);
    fs.unlinkSync(fullOldPath);
  }

  execSync(`git add "${newPath}"`, { cwd: repoDir });
  // For git to detect rename, we need to delete the old
  try {
    execSync(`git rm "${oldPath}" 2>/dev/null || true`, { cwd: repoDir });
  } catch {
    // ignore
  }
  execSync(`git add -A`, { cwd: repoDir });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("INFRA-004: require-test-in-commit.sh", () => {
  beforeAll(() => {
    // Verify the script exists before running tests
    if (!fs.existsSync(SCRIPT_PATH)) {
      // Script doesn't exist yet — tests will fail (RED phase)
    }
  });

  afterAll(() => {
    // nothing global to clean
  });

  // ─── Critère 1: source seul → rejeté ──────────────────────────────────────

  it("INFRA-004: commit d'un .ts source seul sous apps/ → rejeté avec message", () => {
    const repo = createTempRepo();
    try {
      const result = runScript(repo, {
        "apps/api/src/service.ts": "export const x = 1;\n",
      });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("service.ts");
    } finally {
      removeTempRepo(repo);
    }
  });

  it("INFRA-004: commit d'un .ts source seul sous packages/ → rejeté avec message", () => {
    const repo = createTempRepo();
    try {
      const result = runScript(repo, {
        "packages/schemas/src/user.ts": "export type User = { id: string };\n",
      });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("user.ts");
    } finally {
      removeTempRepo(repo);
    }
  });

  // ─── Critère 2: source + test correspondant → accepté ─────────────────────

  it("INFRA-004: source + son .test.ts dans le même dossier → accepté", () => {
    const repo = createTempRepo();
    try {
      const result = runScript(repo, {
        "apps/api/src/service.ts": "export const x = 1;\n",
        "apps/api/src/service.test.ts":
          'import { x } from "./service.js"; console.log(x);\n',
      });
      expect(result.exitCode).toBe(0);
    } finally {
      removeTempRepo(repo);
    }
  });

  it("INFRA-004: source + son .spec.ts dans __tests__/ → accepté", () => {
    const repo = createTempRepo();
    try {
      const result = runScript(repo, {
        "packages/schemas/src/user.ts":
          "export type User = { id: string };\n",
        "packages/schemas/src/__tests__/user.spec.ts":
          'import type { User } from "../user.js"; const u: User = { id: "1" };\n',
      });
      expect(result.exitCode).toBe(0);
    } finally {
      removeTempRepo(repo);
    }
  });

  // ─── Critère 3: repli workspace ───────────────────────────────────────────

  it("INFRA-004: repli — source + un autre test touché du même workspace → accepté", () => {
    const repo = createTempRepo();
    try {
      // source is in packages/schemas, a test in packages/schemas (same workspace) is touched
      const result = runScript(repo, {
        "packages/schemas/src/user.ts":
          "export type User = { id: string };\n",
        "packages/schemas/src/other.test.ts":
          "// some other test in same workspace\n",
      });
      expect(result.exitCode).toBe(0);
    } finally {
      removeTempRepo(repo);
    }
  });

  it("INFRA-004: repli — source dans packages/schemas, test dans packages/database (autre workspace) → rejeté", () => {
    const repo = createTempRepo();
    try {
      // test is from a different workspace — should be rejected
      const result = runScript(repo, {
        "packages/schemas/src/user.ts":
          "export type User = { id: string };\n",
        "packages/database/src/other.test.ts":
          "// test in another workspace\n",
      });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("user.ts");
    } finally {
      removeTempRepo(repo);
    }
  });

  // ─── Critère 4: exemptions par glob ───────────────────────────────────────

  it("INFRA-004: fichier *.d.ts → accepté (exempté par glob)", () => {
    const repo = createTempRepo();
    try {
      const result = runScript(repo, {
        "packages/contracts/generated/types.d.ts":
          "export type Foo = string;\n",
      });
      expect(result.exitCode).toBe(0);
    } finally {
      removeTempRepo(repo);
    }
  });

  it("INFRA-004: fichier *.config.ts → accepté (exempté par glob)", () => {
    const repo = createTempRepo();
    try {
      const result = runScript(repo, {
        "apps/api/vitest.config.ts":
          'import { defineConfig } from "vitest/config"; export default defineConfig({});\n',
      });
      expect(result.exitCode).toBe(0);
    } finally {
      removeTempRepo(repo);
    }
  });

  it("INFRA-004: fichier dans packages/database/migrations/ → accepté (exempté par glob)", () => {
    const repo = createTempRepo();
    try {
      const result = runScript(repo, {
        "packages/database/migrations/0001_init.ts":
          "export const migration = {};\n",
      });
      expect(result.exitCode).toBe(0);
    } finally {
      removeTempRepo(repo);
    }
  });

  it("INFRA-004: fichier dans packages/contracts/generated/ → accepté (exempté par glob)", () => {
    const repo = createTempRepo();
    try {
      const result = runScript(repo, {
        "packages/contracts/generated/client.ts":
          "export const client = {};\n",
      });
      expect(result.exitCode).toBe(0);
    } finally {
      removeTempRepo(repo);
    }
  });

  // ─── Critère 5: barrel index.ts ───────────────────────────────────────────

  it("INFRA-004: barrel index.ts pur (only re-exports) → accepté", () => {
    const repo = createTempRepo();
    try {
      const result = runScript(repo, {
        "packages/schemas/src/index.ts": [
          "export * from './user.js';",
          "export { default as userSchema } from './schemas.js';",
          "export { UserSchema, CreateUserInput } from './create.js';",
        ].join("\n") + "\n",
      });
      expect(result.exitCode).toBe(0);
    } finally {
      removeTempRepo(repo);
    }
  });

  it("INFRA-004: index.ts avec logique (fonction) → rejeté", () => {
    const repo = createTempRepo();
    try {
      const result = runScript(repo, {
        "packages/schemas/src/index.ts": [
          "export * from './user.js';",
          "export function helper() { return 42; }",
        ].join("\n") + "\n",
      });
      expect(result.exitCode).toBe(1);
    } finally {
      removeTempRepo(repo);
    }
  });

  // ─── Critère 6: renommage ─────────────────────────────────────────────────

  it("INFRA-004: renommage R100 (pur) → accepté sans test", () => {
    const repo = createTempRepo();
    try {
      // Create original file and commit it
      const oldFile = "apps/api/src/old-service.ts";
      const newFile = "apps/api/src/new-service.ts";
      const content = "export const x = 1;\n";

      stageRename(repo, oldFile, newFile, content, 100);

      // Run the script
      const result = spawnSync("bash", [SCRIPT_PATH], {
        cwd: repo,
        env: {
          ...process.env,
          HOME: repo,
          GIT_DIR: path.join(repo, ".git"),
        },
      });

      expect(result.status ?? 1).toBe(0);
    } finally {
      removeTempRepo(repo);
    }
  });

  it("INFRA-004: renommage R<100 (partiel/modification) sans test → rejeté", () => {
    const repo = createTempRepo();
    try {
      // Create original file and commit it
      const oldFile = "apps/api/src/old-service.ts";
      const newFile = "apps/api/src/new-service.ts";

      stageRename(repo, oldFile, newFile, "export const y = 42;\n", 50);

      // Run the script
      const result = spawnSync("bash", [SCRIPT_PATH], {
        cwd: repo,
        env: {
          ...process.env,
          HOME: repo,
          GIT_DIR: path.join(repo, ".git"),
        },
      });

      expect(result.status ?? 0).toBe(1);
    } finally {
      removeTempRepo(repo);
    }
  });

  // ─── Critère 7: docs/ uniquement → accepté ────────────────────────────────

  it("INFRA-004: commit ne touchant que docs/ → accepté sans exigence de test", () => {
    const repo = createTempRepo();
    try {
      const result = runScript(repo, {
        "docs/prd/f0/story.md": "# Story\n\nThis is documentation.\n",
      });
      expect(result.exitCode).toBe(0);
    } finally {
      removeTempRepo(repo);
    }
  });

  // ─── Critère 8: commitlint ────────────────────────────────────────────────

  it("INFRA-004: lefthook.yml existe et contient un hook commit-msg avec commitlint", () => {
    expect(fs.existsSync(LEFTHOOK_YML_PATH)).toBe(true);
    const content = fs.readFileSync(LEFTHOOK_YML_PATH, "utf-8");
    expect(content).toContain("commit-msg");
    expect(content).toContain("commitlint");
  });

  it("INFRA-004: commitlint.config.mjs existe et étend @commitlint/config-conventional", () => {
    expect(fs.existsSync(COMMITLINT_CONFIG_PATH)).toBe(true);
    const content = fs.readFileSync(COMMITLINT_CONFIG_PATH, "utf-8");
    expect(content).toContain("config-conventional");
  });

  // ─── Critère 9: pnpm install → hooks lefthook installés ──────────────────

  it("INFRA-004: package.json racine contient script prepare avec lefthook install", () => {
    const pkgPath = path.resolve(
      __dirname,
      "../../../package.json"
    );
    expect(fs.existsSync(pkgPath)).toBe(true);
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as {
      scripts?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    expect(pkg.scripts?.prepare).toBeDefined();
    expect(pkg.scripts?.prepare).toContain("lefthook install");
    expect(pkg.devDependencies?.lefthook).toBeDefined();
    expect(pkg.devDependencies?.["@commitlint/cli"]).toBeDefined();
    expect(pkg.devDependencies?.["@commitlint/config-conventional"]).toBeDefined();
  });

  it("INFRA-004: test-exemptions.txt existe et contient les globs documentés", () => {
    expect(fs.existsSync(EXEMPTIONS_PATH)).toBe(true);
    const content = fs.readFileSync(EXEMPTIONS_PATH, "utf-8");
    // Should contain globs for common exemptions
    expect(content).toMatch(/migrations/);
    expect(content).toMatch(/generated/);
    expect(content).toMatch(/\.d\.ts/);
    expect(content).toMatch(/config/);
  });
});
