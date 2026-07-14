/**
 * Harnais E2E réel (RT-003) — oriente un backend RÉEL pour Playwright.
 *
 * Démarre PostgreSQL 16 + Redis 7 (Testcontainers), applique les VRAIES
 * migrations `packages/database/migrations/00NN_*.sql` (via `applyMigrations`,
 * l'applicateur partagé des harnais d'intégration API/DB) — le schéma du
 * conteneur E2E est donc STRICTEMENT le schéma de production (aucun DDL inline
 * dérivé, aucune rustine de colonne). Seede ensuite une banque/agence/service/
 * file/guichet/agent/borne CONTRE LE SCHÉMA RÉEL, puis lance le SERVEUR API RÉEL
 * (`apps/api/dist/index.js`) en sous-processus avec `REALTIME_MODE=real`
 * (socket.io + scheduler) branché sur ces conteneurs.
 *
 * Rôles RLS : les migrations provisionnent `sigfa_migrator` (BYPASSRLS) et
 * `sigfa_app` (NOBYPASSRLS) + policies FORCE RLS + GRANTs. Le SEED s'exécute
 * comme l'utilisateur initial du conteneur (`sigfa`, SUPERUSER → BYPASSRLS),
 * exactement comme le rôle migrateur/owner des harnais d'intégration. Le serveur
 * API se connecte via `DATABASE_URL` (même rôle owner) : les routes armées
 * (`withArmedTenant` → `SET LOCAL app.current_bank_id`) restent fonctionnelles
 * (le `SET LOCAL` est inoffensif sous superuser) tout comme les routes non armées,
 * ce qui préserve la parité de comportement de la suite. La couverture RLS
 * `sigfa_app` NOBYPASSRLS (SEC-002 armé) est prouvée par les tests d'INTÉGRATION
 * dédiés (`*-tenant-isolation.integration.test.ts`), pas par l'E2E navigateur.
 *
 * Aucun mock : l'app web parle à cette API réelle, les sockets sont réels.
 *
 * @module e2e/support/harness
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import pg from "pg";
import { Redis } from "ioredis";
import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";
import { SignJWT } from "jose";

// Playwright charge ce module en CJS → `__dirname` disponible.
const HERE = __dirname;
/** Racine du monorepo (apps/web/e2e/support → ../../../..). */
const API_LAUNCHER = join(HERE, "api-launcher.mjs");
/**
 * Applicateur de migrations (sous-processus ESM). Il RÉUTILISE `applyMigrations`
 * de `@sigfa/database/test-support` ; on l'exécute hors du process Playwright
 * (loader CJS) car ce package ESM (`type: module`) utilise `import.meta`, que le
 * loader TS de Playwright ne peut pas `require()`. Voir `migrate-runner.mjs`.
 */
const MIGRATE_RUNNER = join(HERE, "migrate-runner.mjs");

/** Secret JWT partagé (≥32 caractères — fail-fast API sinon). */
export const E2E_JWT_SECRET = "rt003-e2e-jwt-secret-at-least-32-chars!!";
/** Clés phone-cipher (64 hex = 32 octets) requises par les routes ticket. */
const PHONE_ENCRYPTION_KEY =
  "1111111111111111111111111111111111111111111111111111111111111111";
const PHONE_HASH_KEY =
  "2222222222222222222222222222222222222222222222222222222222222222";

/** Fixtures seedées, exposées aux specs via le fichier d'état. */
export interface E2eFixtures {
  bankId: string;
  agencyId: string;
  serviceId: string;
  queueId: string;
  counterId: string;
  agentId: string;
  adminId: string;
  /** Auditeur (rôle ORTHOGONAL lecture seule) — écran journal d'audit SEC-001b. */
  auditorId: string;
  kioskId: string;
  kioskSecret: string;
  /** Borne MUETTE seedée (last_seen ancien > seuil 90 s) — supervision ADM-003b. */
  silentKioskId: string;
  /** Borne EN LIGNE seedée (last_seen récent) — supervision ADM-003b. */
  onlineKioskId: string;
}

/** État complet du backend E2E, sérialisé pour les specs. */
export interface E2eBackend extends E2eFixtures {
  /** URL racine de l'API réelle (HTTP + WS). */
  apiOrigin: string;
  /** URL REST préfixée /api/v1 (base des clients de contrat). */
  apiBase: string;
  /** JWT agent (scope agence) pour l'authentification web. */
  agentToken: string;
  /** JWT BANK_ADMIN (scope banque) pour la console theming (ADM-001b). */
  adminToken: string;
  /** JWT AUDITOR (scope banque, lecture seule) — écran journal d'audit SEC-001b. */
  auditorToken: string;
}

