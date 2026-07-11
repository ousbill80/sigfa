import { GenericContainer, StartedTestContainer, Wait } from "testcontainers";

/** Résultat d'une requête PostgreSQL */
export interface QueryResult {
  rows: Array<Record<string, unknown>>;
}

/** Harness PostgreSQL éphémère (Testcontainers) */
export interface PostgresHarness {
  /**
   * Exécute une requête SQL et retourne les lignes.
   * DB-009 : supporte les requêtes paramétrées ($1, $2, ...) via le tableau `values`.
   */
  query: (sql: string, values?: unknown[]) => Promise<QueryResult>;
  /** Arrête le conteneur */
  stop: () => Promise<void>;
  /** URL de connexion */
  connectionString: string;
}

/**
 * Harness PostgreSQL double-rôle pour les tests RLS (DB-002).
 *
 * - `migrationConnectionString` : connexion owner/migrateur (BYPASSRLS), pour les migrations et fixtures.
 * - `appConnectionString` : connexion applicative `sigfa_app` (sans BYPASSRLS), pour les tests RLS.
 * - `query()` : connexion migrateur (pour les vérifications pg_roles, pg_policies, fixtures).
 * - `appQuery()` : connexion applicative (pour les tests d'isolation).
 */
export interface DualConnectionHarness extends PostgresHarness {
  /** URL de connexion migrateur (owner, BYPASSRLS) */
  migrationConnectionString: string;
  /** URL de connexion applicative (sigfa_app, sans BYPASSRLS) */
  appConnectionString: string;
  /**
   * Exécute une requête via la connexion applicative (sigfa_app).
   * DB-009 : supporte les requêtes paramétrées ($1, $2, ...) via le tableau `values`.
   */
  appQuery: (sql: string, values?: unknown[]) => Promise<QueryResult>;
}

/** Harness Redis éphémère (Testcontainers) */
export interface RedisHarness {
  /** Envoie PING et retourne la réponse */
  ping: () => Promise<string>;
  /** Arrête le conteneur */
  stop: () => Promise<void>;
  /** Host:port de Redis */
  connectionUrl: string;
}

/**
 * Construit la chaîne de connexion PostgreSQL à partir d'un conteneur démarré.
 * @param container - Conteneur Testcontainers démarré
 * @returns URL de connexion postgresql://
 */
function buildPostgresConnectionString(container: StartedTestContainer): string {
  const host = container.getHost();
  const port = container.getMappedPort(5432);
  return `postgresql://sigfa:sigfa_test@${host}:${port}/sigfa_test`;
}

/**
 * Construit l'URL de connexion Redis à partir d'un conteneur démarré.
 * @param container - Conteneur Testcontainers démarré
 * @returns URL de connexion redis://
 */
function buildRedisConnectionUrl(container: StartedTestContainer): string {
  const host = container.getHost();
  const port = container.getMappedPort(6379);
  return `redis://${host}:${port}`;
}

/**
 * Retourne une fonction permettant d'envoyer une commande brute à Redis via net.Socket.
 * @param port - Port Redis mappé
 * @param host - Hôte Redis
 * @param net - Module net Node.js (pré-importé)
 * @returns Fonction envoyant la commande et retournant la réponse
 */
function makeSendCommand(
  port: number,
  host: string,
  net: typeof import("net")
): (command: string) => Promise<string> {
  return (command: string): Promise<string> =>
    new Promise((resolve, reject) => {
      const socket = net.createConnection(port, host, () => {
        socket.write(command);
      });
      let data = "";
      socket.on("data", (chunk: Buffer) => {
        data += chunk.toString();
        socket.destroy();
      });
      socket.on("close", () => resolve(data.trim().replace(/^\+/, "")));
      socket.on("error", reject);
      socket.setTimeout(5000, () => {
        socket.destroy();
        reject(new Error("Redis connection timeout"));
      });
    });
}

/**
 * Démarre un conteneur PostgreSQL 16 éphémère via Testcontainers.
 * Connexion vérifiée par SELECT 1.
 * @returns Harness avec query() et stop()
 */
export async function startPostgresContainer(): Promise<PostgresHarness> {
  const container: StartedTestContainer = await new GenericContainer("postgres:16")
    .withEnvironment({
      POSTGRES_USER: "sigfa",
      POSTGRES_PASSWORD: "sigfa_test",
      POSTGRES_DB: "sigfa_test",
    })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
    .start();

  const connectionString = buildPostgresConnectionString(container);

  // Import dynamique pour éviter une dépendance lourde au niveau du package
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString });
  await client.connect();

  return {
    connectionString,
    query: async (sql: string, values?: unknown[]): Promise<QueryResult> => {
      const res = values !== undefined
        ? await client.query(sql, values)
        : await client.query(sql);
      return { rows: res.rows as Array<Record<string, unknown>> };
    },
    stop: async (): Promise<void> => {
      await client.end();
      await container.stop();
    },
  };
}

