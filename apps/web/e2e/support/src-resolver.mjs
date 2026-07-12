/**
 * Hook de résolution ESM (RT-003) — mappe les specifiers `src/*` du serveur API
 * réel (`@sigfa/api`) vers son répertoire `dist/`.
 *
 * L'API compile ses imports en specifiers nus `src/app.js` (alias TS résolu par
 * vitest en test, jamais réécrit à l'émission NodeNext). Pour lancer le SERVEUR
 * RÉEL en sous-processus (E2E), on enregistre ce hook via `node --import` : tout
 * `src/…` est réécrit en `file://…/apps/api/dist/…`.
 *
 * @module e2e/support/src-resolver
 */
import { pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Racine de compilation du serveur API réel. */
const API_DIST = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
  "apps",
  "api",
  "dist"
);

/**
 * Résout un specifier ESM. Réécrit `src/*` vers `apps/api/dist/*`.
 * @param {string} specifier - Specifier importé.
 * @param {object} context - Contexte de résolution Node.
 * @param {Function} next - Résolveur suivant dans la chaîne.
 */
export async function resolve(specifier, context, next) {
  if (specifier === "src" || specifier.startsWith("src/")) {
    const rel = specifier === "src" ? "index.js" : specifier.slice("src/".length);
    return {
      url: pathToFileURL(join(API_DIST, rel)).href,
      shortCircuit: true,
    };
  }
  return next(specifier, context);
}
