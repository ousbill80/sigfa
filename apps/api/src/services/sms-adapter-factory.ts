/**
 * sms-adapter-factory — sélection de l'adaptateur SMS par configuration (SMS-SMPP).
 *
 * LA LOI (SMS-SMPP) :
 *  - `createSmsAdapter(config)` retourne le VRAI `SmppSmsAdapter` UNIQUEMENT si
 *    `provider=smpp` ET la config SMPP est complète (`config.smpp !== null`) ;
 *    sinon il retombe sur le MOCK NOTIF-002 (défaut dev/CI, zéro réseau).
 *  - L'instanciation ne CONNECTE PAS (session lazy) : le bind n'a lieu qu'au
 *    premier `send`. La factory est donc sans effet réseau.
 *
 * @module
 */

import type { SmsConfig } from "src/config/sms.js";
import { createMockSmsAdapter, type SmsAdapter } from "src/services/sms-adapter.js";
import {
  SmppSmsAdapter,
  type SmppDeps,
} from "src/services/smpp-sms-adapter.js";

/**
 * Construit l'adaptateur SMS selon la config résolue. MOCK par défaut ; SMPP réel
 * seulement si demandé ET configuré (gating fort — jamais de bind incomplet).
 *
 * @param config - Config SMS résolue (`getSmsConfig()`)
 * @param deps   - Dépendances injectables du SMPP (session/hook DLR) — pour tests
 * @returns Un `SmsAdapter` conforme (mock ou SMPP)
 */
export function createSmsAdapter(
  config: SmsConfig,
  deps: SmppDeps = {}
): SmsAdapter {
  if (config.provider === "smpp" && config.smpp !== null) {
    return new SmppSmsAdapter(config.smpp, deps);
  }
  // Défaut sûr : MOCK (aucun secret, aucun réseau).
  return createMockSmsAdapter();
}
