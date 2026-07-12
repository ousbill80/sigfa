/**
 * Lanceur du serveur API réel (RT-003).
 *
 * Enregistre le hook de résolution `src/*` puis importe et APPELLE
 * explicitement `startServer()` du serveur compilé. On n'utilise PAS le
 * garde `argv[1] === import.meta.url` de `index.js` : sur un chemin contenant
 * des espaces (macOS), `import.meta.url` est URL-encodé (`%20`) alors que
 * `argv[1]` ne l'est pas → le garde ne déclenche jamais. L'appel explicite
 * contourne ce piège.
 *
 * @module e2e/support/api-launcher
 */
import { register } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

register("./src-resolver.mjs", import.meta.url);

const HERE = dirname(fileURLToPath(import.meta.url));
const API_INDEX = join(HERE, "..", "..", "..", "..", "apps", "api", "dist", "index.js");

const mod = await import(pathToFileURL(API_INDEX).href);
await mod.startServer();
