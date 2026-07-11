/**
 * CONTRACT-009c — Tests pour contract-diff + check-generated-sync (sous-lot 009c)
 * Critères 7–8 de la story CONTRACT-009.
 *
 * Critère 7 : breaking simulé → script exit ≠0 listant le breaking
 *             additif simulé → exit 0
 * Critère 8 : désync simulée (modifier un fichier generated/) → exit ≠0 message actionnable
 *             état propre → exit 0
 *
 * Note : SKIP_DOCKER_TESTS=1 skip les tests qui nécessitent Docker (contrat-diff oasdiff)
 * Les tests check-generated-sync sont purement git/shell et ne requièrent pas Docker.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  copyFileSync,
} from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const CONTRACTS_DIR = resolve(__dirname, "..");
const SCRIPTS_DIR = resolve(CONTRACTS_DIR, "scripts");

const CONTRACT_DIFF_SH = resolve(SCRIPTS_DIR, "contract-diff.sh");
const CHECK_GENERATED_SYNC_SH = resolve(SCRIPTS_DIR, "check-generated-sync.sh");

const SKIP_DOCKER = process.env["SKIP_DOCKER_TESTS"] === "1";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Crée un répertoire git temporaire isolé pour les tests.
 * Retourne le chemin du répertoire temporaire et une fonction de nettoyage.
 */
function createTempGitRepo(): { dir: string; cleanup: () => void } {
  const dir = resolve(tmpdir(), `sigfa-test-${randomBytes(8).toString("hex")}`);
  mkdirSync(dir, { recursive: true });

  // Initialiser un repo git minimal
  execSync("git init -b main", { cwd: dir, stdio: "pipe" });
  execSync('git config user.email "test@sigfa.local"', { cwd: dir, stdio: "pipe" });
  execSync('git config user.name "SIGFA Test"', { cwd: dir, stdio: "pipe" });

  return {
    dir,
    cleanup: () => {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // Ignoré
      }
    },
  };
}

/**
 * YAML OpenAPI minimal valide — utilisé comme base et variante dans les tests.
 */
const BASE_OPENAPI_YAML = `openapi: "3.1.0"
info:
  title: Test API
  version: "1.0.0"
paths:
  /tickets:
    get:
      operationId: listTickets
      summary: Liste des tickets
      responses:
        "200":
          description: OK
          content:
            application/json:
              schema:
                type: array
                items:
                  type: object
  /tickets/{id}:
    get:
      operationId: getTicket
      summary: Détail d'un ticket
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
      responses:
        "200":
          description: OK
`;

/**
 * YAML OpenAPI avec un endpoint supprimé (breaking change).
 * /tickets/{id} a été retiré → breaking change pour les consommateurs existants.
 */
const BREAKING_OPENAPI_YAML = `openapi: "3.1.0"
info:
  title: Test API
  version: "1.0.0"
paths:
  /tickets:
    get:
      operationId: listTickets
      summary: Liste des tickets
      responses:
        "200":
          description: OK
          content:
            application/json:
              schema:
                type: array
                items:
                  type: object
`;

/**
 * YAML OpenAPI avec un endpoint AJOUTÉ (additif — non-breaking).
 */
const ADDITIVE_OPENAPI_YAML = `openapi: "3.1.0"
info:
  title: Test API
  version: "1.0.0"
paths:
  /tickets:
    get:
      operationId: listTickets
      summary: Liste des tickets
      responses:
        "200":
          description: OK
          content:
            application/json:
              schema:
                type: array
                items:
                  type: object
  /tickets/{id}:
    get:
      operationId: getTicket
      summary: Détail d'un ticket
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
      responses:
        "200":
          description: OK
  /queues:
    get:
      operationId: listQueues
      summary: Liste des files (NOUVEAU endpoint additif)
      responses:
        "200":
          description: OK
`;

// ─── Suite 1 : contract-diff.sh existe ───────────────────────────────────────

