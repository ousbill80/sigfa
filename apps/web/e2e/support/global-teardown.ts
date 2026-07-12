/**
 * globalTeardown Playwright (RT-003) — arrêt propre (web → api → conteneurs).
 * @module e2e/support/global-teardown
 */
import { stopHarness } from "./harness";

/** Point d'entrée globalTeardown. */
export default async function globalTeardown(): Promise<void> {
  const held = globalThis.__RT003_HELD__;
  if (!held) return;
  held.web.kill("SIGTERM");
  await new Promise((r) => setTimeout(r, 500));
  if (!held.web.killed) held.web.kill("SIGKILL");
  await stopHarness(held.harness);
  globalThis.__RT003_HELD__ = undefined;
}
