import { createServer } from "http";
import { Server } from "socket.io";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";

/** Harness Socket.io éphémère pour tests realtime */
export interface RealtimeHarness {
  /**
   * Mesure la latence aller-simple d'un événement Socket.io local.
   * @param emitEvent - Nom de l'événement émis par le client
   * @param ackEvent - Nom de l'événement retourné par le serveur
   * @returns Latence en millisecondes
   */
  measureEventLatency: (emitEvent: string, ackEvent: string) => Promise<number>;
  /** Arrête le serveur et déconnecte le client */
  teardown: () => Promise<void>;
}

/**
 * Crée un harness Socket.io éphémère avec serveur et client de test.
 * Le serveur renvoie l'événement entrant avec le nom ackEvent configuré.
 * @returns Harness avec measureEventLatency() et teardown()
 */
export async function createRealtimeHarness(): Promise<RealtimeHarness> {
  const httpServer = createServer();
  const ioServer = new Server(httpServer, {
    cors: { origin: "*" },
  });

  // Le serveur écoute tous les événements et les renvoie en ack
  ioServer.on("connection", (socket) => {
    socket.onAny((event: string, ...args: unknown[]) => {
      const ackEventName = `${event.replace(/:ping$/, ":pong")}`;
      socket.emit(ackEventName, ...args);
    });
  });

  await new Promise<void>((resolve) => {
    httpServer.listen(0, "127.0.0.1", resolve);
  });

  const address = httpServer.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to bind HTTP server");
  }
  const port = address.port;
  const serverUrl = `http://127.0.0.1:${port}`;

  const clientSocket: ClientSocket = ioClient(serverUrl, {
    transports: ["websocket"],
  });

  await new Promise<void>((resolve, reject) => {
    clientSocket.on("connect", resolve);
    clientSocket.on("connect_error", reject);
    setTimeout(() => reject(new Error("Socket.io connect timeout")), 10_000);
  });

  return {
    measureEventLatency: (emitEvent: string, ackEvent: string): Promise<number> =>
      new Promise((resolve, reject) => {
        const start = performance.now();
        clientSocket.once(ackEvent, () => {
          resolve(performance.now() - start);
        });
        clientSocket.emit(emitEvent, { ts: start });
        setTimeout(() => reject(new Error(`Timeout waiting for ${ackEvent}`)), 5_000);
      }),

    teardown: async (): Promise<void> => {
      clientSocket.disconnect();
      ioServer.close();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    },
  };
}
