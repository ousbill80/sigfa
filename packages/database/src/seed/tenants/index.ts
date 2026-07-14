/**
 * Registre des configs de tenants de seed.
 *
 * Chaque tenant seedable est décrit par un fichier de config dédié dans ce
 * dossier et enregistré ici sous son slug de sélection (`SEED_TENANTS=slug1,slug2`).
 * Aucune donnée de tenant en dur ailleurs que dans ces fichiers de config.
 *
 * @module
 */

import type { TenantSeedConfig } from "src/seed/tenant-seed.js";
import { DEMO_TENANT } from "./demo.js";
import { BICICI_TENANT } from "./bicici.js";

/**
 * Registre slug → config. `demo` est la cible de la rétro-compat `SEED_DEMO=1`.
 */
export const TENANT_SEED_CONFIGS: Readonly<Record<string, TenantSeedConfig>> = {
  demo: DEMO_TENANT,
  bicici: BICICI_TENANT,
};

export { DEMO_TENANT } from "./demo.js";
export { BICICI_TENANT } from "./bicici.js";