/** Poignée interne des ressources à nettoyer. */
export interface E2eResources {
  pg: StartedTestContainer;
  redis: StartedTestContainer;
  api: ChildProcess;
  backend: E2eBackend;
}

/**
 * Applique les VRAIES migrations de production (`packages/database/migrations/`)
 * sur la base du conteneur E2E, en déléguant à `migrate-runner.mjs` (sous-processus
 * ESM) qui RÉUTILISE l'applicateur partagé `applyMigrations`. On passe par un
 * sous-processus car ce package ESM utilise `import.meta`, non `require()`-able
 * depuis le loader CJS de Playwright.
 *
 * Après cet appel le schéma du conteneur est STRICTEMENT le schéma de prod :
 * toutes les tables (dont `ai_anomalies`, `ai_forecasts`, `audit_log`, la
 * matérialisation feedback IA…), colonnes, contraintes, enums, rôles RLS
 * (`sigfa_app` / `sigfa_migrator`) et policies FORCE RLS existent. Fini les faux
 * 500 « relation … does not exist » et les rustines de colonnes.
 *
 * @param dbUrl - URL de connexion owner/migrateur du conteneur PG E2E.
 * @throws Si le sous-processus de migration échoue (schéma non appliqué).
 */
function applySchema(dbUrl: string): void {
  const res = spawnSync(process.execPath, [MIGRATE_RUNNER], {
    env: { ...process.env, DATABASE_URL: dbUrl },
    stdio: ["ignore", "inherit", "inherit"],
  });
  if (res.status !== 0) {
    throw new Error(
      `Application des migrations échouée (migrate-runner.mjs, code ${res.status ?? "signal"}).`
    );
  }
}

