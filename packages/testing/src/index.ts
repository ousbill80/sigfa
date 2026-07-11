/** Version du package @sigfa/testing */
export const testingVersion = "0.0.0";

// Re-exporte les harnesses des 5 suites critiques
export * from "./tenant-isolation/index.js";
export * from "./realtime-guarantees/index.js";
export * from "./sla-engine/index.js";
export * from "./offline-resilience/index.js";
export * from "./contract/index.js";