describe("CONTRACT-009c: scripts contract-diff.sh et check-generated-sync.sh existent", () => {
  it("CONTRACT-009: contract-diff.sh existe et est exécutable", () => {
    expect(
      existsSync(CONTRACT_DIFF_SH),
      `contract-diff.sh manquant : ${CONTRACT_DIFF_SH}`
    ).toBe(true);

    // Vérifier que le fichier est exécutable
    const result = spawnSync("test", ["-x", CONTRACT_DIFF_SH], { stdio: "pipe" });
    expect(
      result.status,
      `contract-diff.sh n'est pas exécutable (chmod +x manquant)`
    ).toBe(0);
  });

  it("CONTRACT-009: check-generated-sync.sh existe et est exécutable", () => {
    expect(
      existsSync(CHECK_GENERATED_SYNC_SH),
      `check-generated-sync.sh manquant : ${CHECK_GENERATED_SYNC_SH}`
    ).toBe(true);

    const result = spawnSync("test", ["-x", CHECK_GENERATED_SYNC_SH], { stdio: "pipe" });
    expect(
      result.status,
      `check-generated-sync.sh n'est pas exécutable (chmod +x manquant)`
    ).toBe(0);
  });
});

// ─── Suite 2 : Critère 7 — contract-diff.sh (oasdiff) ───────────────────────

