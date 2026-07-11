import * as http from "node:http";

export function createServer(): http.Server {
  return http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("SIGFA api skeleton");
  });
}

/**
 * Démarre le serveur HTTP sur le port configuré (API_PORT ou 3001).
 * Appelée directement quand le fichier est le point d'entrée principal.
 */
export function startServer(): http.Server {
  const port = Number(process.env["API_PORT"] ?? "3001");
  const server = createServer();
  server.listen(port, () => {
    console.log(`SIGFA api skeleton running on port ${port}`);
  });
  return server;
}

// Démarrage automatique uniquement en tant que point d'entrée principal.
/* c8 ignore next 3 */
if (process.argv[1] === new URL(import.meta.url).pathname) {
  startServer();
}
