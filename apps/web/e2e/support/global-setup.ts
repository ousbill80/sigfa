/**
 * globalSetup Playwright (RT-003) — oriente le backend RÉEL puis l'app web.
 *
 * Ordre (D6-like) :
 *   1. Testcontainers PG16 + Redis7 → schéma + seed.
 *   2. Serveur API RÉEL (`REALTIME_MODE=real`) en sous-process branché dessus.
 *   3. App web Next en sous-process, `NEXT_PUBLIC_API_URL` → API réelle,
 *      `NEXT_PUBLIC_REALTIME_MODE=real`, counter agent injecté.
 *   4. Persiste l'état (fixtures + URLs + token) pour les specs.
 *
 * globalTeardown arrête tout (web → api → conteneurs).
 *
 * @module e2e/support/global-setup
 */
import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import { startHarness, E2E_JWT_SECRET, type E2eResources } from "./harness";
import { writeState } from "./state";

const WEB_ROOT = join(__dirname, "..", "..");

/** Ports fixes loopback (E2E local ; runner mono-instance). */
const API_PORT = 4021;
const WEB_PORT = 4020;

/** Ressources conservées entre setup et teardown (globales au process runner). */
interface Held {
  harness: E2eResources;
  web: ChildProcess;
}
declare global {
  // eslint-disable-next-line no-var
  var __RT003_HELD__: Held | undefined;
}

/** Attend qu'une URL HTTP réponde (polling, timeout borné). */
async function waitForHttp(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last = "";
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return;
      last = `status ${res.status}`;
    } catch (e) {
      last = e instanceof Error ? e.message : String(e);
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`Timeout ${url} — ${last}`);
}

/** Point d'entrée globalSetup. */
export default async function globalSetup(): Promise<void> {
  const harness = await startHarness(API_PORT);
  const { backend } = harness;

  const webBaseUrl = `http://127.0.0.1:${WEB_PORT}`;
  const web = spawn(
    "pnpm",
    ["exec", "next", "dev", "--port", String(WEB_PORT)],
    {
      cwd: WEB_ROOT,
      env: {
        ...process.env,
        NEXT_PUBLIC_API_URL: backend.apiBase,
        NEXT_PUBLIC_REALTIME_MODE: "real",
        NEXT_PUBLIC_AGENT_COUNTER_ID: backend.counterId,
        // Le middleware web (S1) et le proxy /api/rt VÉRIFIENT le cookie
        // `access_token` avec `JWT_SECRET` : il DOIT être identique au secret qui
        // a forgé les tokens agent/admin (harness), sinon toute route authentifiée
        // (agent, admin/theming) est redirigée vers /login et les cookies posés
        // par les specs sont rejetés.
        JWT_SECRET: E2E_JWT_SECRET,
        PORT: String(WEB_PORT),
      },
      stdio: ["ignore", "inherit", "inherit"],
    }
  );

  await waitForHttp(`${webBaseUrl}/login`, 120_000);

  writeState({
    webBaseUrl,
    apiOrigin: backend.apiOrigin,
    apiBase: backend.apiBase,
    dbUrl: backend.dbUrl,
    agentToken: backend.agentToken,
    adminToken: backend.adminToken,
    auditorToken: backend.auditorToken,
    bankId: backend.bankId,
    agencyId: backend.agencyId,
    serviceId: backend.serviceId,
    queueId: backend.queueId,
    counterId: backend.counterId,
    agentId: backend.agentId,
    kioskId: backend.kioskId,
    silentKioskId: backend.silentKioskId,
    onlineKioskId: backend.onlineKioskId,
  });

  globalThis.__RT003_HELD__ = { harness, web };
}