describe("CONTRACT-009c: critère 7 — contract-diff.sh (breaking vs additif)", () => {
  // Ces tests nécessitent Docker (oasdiff)
  // Skippés si SKIP_DOCKER_TESTS=1

  let tempRepo: { dir: string; cleanup: () => void } | null = null;

  beforeAll(() => {
    if (SKIP_DOCKER) return;
    tempRepo = createTempGitRepo();
  });

  afterAll(() => {
    if (tempRepo) tempRepo.cleanup();
  });

  it.skipIf(SKIP_DOCKER)(
    "CONTRACT-009: breaking simulé → contract-diff.sh exit ≠0 listant le breaking",
    () => {
      if (!tempRepo) return;
      const { dir } = tempRepo;

      // Créer le fichier openapi/ dans le repo temporaire
      mkdirSync(resolve(dir, "openapi"), { recursive: true });
      const yamlPath = resolve(dir, "openapi/test.yaml");

      // Commiter la version BASE sur main (origine)
      writeFileSync(yamlPath, BASE_OPENAPI_YAML);
      execSync("git add .", { cwd: dir, stdio: "pipe" });
      execSync('git commit -m "base: contrat initial"', { cwd: dir, stdio: "pipe" });

      // Créer une branche PR et y introduire un breaking change
      execSync("git checkout -b feature/breaking", { cwd: dir, stdio: "pipe" });
      writeFileSync(yamlPath, BREAKING_OPENAPI_YAML);
      execSync("git add .", { cwd: dir, stdio: "pipe" });
      execSync('git commit -m "breaking: suppression endpoint /tickets/{id}"', {
        cwd: dir,
        stdio: "pipe",
      });

      // Simuler origin/main en ajoutant main comme remote fictif
      execSync("git remote add origin .", { cwd: dir, stdio: "pipe" });
      execSync("git fetch origin main:refs/remotes/origin/main", { cwd: dir, stdio: "pipe" });

      // Exécuter contract-diff.sh sur le fichier modifié
      const result = spawnSync(
        "bash",
        [CONTRACT_DIFF_SH, "openapi/test.yaml"],
        {
          cwd: dir,
          stdio: "pipe",
          timeout: 60_000,
          env: {
            ...process.env,
            // Contournement macOS docker-credential-desktop
            DOCKER_CONFIG: (() => {
              const cfg = resolve(tmpdir(), "sigfa-docker-nocreds");
              mkdirSync(cfg, { recursive: true });
              writeFileSync(resolve(cfg, "config.json"), '{"auths":{}}');
              return cfg;
            })(),
          },
        }
      );

      const stdout = result.stdout?.toString() ?? "";
      const stderr = result.stderr?.toString() ?? "";
      const output = stdout + stderr;

      // Le script doit sortir avec un code ≠0
      expect(
        result.status,
        `contract-diff.sh devrait exit ≠0 pour un breaking change. stdout: ${stdout}, stderr: ${stderr}`
      ).not.toBe(0);

      // La sortie doit mentionner un breaking change
      expect(
        output.toLowerCase(),
        `La sortie devrait lister le breaking change. Output: ${output}`
      ).toMatch(/breaking|supprim|remov|deleted|endpoint/i);
    },
    60_000 // timeout Docker
  );

  it.skipIf(SKIP_DOCKER)(
    "CONTRACT-009: additif simulé → contract-diff.sh exit 0",
    () => {
      if (!tempRepo) return;

      // À ce stade, le repo a déjà le breaking test ci-dessus.
      // On crée un NOUVEAU repo temporaire pour ce test.
      const additiveRepo = createTempGitRepo();

      try {
        const aDir = additiveRepo.dir;
        mkdirSync(resolve(aDir, "openapi"), { recursive: true });
        const yamlPath = resolve(aDir, "openapi/test.yaml");

        // Commiter la version BASE sur main
        writeFileSync(yamlPath, BASE_OPENAPI_YAML);
        execSync("git add .", { cwd: aDir, stdio: "pipe" });
        execSync('git commit -m "base: contrat initial"', { cwd: aDir, stdio: "pipe" });

        // Créer une branche PR et y introduire un changement ADDITIF
        execSync("git checkout -b feature/additive", { cwd: aDir, stdio: "pipe" });
        writeFileSync(yamlPath, ADDITIVE_OPENAPI_YAML);
        execSync("git add .", { cwd: aDir, stdio: "pipe" });
        execSync('git commit -m "additif: ajout endpoint /queues"', {
          cwd: aDir,
          stdio: "pipe",
        });

        // Simuler origin/main
        execSync("git remote add origin .", { cwd: aDir, stdio: "pipe" });
        execSync("git fetch origin main:refs/remotes/origin/main", { cwd: aDir, stdio: "pipe" });

        // Exécuter contract-diff.sh sur le fichier modifié
        const result = spawnSync(
          "bash",
          [CONTRACT_DIFF_SH, "openapi/test.yaml"],
          {
            cwd: aDir,
            stdio: "pipe",
            timeout: 60_000,
            env: {
              ...process.env,
              DOCKER_CONFIG: (() => {
                const cfg = resolve(tmpdir(), "sigfa-docker-nocreds");
                mkdirSync(cfg, { recursive: true });
                writeFileSync(resolve(cfg, "config.json"), '{"auths":{}}');
                return cfg;
              })(),
            },
          }
        );

        const stdout = result.stdout?.toString() ?? "";
        const stderr = result.stderr?.toString() ?? "";

        // Le script doit sortir avec exit 0 (additif uniquement)
        expect(
          result.status,
          `contract-diff.sh devrait exit 0 pour un changement additif. stdout: ${stdout}, stderr: ${stderr}`
        ).toBe(0);
      } finally {
        additiveRepo.cleanup();
      }
    },
    60_000 // timeout Docker
  );

  it.skipIf(SKIP_DOCKER)(
    "CONTRACT-009: fichier NOUVEAU (pas de base sur origin/main) → exit 0 (additif par définition)",
    () => {
      const newFileRepo = createTempGitRepo();

      try {
        const nDir = newFileRepo.dir;
        mkdirSync(resolve(nDir, "openapi"), { recursive: true });
        const yamlPath = resolve(nDir, "openapi/new-module.yaml");

        // Commiter un fichier différent sur main (pas new-module.yaml)
        writeFileSync(resolve(nDir, "openapi/core.yaml"), BASE_OPENAPI_YAML);
        execSync("git add .", { cwd: nDir, stdio: "pipe" });
        execSync('git commit -m "base: core.yaml"', { cwd: nDir, stdio: "pipe" });

        // PR avec un NOUVEAU fichier (pas sur main)
        execSync("git checkout -b feature/new-module", { cwd: nDir, stdio: "pipe" });
        writeFileSync(yamlPath, BASE_OPENAPI_YAML);
        execSync("git add .", { cwd: nDir, stdio: "pipe" });
        execSync('git commit -m "new-module: premier fichier"', { cwd: nDir, stdio: "pipe" });

        execSync("git remote add origin .", { cwd: nDir, stdio: "pipe" });
        execSync("git fetch origin main:refs/remotes/origin/main", { cwd: nDir, stdio: "pipe" });

        const result = spawnSync(
          "bash",
          [CONTRACT_DIFF_SH, "openapi/new-module.yaml"],
          {
            cwd: nDir,
            stdio: "pipe",
            timeout: 30_000,
            env: {
              ...process.env,
              DOCKER_CONFIG: (() => {
                const cfg = resolve(tmpdir(), "sigfa-docker-nocreds");
                mkdirSync(cfg, { recursive: true });
                writeFileSync(resolve(cfg, "config.json"), '{"auths":{}}');
                return cfg;
              })(),
            },
          }
        );

        const stdout = result.stdout?.toString() ?? "";
        const stderr = result.stderr?.toString() ?? "";

        expect(
          result.status,
          `contract-diff.sh devrait exit 0 pour un fichier nouveau (pas de base). stdout: ${stdout}, stderr: ${stderr}`
        ).toBe(0);
      } finally {
        newFileRepo.cleanup();
      }
    },
    30_000 // timeout Docker
  );
});

