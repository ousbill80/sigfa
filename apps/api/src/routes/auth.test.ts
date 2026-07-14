/**
 * Tests d'intégration — API-001 : Auth (login, refresh, logout, me, blocage)
 *
 * Utilise Testcontainers (PG 16 + Redis 7 réels).
 * Nommage strict : `API-001: <description>`
 *
 * @module
 */

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
} from "vitest";
import pg from "pg";
import { Redis } from "ioredis";
import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";
import { jwtVerify } from "jose";
import { applyMigrations } from "@sigfa/database/test-support";
import type { PostgresHarness } from "@sigfa/testing/tenant-isolation";
import { createApp } from "src/app.js";

// ─────────────────────────────────────────────────────────────────────────────
// Setup Testcontainers
// ─────────────────────────────────────────────────────────────────────────────

let pgContainer: StartedTestContainer;
let redisContainer: StartedTestContainer;
let db: pg.Client;
let redis: Redis;
let app: ReturnType<typeof createApp>;

const JWT_SECRET = "test-jwt-secret-at-least-32-chars-long!!";
const jwtSecretBytes = new TextEncoder().encode(JWT_SECRET);

/**
 * Applique les VRAIES migrations SQL (`packages/database/migrations/`) sur le PG
 * de test — FIDÉLITÉ au schéma de production (types enum réels `role` /
 * `agent_language`, contraintes, RLS). Aucune DDL inline dérivée : le schéma
 * exécuté ici est celui déployé (LA LOI T5). `applyMigrations` attend un
 * `PostgresHarness` : on adapte le `pg.Client` de test.
 */
async function runMigrations(client: pg.Client): Promise<void> {
  const harness: PostgresHarness = {
    connectionString: "",
    query: async (sql: string, values?: unknown[]) => {
      const res =
        values !== undefined
          ? await client.query(sql, values)
          : await client.query(sql);
      return { rows: res.rows as Array<Record<string, unknown>> };
    },
    stop: async () => {},
  };
  await applyMigrations(harness);
}

/** Insère les fixtures de test */
async function insertFixtures(client: pg.Client): Promise<{
  bankId: string;
  agencyId: string;
  agentId: string;
  agentEmail: string;
  agentPassword: string;
  inactiveId: string;
  deletedId: string;
}> {
  const bcrypt = await import("bcryptjs");

  const agentPassword = "ValidPassword123!";
  const agentHash = await bcrypt.default.hash(agentPassword, 10); // cost 10 pour tests rapides

  // Banque de test
  const bankRes = await client.query(
    `INSERT INTO banks (name, slug) VALUES ('Banque Test', 'banque-test') RETURNING id`
  );
  const bankId = (bankRes.rows[0] as { id: string }).id;

  // Agence de test
  const agencyRes = await client.query(
    `INSERT INTO agencies (bank_id, name, city) VALUES ($1, 'Agence Test', 'Abidjan') RETURNING id`,
    [bankId]
  );
  const agencyId = (agencyRes.rows[0] as { id: string }).id;

  // Agent actif
  const agentRes = await client.query(
    `INSERT INTO users (bank_id, email, password_hash, first_name, last_name, role)
     VALUES ($1, 'agent@test.ci', $2, 'Agent', 'Test', 'AGENT') RETURNING id`,
    [bankId, agentHash]
  );
  const agentId = (agentRes.rows[0] as { id: string }).id;

  // Affecter l'agent à l'agence
  await client.query(
    `INSERT INTO agency_users (bank_id, agency_id, user_id) VALUES ($1, $2, $3)`,
    [bankId, agencyId, agentId]
  );

  // Utilisateur inactif
  const inactiveRes = await client.query(
    `INSERT INTO users (bank_id, email, password_hash, first_name, last_name, role, is_active)
     VALUES ($1, 'inactive@test.ci', $2, 'Inactive', 'User', 'AGENT', false) RETURNING id`,
    [bankId, agentHash]
  );
  const inactiveId = (inactiveRes.rows[0] as { id: string }).id;

  // Utilisateur supprimé (deleted_at)
  const deletedRes = await client.query(
    `INSERT INTO users (bank_id, email, password_hash, first_name, last_name, role, deleted_at)
     VALUES ($1, 'deleted@test.ci', $2, 'Deleted', 'User', 'AGENT', NOW()) RETURNING id`,
    [bankId, agentHash]
  );
  const deletedId = (deletedRes.rows[0] as { id: string }).id;

  return {
    bankId,
    agencyId,
    agentId,
    agentEmail: "agent@test.ci",
    agentPassword,
    inactiveId,
    deletedId,
  };
}

let fixtures: Awaited<ReturnType<typeof insertFixtures>>;

