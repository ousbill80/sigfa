#!/usr/bin/env node
/**
 * scripts/bundle.mjs — CONTRACT-009a
 * Produit un YAML bundlé par module dans generated/bundled/<module>.yaml.
 * Résout tous les $ref inter-fichiers via @redocly/cli.
 *
 * Usage : node scripts/bundle.mjs
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ROOT = resolve(__dirname, "..");
const BUNDLED_DIR = resolve(ROOT, "generated/bundled");
const REDOCLY_BIN = resolve(ROOT, "node_modules/.bin/redocly");

// Créer le répertoire de sortie si nécessaire
mkdirSync(BUNDLED_DIR, { recursive: true });

const MODULES = ["core", "public", "agents", "admin", "reporting", "notifications", "ai"];

let hasError = false;

for (const module of MODULES) {
  const inputPath = resolve(ROOT, `openapi/${module}.yaml`);
  const outputPath = resolve(BUNDLED_DIR, `${module}.yaml`);

  if (!existsSync(inputPath)) {
    console.error(`[ERREUR] Fichier source manquant : openapi/${module}.yaml`);
    hasError = true;
    continue;
  }

  try {
    execFileSync(
      REDOCLY_BIN,
      [
        "bundle",
        inputPath,
        "--output",
        outputPath,
        "--config",
        resolve(ROOT, ".redocly.yaml"),
      ],
      {
        cwd: ROOT,
        stdio: "pipe",
        env: {
          ...process.env,
          // Désactiver l'update-check pour éviter toute sortie variable
          REDOCLY_TELEMETRY: "off",
          // Supprimer les variables de date/heure qui pourraient être injectées
          SOURCE_DATE_EPOCH: "0",
        },
      }
    );
    console.log(`[OK] bundle ${module} → generated/bundled/${module}.yaml`);
  } catch (err) {
    console.error(`[ERREUR] Erreur lors du bundle de ${module}:`);
    if (err.stdout) console.error(err.stdout.toString());
    if (err.stderr) console.error(err.stderr.toString());
    hasError = true;
  }
}

if (hasError) {
  process.exit(1);
} else {
  console.log(`\n[OK] Bundle terminé : ${MODULES.length} modules → generated/bundled/`);
}
