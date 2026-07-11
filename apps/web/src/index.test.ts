import { describe, it, expect, afterAll } from "vitest";
import * as http from "node:http";
import { createServer, startServer } from "./index.js";

describe("@sigfa/web", () => {
  const servers: http.Server[] = [];

  it("INFRA-001: responds 200 with SIGFA web skeleton", async () => {
    const server = createServer();
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address() as { port: number };
    const port = address.port;

    const body = await new Promise<string>((resolve, reject) => {
      http.get(`http://localhost:${port}/`, (res) => {
        expect(res.statusCode).toBe(200);
        let data = "";
        res.on("data", (chunk: string) => (data += chunk));
        res.on("end", () => resolve(data));
      }).on("error", reject);
    });

    expect(body).toBe("SIGFA web skeleton");
  });

  it("INFRA-007: startServer démarre le serveur sur WEB_PORT", async () => {
    const originalPort = process.env["WEB_PORT"];
    process.env["WEB_PORT"] = "29802";
    const server = startServer();
    servers.push(server);
    await new Promise<void>((resolve) => {
      if (server.listening) { resolve(); } else { server.once("listening", resolve); }
    });
    expect(server.listening).toBe(true);
    process.env["WEB_PORT"] = originalPort;
  });

  afterAll(() => {
    servers.forEach((s) => s?.close());
  });
});
