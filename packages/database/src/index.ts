/** Version du package @sigfa/database. */
export const DATABASE_VERSION = "0.0.0";

export * from "./schema/index.js";
export * from "./tenant.js";
export * from "./audit/index.js";
export * from "./crypto/index.js";
export { purgeAiHistory } from "./ai/index.js";
export type { PurgeAiOptions, PurgeAiHistoryResult } from "./ai/index.js";
