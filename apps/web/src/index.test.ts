import { describe, it, expect, afterAll } from "vitest";
import * as http from "node:http";
import { createServer } from "./index.js";

describe("@sigfa/web", () => {
  let server: http.Server;
  let port: number;

  it("responds 200 with SIGFA web skeleton", async () => {
    server = createServer();
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address() as { port: number };
    port = address.port;

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

  afterAll(() => {
    server?.close();
  });
});