/** Seede bank/agency/service/queue/counter/agent/kiosk et retourne les ids. */
async function seed(db: pg.Client): Promise<E2eFixtures> {
  // Thème initial valide (requestedColors + welcomeMessages) → `GET /banks/:id/theme`
  // renvoie une console prête (état `ready`) pour le parcours theming ADM-001b.
  const initialTheme = JSON.stringify({
    requestedColors: { primary: "#003f7f", secondary: "#e8a000", background: "#ffffff" },
    welcomeMessages: { fr: "Bienvenue", en: "Welcome" },
  });
  const bank = await db.query(
    `INSERT INTO banks (name, slug, theme) VALUES ('Banque du Commerce','oc',$1::jsonb) RETURNING id`,
    [initialTheme]
  );
  const bankId = (bank.rows[0] as { id: string }).id;
  const agency = await db.query(
    `INSERT INTO agencies (bank_id, name) VALUES ($1,'Agence Plateau') RETURNING id`,
    [bankId]
  );
  const agencyId = (agency.rows[0] as { id: string }).id;
  const svc = await db.query(
    `INSERT INTO services (bank_id, agency_id, code, name, sla_minutes) VALUES ($1,$2,'OC','Ouverture de compte',10) RETURNING id`,
    [bankId, agencyId]
  );
  const serviceId = (svc.rows[0] as { id: string }).id;
  const q = await db.query(
    `INSERT INTO queues (bank_id, agency_id, service_id) VALUES ($1,$2,$3) RETURNING id`,
    [bankId, agencyId, serviceId]
  );
  const queueId = (q.rows[0] as { id: string }).id;
  // Colonnes NOT NULL réelles de `users` (schéma prod) : `password_hash`,
  // `first_name`, `last_name`. Le hash est un placeholder (aucun flux login
  // par mot de passe en E2E — l'auth passe par les JWT forgés). `languages`
  // hérite du défaut `{FR}` (enum agent_language FR|EN après migration 0011).
  const agent = await db.query(
    `INSERT INTO users (bank_id, email, password_hash, first_name, last_name, role)
     VALUES ($1,'agent@oc.ci','x','Agent','E2E','AGENT') RETURNING id`,
    [bankId]
  );
  const agentId = (agent.rows[0] as { id: string }).id;
  // Administrateur banque (scope banque) pour la console theming (ADM-001b).
  const admin = await db.query(
    `INSERT INTO users (bank_id, email, password_hash, first_name, last_name, role)
     VALUES ($1,'admin@oc.ci','x','Admin','E2E','BANK_ADMIN') RETURNING id`,
    [bankId]
  );
  const adminId = (admin.rows[0] as { id: string }).id;
  // Auditeur (rôle ORTHOGONAL lecture seule, scope banque) — écran journal d'audit
  // SEC-001b : il lit `GET /audit-logs` borné à SA banque (jamais cross-tenant).
  const auditor = await db.query(
    `INSERT INTO users (bank_id, email, password_hash, first_name, last_name, role)
     VALUES ($1,'auditor@oc.ci','x','Auditor','E2E','AUDITOR') RETURNING id`,
    [bankId]
  );
  const auditorId = (auditor.rows[0] as { id: string }).id;
  // Affectation d'agence (agency_users) — requise par le nettoyage socket
  // (`forceOffline` sur déconnexion agent) et le scope agence.
  await db.query(
    `INSERT INTO agency_users (bank_id, agency_id, user_id) VALUES ($1,$2,$3),($1,$2,$4),($1,$2,$5)`,
    [bankId, agencyId, agentId, adminId, auditorId]
  );
  // Guichet affecté à l'agent + statut OPEN → call-next opérationnel.
  const ctr = await db.query(
    `INSERT INTO counters (bank_id, agency_id, number, label, status, agent_id) VALUES ($1,$2,1,'Guichet 3','OPEN',$3) RETURNING id`,
    [bankId, agencyId, agentId]
  );
  const counterId = (ctr.rows[0] as { id: string }).id;
  // `bank_id` NOT NULL (schéma réel) → le clone d'agence (ADM-002b) retrouve les
  // liaisons de la source (`WHERE bank_id = $1 AND counter_id = $2`) et les recopie.
  await db.query(
    `INSERT INTO counter_services (bank_id, counter_id, service_id) VALUES ($1,$2,$3)`,
    [bankId, counterId, serviceId]
  );
  // Agent AVAILABLE (le cycle ticket pilotera SERVING/AVAILABLE).
  await db.query(
    `INSERT INTO agent_status_history (bank_id, agency_id, agent_id, to_status) VALUES ($1,$2,$3,'AVAILABLE')`,
    [bankId, agencyId, agentId]
  );
  // Borne (kiosk) avec une session ACTIVE forgée directement (current_session_id
  // renseigné, non révoquée). Le hash de credentials n'est pas utilisé par l'E2E
  // (aucun appel /kiosk/session) — placeholder non nul pour la contrainte NOT NULL.
  const kioskSecret = "kiosk-secret-e2e-1234567890";
  const kiosk = await db.query(
    `INSERT INTO kiosks (bank_id, agency_id, label, credentials_hash, printer_status,
                         current_session_id, session_expires_at, session_revoked_at)
     VALUES ($1,$2,'Borne 1','x','OK', gen_random_uuid(), now() + interval '12 hours', NULL)
     RETURNING id`,
    [bankId, agencyId]
  );
  const kioskId = (kiosk.rows[0] as { id: string }).id;
  // ── Supervision borne ADM-003b : deux bornes à `last_seen` CONTRÔLÉ ──────────
  // Le statut est DÉRIVÉ à la lecture depuis `last_seen` + l'horloge serveur
  // (seuil SILENT = 90 s, DEGRADED ≥ 60 s). On seede des horodatages déterministes
  // (jamais un état figé en base) pour que `GET /agencies/:id/kiosks/status`
  // renvoie une borne MUETTE (silence 10 min) et une borne EN LIGNE (5 s) sans
  // dépendre du passage réel du temps pendant le test.
  const silent = await db.query(
    `INSERT INTO kiosks (bank_id, agency_id, label, credentials_hash, printer_status, last_seen)
     VALUES ($1,$2,'Borne Muette','x','OK', now() - interval '10 minutes')
     RETURNING id`,
    [bankId, agencyId]
  );
  const silentKioskId = (silent.rows[0] as { id: string }).id;
  const online = await db.query(
    `INSERT INTO kiosks (bank_id, agency_id, label, credentials_hash, printer_status, last_seen)
     VALUES ($1,$2,'Borne En Ligne','x','OK', now() - interval '5 seconds')
     RETURNING id`,
    [bankId, agencyId]
  );
  const onlineKioskId = (online.rows[0] as { id: string }).id;
  return {
    bankId, agencyId, serviceId, queueId, counterId, agentId, adminId, auditorId,
    kioskId, kioskSecret, silentKioskId, onlineKioskId,
  };
}

