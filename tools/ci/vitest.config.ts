import { defineConfig } from "vitest/config";
import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Crée un répertoire DOCKER_CONFIG temporaire sans credsStore pour éviter
 * l'erreur "docker-credential-desktop not found" sur macOS Docker Desktop.
 * @returns Chemin vers le répertoire de configuration Docker temporaire
 */
function createDockerConfig(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sigfa-docker-config-"));
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({ auths: {}, currentContext: "desktop-linux" })
  );
  return dir;
}

export default defineConfig({
  test: {
    env: {
      // Contourne docker-credential-desktop absent sur les machines de dev
      DOCKER_CONFIG: createDockerConfig(),
    },
    coverage: {
      provider: "v8",
      reporter: ["json"],
      reportsDirectory: "./coverage",
    },
  },
});
