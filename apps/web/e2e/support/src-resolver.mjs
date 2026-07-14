/**
 * Hook de résolution ESM (RT-003) — mappe les specifiers `src/*` du serveur API
 * réel (`@sigfa/api`) vers son répertoire `dist/`.
 *
 * L'API compile ses imports en specifiers nus `src/app.js` (alias TS résolu par
 * vitest en test, jamais réécrit à l'émission NodeNext). Pour lancer le SERVEUR
 * RÉEL en sous-processus (E2E), on enregistre ce hook via `node --import` : tout
 * `src/…` est réécrit en `file://…/apps/api/dist/…`.
 *
 * De plus, `@sigfa/contracts` n'expose (`exports`) que son point d'entrée `.` ;
 * l'API importe cependant le sous-chemin compilé `@sigfa/contracts/events/*`
 * (types d'événements socket). Sous Node NodeNext, ce sous-chemin est bloqué par
 * la map `exports` restrictive (`ERR_PACKAGE_PATH_NOT_EXPORTED`) alors que le
 * fichier compilé existe bien dans `packages/contracts/dist/events/`. Ce hook —
 * strictement support de test — redirige ce sous-chemin vers le `dist/` du
 * package pour permettre le lancement du serveur réel en sous-processus, sans
 * modifier l'emballage du package produit.
 *
 * @module e2e/support/src-resolver
 */
import { pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Racine du support E2E (apps/web/e2e/support). */
const HERE = dirname(fileURLToPath(import.meta.url));

/** Racine de compilation du serveur API réel. */
const API_DIST = join(HERE, "..", "..", "..", "..", "apps", "api", "dist");

/** Racine de compilation du package contrats (dist). */
const CONTRACTS_DIST = join(HERE, "..", "..", "..", "..", "packages", "contracts", "dist");

/** Préfixe des sous-chemins contrats non exposés par la map `exports`. */
const CONTRACTS_SUBPATH = "@sigfa/contracts/";

/**
 * Résout un specifier ESM. Réécrit `src/*` vers `apps/api/dist/*` et les
 * sous-chemins compilés `@sigfa/contracts/*` (non exposés par `exports`) vers
 * `packages/contracts/dist/*`.
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
  // `@sigfa/contracts/events/realtime.js` → packages/contracts/dist/events/realtime.js
  if (specifier.startsWith(CONTRACTS_SUBPATH) && specifier !== "@sigfa/contracts") {
    const rel = specifier.slice(CONTRACTS_SUBPATH.length);
    return {
      url: pathToFileURL(join(CONTRACTS_DIST, rel)).href,
      shortCircuit: true,
    };
  }
  return next(specifier, context);
}
