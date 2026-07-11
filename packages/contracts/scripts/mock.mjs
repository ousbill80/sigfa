#!/usr/bin/env node
/**
 * scripts/mock.mjs — CONTRACT-009b
 * Démarre une instance Prism par module sur les bundles YAML générés.
 * Ports fixes lus depuis l'environnement (défauts documentés dans .env.example).
 *
 * Usage : pnpm --filter @sigfa/contracts mock
 *         pnpm --filter @sigfa/contracts mock:stop  (pkill -f 'prism mock')
 */

import { spawn } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ROOT = resolve(__dirname, "..");
const BUNDLED_DIR = resolve(ROOT, "generated/bundled");
const PRISM_BIN = resolve(ROOT, "node_modules/.bin/prism");
const PID_DIR = resolve(ROOT, ".prism-pids");

/**
 * Hôte d'écoute Prism — par défaut 127.0.0.1 pour ne pas exposer le mock sur le LAN des
 * postes dev. Peut être surchargé via PRISM_HOST=0.0.0.0 dans les contextes où Prism doit
 * être joignable depuis un conteneur Docker (ex. CI Schemathesis sur Linux).
 * Note : dans le test Schemathesis (mock-prism.test.ts), PRISM_HOST est forcé à 0.0.0.0 car
 * host.docker.internal = IP du bridge Docker sur Linux CI, pas 127.0.0.1.
 */
const PRISM_HOST = process.env.PRISM_HOST ?? "127.0.0.1";

/** Ports par défaut — documentés dans .env.example */
const MODULE_PORTS = {
  core: Number(process.env.MOCK_CORE_PORT ?? 4010),
  public: Number(process.env.MOCK_PUBLIC_PORT ?? 4011),
  agents: Number(process.env.MOCK_AGENTS_PORT ?? 4012),
  admin: Number(process.env.MOCK_ADMIN_PORT ?? 4013),
  reporting: Number(process.env.MOCK_REPORTING_PORT ?? 4014),
  notifications: Number(process.env.MOCK_NOTIFICATIONS_PORT ?? 4015),
  ai: Number(process.env.MOCK_AI_PORT ?? 4016),
};

if (!existsSync(PRISM_BIN)) {
  console.error(`❌ Prism CLI introuvable : ${PRISM_BIN}`);
  console.error("   Lancez 'pnpm install' d'abord.");
  process.exit(1);
}

mkdirSync(PID_DIR, { recursive: true });

const processes = [];

for (const [module, port] of Object.entries(MODULE_PORTS)) {
  const bundlePath = resolve(BUNDLED_DIR, `${module}.yaml`);

  if (!existsSync(bundlePath)) {
    console.error(`❌ Bundle manquant : ${bundlePath}`);
    console.error("   Lancez 'pnpm --filter @sigfa/contracts bundle' d'abord.");
    process.exit(1);
  }

  console.log(`▶  Prism mock ${module.padEnd(14)} → http://${PRISM_HOST}:${port}`);

  const proc = spawn(
    PRISM_BIN,
    ["mock", "--port", String(port), "--host", PRISM_HOST, bundlePath],
    {
      stdio: ["ignore", "pipe", "pipe"],
      detached: false,
    }
  );

  // Consigner le PID pour mock:stop
  writeFileSync(resolve(PID_DIR, `${module}.pid`), String(proc.pid));

  proc.stdout.on("data", (data) => {
    process.stdout.write(`[prism:${module}] ${data}`);
  });

  proc.stderr.on("data", (data) => {
    process.stderr.write(`[prism:${module}] ${data}`);
  });

  proc.on("exit", (code, signal) => {
    if (code !== null && code !== 0) {
      console.error(`[prism:${module}] processus terminé avec code ${code} (signal: ${signal})`);
    }
  });

  processes.push({ module, port, proc });
}

console.log(`\n✅ ${processes.length} instances Prism démarrées.`);
console.log("   Ctrl+C ou 'pnpm --filter @sigfa/contracts mock:stop' pour arrêter.\n");

// Arrêt propre sur SIGINT / SIGTERM
function shutdown(signal) {
  console.log(`\n[mock] Signal ${signal} reçu — arrêt des instances Prism…`);
  for (const { module, proc } of processes) {
    try {
      proc.kill("SIGTERM");
      console.log(`  ✔ prism:${module} arrêté`);
    } catch {
      // Peut déjà être terminé
    }
  }
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

// Maintenir le processus en vie
await new Promise(() => {});
