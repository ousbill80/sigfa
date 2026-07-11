import { GenericContainer, StartedTestContainer, Wait } from "testcontainers";

/** Résultat d'une requête PostgreSQL */
export interface QueryResult {
  rows: Array<Record<string, unknown>>;
}

/** Harness PostgreSQL éphémère (Testcontainers) */
export interface PostgresHarness {
  /** Exécute une requête SQL et retourne les lignes */
  query: (sql: string) => Promise<QueryResult>;
  /** Arrête le conteneur */
  stop: () => Promise<void>;
  /** URL de connexion */
  connectionString: string;
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
    query: async (sql: string): Promise<QueryResult> => {
      const res = await client.query(sql);
      return { rows: res.rows as Array<Record<string, unknown>> };
    },
    stop: async (): Promise<void> => {
      await client.end();
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
