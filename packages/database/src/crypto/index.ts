/**
 * Barrel du module crypto DB-008 : chiffrement AES-256-GCM + HMAC des téléphones
 * et purge « droit à l'oubli ».
 *
 * @module
 */
export {
  encryptPhone,
  decryptPhone,
  hashPhone,
  normalizePhone,
  InvalidPhoneError,
} from "./phone-cipher.js";

export {
  purgeExpiredPhones,
  purgePhone,
} from "./purge.js";

export type {
  PurgeOptions,
  PurgeExpiredResult,
  PurgePhoneResult,
} from "./purge.js";
