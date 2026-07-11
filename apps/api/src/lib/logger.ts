/**
 * Logger Pino structuré SIGFA.
 * `console.log` est interdit — utiliser ce module.
 *
 * @module
 */

import pino from "pino";

/** Logger Pino global — logs structurés JSON */
export const logger = pino({
  name: "sigfa-api",
  level: process.env["LOG_LEVEL"] ?? "info",
});