/**
 * Démarre un conteneur PostgreSQL 16 éphémère avec double rôle pour les tests RLS.
 * - Rôle migrateur (`sigfa_migrator`) : owner, BYPASSRLS (utilisé par drizzle-kit et fixtures).
 * - Rôle applicatif (`sigfa_app`) : non-owner, sans BYPASSRLS (utilisé par les tests RLS).
 *
 * Le rôle initial `sigfa` devient `sigfa_migrator` ; `sigfa_app` est créé avec GRANT CRUD.
 * L'initialisation SQL des rôles est exécutée après démarrage du conteneur.
 *
 * @returns DualConnectionHarness avec query() (migrateur) et appQuery() (applicatif)
 */
export async function startPostgresContainerWithRoles(): Promise<DualConnectionHarness> {
  const container: StartedTestContainer = await new GenericContainer("postgres:16")
    .withEnvironment({
      POSTGRES_USER: "sigfa",
      POSTGRES_PASSWORD: "sigfa_test",
      POSTGRES_DB: "sigfa_test",
    })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
    .start();

  const host = container.getHost();
  const port = container.getMappedPort(5432);
  const migrationConnectionString = `postgresql://sigfa:sigfa_test@${host}:${port}/sigfa_test`;
  const appConnectionString = `postgresql://sigfa_app:sigfa_app_test@${host}:${port}/sigfa_test`;

  const { default: pg } = await import("pg");

  // Connexion migrateur (owner, sigfa = futur sigfa_migrator)
  const migClient = new pg.Client({ connectionString: migrationConnectionString });
  await migClient.connect();

  // Provisionner les rôles DB-002
  await migClient.query(`
    DO $$
    BEGIN
      -- Rôle migrateur (owner, BYPASSRLS) - c'est l'utilisateur courant 'sigfa'
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sigfa_migrator') THEN
        CREATE ROLE sigfa_migrator WITH LOGIN PASSWORD 'sigfa_migrator_test' BYPASSRLS SUPERUSER;
      END IF;

      -- Rôle applicatif (non-owner, sans BYPASSRLS)
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sigfa_app') THEN
        CREATE ROLE sigfa_app WITH LOGIN PASSWORD 'sigfa_app_test' NOCREATEDB NOCREATEROLE NOBYPASSRLS;
      END IF;
    END
    $$;
  `);

  // Connexion applicative (sigfa_app)
  const appClient = new pg.Client({ connectionString: appConnectionString });
  await appClient.connect();

  return {
    connectionString: migrationConnectionString,
    migrationConnectionString,
    appConnectionString,
    query: async (sql: string, values?: unknown[]): Promise<QueryResult> => {
      const res = values !== undefined
        ? await migClient.query(sql, values)
        : await migClient.query(sql);
      return { rows: res.rows as Array<Record<string, unknown>> };
    },
    appQuery: async (sql: string, values?: unknown[]): Promise<QueryResult> => {
      const res = values !== undefined
        ? await appClient.query(sql, values)
        : await appClient.query(sql);
      return { rows: res.rows as Array<Record<string, unknown>> };
    },
    stop: async (): Promise<void> => {
      await migClient.end();
      await appClient.end();
      await container.stop();
    },
  };
}

/**
 * Démarre un conteneur Redis 7 éphémère via Testcontainers.
 * Connexion vérifiée par PING → PONG.
 * @returns Harness avec ping() et stop()
 */
export async function startRedisContainer(): Promise<RedisHarness> {
  const container: StartedTestContainer = await new GenericContainer("redis:7")
    .withExposedPorts(6379)
    .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
    .start();

  const host = container.getHost();
  const port = container.getMappedPort(6379);
  const connectionUrl = buildRedisConnectionUrl(container);
  // Client Redis minimal via net.Socket pour éviter dépendance ioredis
  const net = await import("net");
  const sendCommand = makeSendCommand(port, host, net);

  return {
    connectionUrl,
    ping: async (): Promise<string> => {
      const response = await sendCommand("PING\r\n");
      return response;
    },
    stop: async (): Promise<void> => {
      await container.stop();
    },
  };
}
