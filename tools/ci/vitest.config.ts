import { defineConfig } from "vitest/config";
import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Crée un répertoire DOCKER_CONFIG temporaire sans credsStore ni currentContext
 * pour contourner l'erreur "docker-credential-desktop not found" sur macOS
 * Docker Desktop, tout en conservant un accès complet aux plugins CLI.
 *
 * Problèmes résolus :
 * - `credsStore: "desktop"` : supprimé — évite l'erreur docker-credential-desktop
 *   absent du PATH sous vitest (Testcontainers, INFRA-003).
 * - `currentContext: "desktop-linux"` : supprimé — un contexte déclaré sans le
 *   répertoire `contexts/` correspondant empêche le CLI de résoudre l'endpoint
 *   du daemon, cassant tous les appels `docker compose …` (INFRA-002).
 * - Plugins CLI (compose, buildx…) : lorsque DOCKER_CONFIG pointe vers un
 *   répertoire temporaire vide, le CLI ne trouve plus les plugins depuis
 *   `~/.docker/cli-plugins/`. On crée donc un lien symbolique
 *   `cli-plugins/docker-compose` vers le plugin installé par Docker Desktop,
 *   ce qui rétablit `docker compose` pour les tests INFRA-002.
 *
 * @returns Chemin vers le répertoire de configuration Docker temporaire
 */
function createDockerConfig(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sigfa-docker-config-"));

  // Config minimale : pas de credsStore, pas de currentContext
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({ auths: {} })
  );

  // Réexposer le plugin compose depuis ~/.docker/cli-plugins/docker-compose
  // afin que `docker compose …` reste disponible sous vitest.
  const pluginsDir = path.join(dir, "cli-plugins");
  fs.mkdirSync(pluginsDir);
  const userCompose = path.join(
    os.homedir(),
    ".docker",
    "cli-plugins",
    "docker-compose"
  );
  if (fs.existsSync(userCompose)) {
    fs.symlinkSync(userCompose, path.join(pluginsDir, "docker-compose"));
  }

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
