import * as http from "node:http";

export function createServer(): http.Server {
  return http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("SIGFA api skeleton");
  });
}

// Start server only when this file is the main entry point
const isMain = process.argv[1] === new URL(import.meta.url).pathname;
if (isMain) {
  const port = Number(process.env["API_PORT"] ?? "3001");
  const server = createServer();
  server.listen(port, () => {
    console.log(`SIGFA api skeleton running on port ${port}`);
  });
}
