/**
 * INFRA-007: Tests d'exécution réelle de commitlint (INFRA-004 critère 8 exécution)
 *
 * Vérifie que commitlint s'exécute réellement et rejette/accepte des messages
 * conformément à la configuration @commitlint/config-conventional.
 *
 * TDD : ces tests sont écrits AVANT la configuration du worktree
 * (RED first, puis GREEN après vérification que commitlint est disponible).
 *
 * Naming convention: "INFRA-007: <description>" pour traçabilité T3.
 */

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Résolution des chemins en tenant compte des espaces dans le chemin
const REPO_ROOT = path.resolve(__dirname, "../../../");
const COMMITLINT_CONFIG = path.resolve(REPO_ROOT, "commitlint.config.mjs");
const COMMITLINT_BIN = path.resolve(REPO_ROOT, "node_modules/.bin/commitlint");

/**
 * Exécute commitlint --from=HEAD~1 --to=HEAD sur un message de commit donné.
 * Utilise un fichier temporaire pour simuler COMMIT_EDITMSG.
 * @param message - Message de commit à valider
 * @returns Résultat de l'exécution (exitCode, stdout, stderr)
 */
function runCommitlint(message: string): { exitCode: number; stdout: string; stderr: string } {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sigfa-commitlint-"));
  const msgFile = path.join(tmpDir, "COMMIT_EDITMSG");

  try {
    fs.writeFileSync(msgFile, message, "utf-8");

    const result = spawnSync(
      COMMITLINT_BIN,
      ["--edit", msgFile, "--config", COMMITLINT_CONFIG],
      {
        cwd: REPO_ROOT,
        encoding: "utf-8",
        env: { ...process.env },
      }
    );

    return {
      exitCode: result.status ?? 1,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    };
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // best effort
    }
  }
}

describe("INFRA-007: commitlint exécution réelle", () => {
  it("INFRA-007: commitlint binaire est accessible dans node_modules/.bin", () => {
    expect(fs.existsSync(COMMITLINT_BIN), `commitlint not found at ${COMMITLINT_BIN}`).toBe(true);
  });

  it("INFRA-007: commitlint.config.mjs existe à la racine du monorepo", () => {
    expect(fs.existsSync(COMMITLINT_CONFIG), `config not found at ${COMMITLINT_CONFIG}`).toBe(true);
  });

  it("INFRA-007: message 'wip' → commitlint exit ≠ 0 (rejeté)", () => {
    const result = runCommitlint("wip");
    expect(
      result.exitCode,
      `stdout: ${result.stdout}\nstderr: ${result.stderr}`
    ).not.toBe(0);
  });

  it("INFRA-007: message 'feat(api): émission ticket' → commitlint exit 0 (accepté)", () => {
    const result = runCommitlint("feat(api): émission ticket");
    expect(
      result.exitCode,
      `stdout: ${result.stdout}\nstderr: ${result.stderr}`
    ).toBe(0);
  });
});