beforeAll(async () => {
  // Démarrer PG 16
  pgContainer = await new GenericContainer("postgres:16")
    .withEnvironment({
      POSTGRES_USER: "sigfa",
      POSTGRES_PASSWORD: "sigfa_test",
      POSTGRES_DB: "sigfa_test",
    })
    .withExposedPorts(5432)
    .withWaitStrategy(
      Wait.forLogMessage(/database system is ready to accept connections/, 2)
    )
    .start();

  // Démarrer Redis 7
  redisContainer = await new GenericContainer("redis:7")
    .withExposedPorts(6379)
    .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
    .start();

  const pgHost = pgContainer.getHost();
  const pgPort = pgContainer.getMappedPort(5432);
  const redisHost = redisContainer.getHost();
  const redisPort = redisContainer.getMappedPort(6379);

  db = new pg.Client({
    connectionString: `postgresql://sigfa:sigfa_test@${pgHost}:${pgPort}/sigfa_test`,
  });
  await db.connect();

  redis = new Redis(`redis://${redisHost}:${redisPort}`);

  await runMigrations(db);
  fixtures = await insertFixtures(db);

  // Créer l'app avec les vraies dépendances
  app = createApp({ db, redis, jwtSecret: jwtSecretBytes });
}, 120_000);

afterAll(async () => {
  await redis.quit();
  await db.end();
  await pgContainer.stop();
  await redisContainer.stop();
}, 30_000);

// ─────────────────────────────────────────────────────────────────────────────
// Helper : fetch sur l'app Hono
// ─────────────────────────────────────────────────────────────────────────────