// ─── Suite 3 : Critère 8 — check-generated-sync.sh ──────────────────────────

describe("CONTRACT-009c: critère 8 — check-generated-sync.sh (désynchronisation generated/)", () => {
  /**
   * Ces tests utilisent un repo git temporaire isolé pour simuler la désync.
   *
   * Logique du script check-generated-sync.sh :
   *   1. Relancer generate (régénère les fichiers dans generated/)
   *   2. git diff --exit-code -- generated/
   *      → compare working tree vs index (ce qui est staged/commité)
   *
   * Pour tester la désync : on commite un fichier generated/ avec un contenu
   * INCORRECT (stale), puis on relance le script. generate va produire le
   * contenu correct, et git diff détecte l'écart avec ce qui était commité.
   *
   * Pour tester l'état propre : on commite le contenu correct, generate produit
   * le même résultat → git diff = 0.
   */

  it("CONTRACT-009: état propre → check-generated-sync.sh exit 0", () => {
    // Dans le repo courant, les generated/ sont supposés être synchronisés.
    // Si le script est appelé dans le repo réel avec un état propre, exit 0.
    const result = spawnSync("bash", [CHECK_GENERATED_SYNC_SH], {
      cwd: CONTRACTS_DIR,
      stdio: "pipe",
      timeout: 300_000, // generate peut prendre du temps
      env: {
        ...process.env,
        DOCKER_CONFIG: (() => {
          const cfg = resolve(tmpdir(), "sigfa-docker-nocreds");
          mkdirSync(cfg, { recursive: true });
          writeFileSync(resolve(cfg, "config.json"), '{"auths":{}}');
          return cfg;
        })(),
      },
    });

    const stdout = result.stdout?.toString() ?? "";
    const stderr = result.stderr?.toString() ?? "";

    expect(
      result.status,
      `check-generated-sync.sh devrait exit 0 sur un état propre. stdout: ${stdout}, stderr: ${stderr}`
    ).toBe(0);
  }, 300_000);

  it("CONTRACT-009: désync simulée → check-generated-sync.sh exit ≠0 message actionnable", () => {
    /**
     * Stratégie : créer un repo git temporaire avec :
     *   - Les sources openapi/*.yaml (copiées depuis le repo réel)
     *   - Un fichier generated/types/core.ts avec un contenu INCORRECT (désynchronisé)
     *   - Les scripts bundle.mjs, generate.mjs (copiés)
     *   - Le tout commité → simulate "generated stale committés"
     *
     * Puis on appelle check-generated-sync.sh dans ce repo temporaire.
     * generate va produire le contenu correct → git diff détecte l'écart.
     */
    const desyncRepo = createTempGitRepo();

    try {
      const dDir = desyncRepo.dir;

      // Copier les sources nécessaires
      const OPENAPI_SRC = resolve(CONTRACTS_DIR, "openapi");
      const SCRIPTS_SRC = resolve(CONTRACTS_DIR, "scripts");
      const GENERATED_SRC = resolve(CONTRACTS_DIR, "generated");
      const PKG_SRC = CONTRACTS_DIR;

      // Créer la structure du repo temporaire
      mkdirSync(resolve(dDir, "openapi"), { recursive: true });
      mkdirSync(resolve(dDir, "scripts"), { recursive: true });
      mkdirSync(resolve(dDir, "generated/types"), { recursive: true });
      mkdirSync(resolve(dDir, "generated/bundled"), { recursive: true });
      mkdirSync(resolve(dDir, "node_modules/.bin"), { recursive: true });

      // Copier les fichiers YAML sources
      const openapiFiles = ["core", "public", "agents", "admin", "reporting", "notifications", "ai"];
      for (const m of openapiFiles) {
        const src = resolve(OPENAPI_SRC, `${m}.yaml`);
        if (existsSync(src)) {
          copyFileSync(src, resolve(dDir, `openapi/${m}.yaml`));
        }
      }

      // Copier les configs (redocly, spectral)
      for (const cfg of [".redocly.yaml", ".spectral.yaml"]) {
        const src = resolve(PKG_SRC, cfg);
        if (existsSync(src)) {
          copyFileSync(src, resolve(dDir, cfg));
        }
      }

      // Copier les scripts
      for (const sc of ["bundle.mjs", "generate.mjs"]) {
        const src = resolve(SCRIPTS_SRC, sc);
        if (existsSync(src)) {
          copyFileSync(src, resolve(dDir, `scripts/${sc}`));
        }
      }

      // Symlinker node_modules depuis le repo réel (pour ne pas réinstaller)
      const NODE_MODULES_SRC = resolve(PKG_SRC, "node_modules");
      if (existsSync(NODE_MODULES_SRC)) {
        // Supprimer le répertoire vide et créer un lien symbolique
        rmSync(resolve(dDir, "node_modules"), { recursive: true, force: true });
        execSync(`ln -s "${NODE_MODULES_SRC}" "${dDir}/node_modules"`, { stdio: "pipe" });
      }

      // Copier le package.json (nécessaire pour que pnpm filter fonctionne)
      const pkgJsonSrc = resolve(PKG_SRC, "package.json");
      if (existsSync(pkgJsonSrc)) {
        copyFileSync(pkgJsonSrc, resolve(dDir, "package.json"));
      }

      // Copier le tsconfig.json
      const tsconfigSrc = resolve(PKG_SRC, "tsconfig.json");
      if (existsSync(tsconfigSrc)) {
        copyFileSync(tsconfigSrc, resolve(dDir, "tsconfig.json"));
      }

      // Générer les fichiers bundled corrects d'abord (pour que generate puisse tourner)
      const bundledFiles = openapiFiles;
      for (const m of bundledFiles) {
        const src = resolve(GENERATED_SRC, `bundled/${m}.yaml`);
        if (existsSync(src)) {
          copyFileSync(src, resolve(dDir, `generated/bundled/${m}.yaml`));
        }
      }

      // Copier les types générés CORRECTS
      for (const m of openapiFiles) {
        const src = resolve(GENERATED_SRC, `types/${m}.ts`);
        if (existsSync(src)) {
          copyFileSync(src, resolve(dDir, `generated/types/${m}.ts`));
        }
      }

      // Commiter l'état "propre" initial
      execSync("git add .", { cwd: dDir, stdio: "pipe" });
      execSync('git commit -m "initial: generated synchronisé"', { cwd: dDir, stdio: "pipe" });

      // Maintenant introduire la DÉSYNC : modifier un fichier generated/ et le commiter
      const desyncFile = resolve(dDir, "generated/types/core.ts");
      if (existsSync(desyncFile)) {
        const originalContent = readFileSync(desyncFile, "utf-8");
        // Ajouter un commentaire stale qui ne serait jamais généré
        const staleContent = originalContent + "\n// STALE — contenu désynchronisé commité sans régénérer\nexport const _STALE_MARKER = true;\n";
        writeFileSync(desyncFile, staleContent, "utf-8");
      } else {
        // Créer un fichier factice si core.ts n'existe pas
        writeFileSync(desyncFile, "// DESYNC SIMULEE\nexport const _STALE = true;\n", "utf-8");
      }

      // Commiter les fichiers désynchronisés
      execSync("git add .", { cwd: dDir, stdio: "pipe" });
      execSync('git commit -m "STALE: generated désynchronisé (simulation CI)"', { cwd: dDir, stdio: "pipe" });

      // Appeler check-generated-sync.sh dans ce repo temporaire
      // Le script va : (1) relancer generate → overwrite generated/types/core.ts
      //               (2) git diff → détecte l'écart avec ce qui est commité (stale)
      const result = spawnSync("bash", [CHECK_GENERATED_SYNC_SH], {
        cwd: dDir,
        stdio: "pipe",
        timeout: 300_000,
        env: {
          ...process.env,
          CONTRACTS_DIR: dDir, // Pointer le script vers le repo temporaire
          DOCKER_CONFIG: (() => {
            const cfg = resolve(tmpdir(), "sigfa-docker-nocreds");
            mkdirSync(cfg, { recursive: true });
            writeFileSync(resolve(cfg, "config.json"), '{"auths":{}}');
            return cfg;
          })(),
        },
      });

      const stdout = result.stdout?.toString() ?? "";
      const stderr = result.stderr?.toString() ?? "";
      const output = stdout + stderr;

      // Le script doit sortir avec un code ≠0
      expect(
        result.status,
        `check-generated-sync.sh devrait exit ≠0 pour une désynchronisation. stdout: ${stdout}, stderr: ${stderr}`
      ).not.toBe(0);

      // La sortie doit contenir un message actionnable
      expect(
        output,
        `La sortie devrait contenir un message actionnable. Output: ${output}`
      ).toMatch(/désynchronis|desynchronis|generate|relancez|out.of.sync/i);
    } finally {
      desyncRepo.cleanup();
    }
  }, 300_000);
});
