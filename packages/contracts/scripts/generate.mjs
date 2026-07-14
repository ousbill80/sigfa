#!/usr/bin/env node
/**
 * scripts/generate.mjs — CONTRACT-009a
 * Génère les types TypeScript par module depuis les bundles YAML.
 * Utilise openapi-typescript@^7 sur les fichiers generated/bundled/<module>.yaml.
 *
 * Usage : node scripts/generate.mjs
 * Prérequis : exécuter bundle.mjs d'abord.
 *
 * Stratégie : on appelle openapi-typescript en passant le fichier bundlé directement
 * et en spécifiant --redocly vers un fichier de config minimal pour éviter
 * l'auto-découverte du .redocly.yaml racine (qui déclenche le mode multi-API).
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, existsSync, writeFileSync, unlinkSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ROOT = resolve(__dirname, "..");
const BUNDLED_DIR = resolve(ROOT, "generated/bundled");
const TYPES_DIR = resolve(ROOT, "generated/types");
const OTS_BIN = resolve(ROOT, "node_modules/.bin/openapi-typescript");

// Créer les répertoires de sortie si nécessaire
mkdirSync(TYPES_DIR, { recursive: true });

const MODULES = ["core", "public", "agents", "admin", "reporting", "notifications", "ai"];

// Créer un fichier de config temporaire vide pour éviter l'auto-découverte
// de .redocly.yaml qui déclenche le mode multi-API (incompatible avec --output)
const tmpConfigPath = resolve(tmpdir(), `sigfa-ots-${randomBytes(8).toString("hex")}.yaml`);
writeFileSync(tmpConfigPath, "# openapi-typescript: config vide pour mode single-file\n");

let hasError = false;

try {
  for (const module of MODULES) {
    const inputPath = resolve(BUNDLED_DIR, `${module}.yaml`);
    const outputPath = resolve(TYPES_DIR, `${module}.ts`);

    if (!existsSync(inputPath)) {
      console.error(`[ERREUR] Bundle manquant : generated/bundled/${module}.yaml — lancez 'bundle' d'abord`);
      hasError = true;
      continue;
    }

    try {
      execFileSync(
        OTS_BIN,
        [
          inputPath,
          "--output",
          outputPath,
          "--redocly",
          tmpConfigPath,
        ],
        {
          cwd: ROOT,
          stdio: "pipe",
          env: {
            ...process.env,
            // Assure le déterminisme : pas de timestamp dans la génération
            SOURCE_DATE_EPOCH: "0",
            TZ: "UTC",
          },
        }
      );
      console.log(`[OK] types ${module} → generated/types/${module}.ts`);
    } catch (err) {
      console.error(`[ERREUR] Erreur lors de la génération des types de ${module}:`);
      if (err.stdout) console.error(err.stdout.toString());
      if (err.stderr) console.error(err.stderr.toString());
      hasError = true;
    }
  }
} finally {
  // Nettoyage du fichier temporaire
  try { unlinkSync(tmpConfigPath); } catch { /* ignoré */ }
}

if (hasError) {
  process.exit(1);
} else {
  console.log(`\n[OK] Génération terminée : ${MODULES.length} modules → generated/types/`);
}