/** Forge un JWT agent (scope agence) signé avec le secret E2E. */
async function forgeAgentToken(fx: E2eFixtures): Promise<string> {
  const secret = new TextEncoder().encode(E2E_JWT_SECRET);
  return new SignJWT({ role: "AGENT", bankId: fx.bankId, agencyIds: [fx.agencyId] })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(fx.agentId)
    .setIssuedAt()
    .setExpirationTime("2h")
    .sign(secret);
}

/** Forge un JWT BANK_ADMIN (scope banque) signé avec le secret E2E. */
async function forgeAdminToken(fx: E2eFixtures): Promise<string> {
  const secret = new TextEncoder().encode(E2E_JWT_SECRET);
  return new SignJWT({ role: "BANK_ADMIN", bankId: fx.bankId, agencyIds: [fx.agencyId] })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(fx.adminId)
    .setIssuedAt()
    .setExpirationTime("2h")
    .sign(secret);
}

/**
 * Forge un JWT AUDITOR (scope banque, lecture seule) signé avec le secret E2E.
 * `bankId` renseigné → le journal d'audit est borné à cette banque (jamais
 * cross-tenant, SEC-001b). `agencyIds` permet la dérivation du contexte de page.
 */
async function forgeAuditorToken(fx: E2eFixtures): Promise<string> {
  const secret = new TextEncoder().encode(E2E_JWT_SECRET);
  return new SignJWT({ role: "AUDITOR", bankId: fx.bankId, agencyIds: [fx.agencyId] })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(fx.auditorId)
    .setIssuedAt()
    .setExpirationTime("2h")
    .sign(secret);
}

/** Attend qu'une URL réponde 2xx (polling robuste, pas de sleep fixe). */
async function waitForHttp(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr = "";
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
      lastErr = `status ${res.status}`;
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Timeout en attendant ${url} — dernière erreur : ${lastErr}`);
}

/**
 * Démarre les conteneurs + le serveur API réel et retourne les ressources.
 * @param apiPort - Port du serveur API réel.
 * @returns Les ressources démarrées (à passer à {@link stopHarness}).
 */
export async function startHarness(apiPort: number): Promise<E2eResources> {
  const pgContainer = await new GenericContainer("postgres:16")
    .withEnvironment({
      POSTGRES_USER: "sigfa",
      POSTGRES_PASSWORD: "sigfa_test",
      POSTGRES_DB: "sigfa_test",
    })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
    .start();
  const redisContainer = await new GenericContainer("redis:7")
    .withExposedPorts(6379)
    .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
    .start();

  const dbUrl = `postgresql://sigfa:sigfa_test@${pgContainer.getHost()}:${pgContainer.getMappedPort(5432)}/sigfa_test`;
  const redisUrl = `redis://${redisContainer.getHost()}:${redisContainer.getMappedPort(6379)}`;

  // 1. Migrations réelles (schéma de prod) via l'applicateur partagé.
  applySchema(dbUrl);
  // 2. Seed contre le schéma réel, en owner (superuser → BYPASSRLS pour le seed).
  const db = new pg.Client({ connectionString: dbUrl });
  await db.connect();
  const fx = await seed(db);
  await db.end();

  const redis = new Redis(redisUrl);
  await redis.flushall();
  await redis.quit();

  const apiOrigin = `http://127.0.0.1:${apiPort}`;
  const api = spawn(
    process.execPath,
    [API_LAUNCHER],
    {
      env: {
        ...process.env,
        DATABASE_URL: dbUrl,
        REDIS_URL: redisUrl,
        JWT_SECRET: E2E_JWT_SECRET,
        API_PORT: String(apiPort),
        REALTIME_MODE: "real",
        PHONE_ENCRYPTION_KEY,
        PHONE_HASH_KEY,
        NODE_ENV: "test",
      },
      stdio: ["ignore", "inherit", "inherit"],
    }
  );

  await waitForHttp(`${apiOrigin}/api/v1/health`, 60_000);

  const agentToken = await forgeAgentToken(fx);
  const adminToken = await forgeAdminToken(fx);
  const auditorToken = await forgeAuditorToken(fx);
  const backend: E2eBackend = {
    ...fx,
    apiOrigin,
    apiBase: `${apiOrigin}/api/v1`,
    agentToken,
    adminToken,
    auditorToken,
  };
  return { pg: pgContainer, redis: redisContainer, api, backend };
}

/** Arrête le serveur API et les conteneurs. */
export async function stopHarness(res: E2eResources): Promise<void> {
  res.api.kill("SIGTERM");
  await new Promise((r) => setTimeout(r, 500));
  if (!res.api.killed) res.api.kill("SIGKILL");
  await res.pg.stop();
  await res.redis.stop();
}