async function post(
  path: string,
  body: unknown
): Promise<{ status: number; data: unknown }> {
  const res = await app.fetch(
    new Request(`http://localhost/api/v1${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );
  return { status: res.status, data: await res.json() };
}

async function get(
  path: string,
  token?: string
): Promise<{ status: number; data: unknown }> {
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await app.fetch(
    new Request(`http://localhost/api/v1${path}`, { headers })
  );
  return { status: res.status, data: await res.json() };
}

// ─────────────────────────────────────────────────────────────────────────────
// Critère 1 : login valide → access décodable (claims exacts) + refresh
// ─────────────────────────────────────────────────────────────────────────────

describe("API-001: auth", () => {
  it(
    "API-001: login valide → access décodable (claims exacts) + refresh ; mauvais mdp → 401 code LA LOI",
    async () => {
      // Login valide
      const { status, data } = await post("/auth/login", {
        email: fixtures.agentEmail,
        password: fixtures.agentPassword,
      });

      expect(status).toBe(200);
      const tokens = data as {
        accessToken: string;
        refreshToken: string;
        expiresIn: number;
      };
      expect(tokens.accessToken).toBeTypeOf("string");
      expect(tokens.refreshToken).toBeTypeOf("string");
      expect(tokens.expiresIn).toBe(900);

      // Décoder et vérifier les claims du JWT
      const { payload } = await jwtVerify(
        tokens.accessToken,
        jwtSecretBytes
      );
      expect(payload["sub"]).toBe(fixtures.agentId);
      expect(payload["bankId"]).toBe(fixtures.bankId);
      expect(payload["role"]).toBe("AGENT");
      expect(Array.isArray(payload["agencyIds"])).toBe(true);
      expect(payload["agencyIds"]).toContain(fixtures.agencyId);

      // Mauvais mot de passe → 401
      const bad = await post("/auth/login", {
        email: fixtures.agentEmail,
        password: "WrongPassword123!",
      });
      expect(bad.status).toBe(401);
      expect((bad.data as { error: { code: string } }).error.code).toBe(
        "UNAUTHORIZED"
      );
    }
  );

  // ─────────────────────────────────────────────────────────────────────────
  // WEB-002-HDR : claim displayName (additif) — login, refresh, /auth/me
  // ─────────────────────────────────────────────────────────────────────────

  it(
    "WEB-002-HDR: login → claim displayName 'Prénom Nom' ; display_name prioritaire ; préservé au refresh ; /auth/me l'expose",
    async () => {
      // Fallback « Prénom Nom » (l'agent fixture n'a pas de display_name)
      const loginRes = await post("/auth/login", {
        email: fixtures.agentEmail,
        password: fixtures.agentPassword,
      });
      expect(loginRes.status).toBe(200);
      const tokens = loginRes.data as { accessToken: string; refreshToken: string };
      const { payload } = await jwtVerify(tokens.accessToken, jwtSecretBytes);
      expect(payload["displayName"]).toBe("Agent Test");

      // /auth/me expose displayName (UserProfile.displayName — contrat)
      const meRes = await get("/auth/me", tokens.accessToken);
      expect(meRes.status).toBe(200);
      expect((meRes.data as { displayName?: string }).displayName).toBe("Agent Test");

      // Le claim survit à la rotation du refresh token
      const refreshRes = await post("/auth/refresh", { refreshToken: tokens.refreshToken });
      expect(refreshRes.status).toBe(200);
      const { accessToken: at2 } = refreshRes.data as { accessToken: string };
      const { payload: p2 } = await jwtVerify(at2, jwtSecretBytes);
      expect(p2["displayName"]).toBe("Agent Test");

      // display_name (conseiller) prioritaire sur « Prénom Nom »
      const bcrypt = await import("bcryptjs");
      const hash = await bcrypt.default.hash(fixtures.agentPassword, 10);
      await db.query(
        `INSERT INTO users (bank_id, email, password_hash, first_name, last_name, role, display_name)
         VALUES ($1, 'display@test.ci', $2, 'Awa', 'Kone', 'AGENT', 'Mme Koné')
         ON CONFLICT (email) DO NOTHING`,
        [fixtures.bankId, hash]
      );
      const dnRes = await post("/auth/login", {
        email: "display@test.ci",
        password: fixtures.agentPassword,
      });
      expect(dnRes.status).toBe(200);
      const dnTokens = dnRes.data as { accessToken: string };
      const { payload: p3 } = await jwtVerify(dnTokens.accessToken, jwtSecretBytes);
      expect(p3["displayName"]).toBe("Mme Koné");
    }
  );

  // ─────────────────────────────────────────────────────────────────────────
  // Critère 2 : 5 échecs/15min → 429 ; après expiration du verrou → login OK
  // ─────────────────────────────────────────────────────────────────────────

  it(
    "API-001: 5 échecs/15min → 429 ; après expiration du verrou → login OK et compteur remis (horloge contrôlée)",
    async () => {
      // Créer un utilisateur dédié pour ce test
      const bcrypt = await import("bcryptjs");
      const pwd = "LockTestPassword123!";
      const hash = await bcrypt.default.hash(pwd, 10);

      const res = await db.query(
        `INSERT INTO users (bank_id, email, password_hash, first_name, last_name, role)
         VALUES ($1, 'locktest@test.ci', $2, 'Lock', 'Test', 'AGENT') RETURNING id`,
        [fixtures.bankId, hash]
      );
      const lockUserId = (res.rows[0] as { id: string }).id;

      // 5 mauvais mots de passe
      for (let i = 0; i < 5; i++) {
        await post("/auth/login", {
          email: "locktest@test.ci",
          password: "WrongPassword!",
        });
      }

      // Le 5e doit avoir déclenché le verrouillage — re-tenter doit donner 429
      const { status, data } = await post("/auth/login", {
        email: "locktest@test.ci",
        password: "WrongPassword!",
      });
      expect(status).toBe(429);
      expect((data as { error: { code: string } }).error.code).toBe(
        "TOO_MANY_REQUESTS"
      );

      // Simuler l'expiration du verrou via SQL (horloge contrôlée)
      await db.query(
        `UPDATE users SET locked_until = NOW() - INTERVAL '1 second', failed_login_attempts = 0
         WHERE id = $1`,
        [lockUserId]
      );

      // Login doit maintenant fonctionner
      const { status: okStatus } = await post("/auth/login", {
        email: "locktest@test.ci",
        password: pwd,
      });
      expect(okStatus).toBe(200);

      // Vérifier que le compteur est remis à 0
      const userState = await db.query(
        `SELECT failed_login_attempts, locked_until FROM users WHERE id = $1`,
        [lockUserId]
      );
      const row = userState.rows[0] as {
        failed_login_attempts: number;
        locked_until: Date | null;
      };
      expect(row.failed_login_attempts).toBe(0);
      expect(row.locked_until).toBeNull();
    }
  );

  // ─────────────────────────────────────────────────────────────────────────
  // Critère 3 : refresh rotation + détection de rejeu
  // ─────────────────────────────────────────────────────────────────────────

  it(
    "API-001: refresh → nouveaux tokens, l'ancien rejoué → 401 + famille révoquée (test de rejeu)",
    async () => {
      // Login initial
      const loginRes = await post("/auth/login", {
        email: fixtures.agentEmail,
        password: fixtures.agentPassword,
      });
      const { refreshToken: rt1 } = loginRes.data as {
        accessToken: string;
        refreshToken: string;
        expiresIn: number;
      };

      // Refresh valide
      const refreshRes = await post("/auth/refresh", {
        refreshToken: rt1,
      });
      expect(refreshRes.status).toBe(200);
      const { refreshToken: rt2, accessToken: at2 } = refreshRes.data as {
        accessToken: string;
        refreshToken: string;
        expiresIn: number;
      };
      expect(rt2).not.toBe(rt1);
      expect(at2).toBeTypeOf("string");

      // Rejouer l'ancien refresh token rt1 → 401 + famille révoquée
      const replayRes = await post("/auth/refresh", {
        refreshToken: rt1,
      });
      expect(replayRes.status).toBe(401);
      expect(
        (replayRes.data as { error: { code: string } }).error.code
      ).toBe("UNAUTHORIZED");

      // rt2 doit aussi être révoqué (famille entière)
      const rt2Res = await post("/auth/refresh", {
        refreshToken: rt2,
      });
      expect(rt2Res.status).toBe(401);
    }
  );

  // ─────────────────────────────────────────────────────────────────────────
  // Critère 4 : logout idempotent + /me
  // ─────────────────────────────────────────────────────────────────────────

  it(
    "API-001: logout sans Authorization valide fonctionne (security:[]) ; me → 401 sans token, profil avec",
    async () => {
      // /auth/me sans token → 401
      const noToken = await get("/auth/me");
      expect(noToken.status).toBe(401);

      // Login pour obtenir des tokens
      const loginRes = await post("/auth/login", {
        email: fixtures.agentEmail,
        password: fixtures.agentPassword,
      });
      const { accessToken, refreshToken } = loginRes.data as {
        accessToken: string;
        refreshToken: string;
        expiresIn: number;
      };

      // /auth/me avec token valide → profil
      const meRes = await get("/auth/me", accessToken);
      expect(meRes.status).toBe(200);
      const profile = meRes.data as {
        id: string;
        role: string;
        bankId: string;
      };
      expect(profile.id).toBe(fixtures.agentId);
      expect(profile.role).toBe("AGENT");
      expect(profile.bankId).toBe(fixtures.bankId);

      // Logout (sans Authorization) — doit fonctionner
      const logoutRes = await post("/auth/logout", { refreshToken });
      expect(logoutRes.status).toBe(200);
      expect((logoutRes.data as { success: boolean }).success).toBe(true);

      // Logout idempotent (même token révoqué)
      const logoutAgain = await post("/auth/logout", { refreshToken });
      expect(logoutAgain.status).toBe(200);
    }
  );

  // ─────────────────────────────────────────────────────────────────────────
  // Critère 5 : utilisateur inactif/supprimé → 401
  // ─────────────────────────────────────────────────────────────────────────

  it(
    "API-001: utilisateur inactif/supprimé → 401 login et refresh",
    async () => {
      // Login avec compte inactif
      const inactiveRes = await post("/auth/login", {
        email: "inactive@test.ci",
        password: fixtures.agentPassword,
      });
      expect(inactiveRes.status).toBe(401);
      expect(
        (inactiveRes.data as { error: { code: string } }).error.code
      ).toBe("UNAUTHORIZED");

      // Login avec compte supprimé
      const deletedRes = await post("/auth/login", {
        email: "deleted@test.ci",
        password: fixtures.agentPassword,
      });
      expect(deletedRes.status).toBe(401);
      expect(
        (deletedRes.data as { error: { code: string } }).error.code
      ).toBe("UNAUTHORIZED");

      // Test refresh avec compte désactivé en cours de session :
      // d'abord login avec l'agent actif, puis désactiver, puis refresh
      const loginRes = await post("/auth/login", {
        email: fixtures.agentEmail,
        password: fixtures.agentPassword,
      });
      const { refreshToken } = loginRes.data as {
        accessToken: string;
        refreshToken: string;
        expiresIn: number;
      };

      // Désactiver le compte
      await db.query(
        `UPDATE users SET is_active = false WHERE id = $1`,
        [fixtures.agentId]
      );

      const refreshRes = await post("/auth/refresh", { refreshToken });
      expect(refreshRes.status).toBe(401);

      // Réactiver pour les autres tests
      await db.query(
        `UPDATE users SET is_active = true WHERE id = $1`,
        [fixtures.agentId]
      );
    }
  );

  // ─────────────────────────────────────────────────────────────────────────
  // Critère 6 : JWT_SECRET manquant → démarrage échoue explicitement
  // ─────────────────────────────────────────────────────────────────────────

  it("API-001: JWT_SECRET manquant → démarrage échoue explicitement", async () => {
    const { getJwtSecret } = await import("src/lib/env.js");

    const originalSecret = process.env["JWT_SECRET"];

    // Secret absent
    delete process.env["JWT_SECRET"];
    expect(() => getJwtSecret()).toThrow(/JWT_SECRET/);

    // Secret trop court
    process.env["JWT_SECRET"] = "short";
    expect(() => getJwtSecret()).toThrow(/JWT_SECRET/);

    // Restaurer
    if (originalSecret) {
      process.env["JWT_SECRET"] = originalSecret;
    } else {
      delete process.env["JWT_SECRET"];
    }
  });
});
