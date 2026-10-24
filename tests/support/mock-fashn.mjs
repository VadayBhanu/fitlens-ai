// A tiny stand-in for the FASHN API used by automated tests (never in production).
// Predictions report "processing" on the first status poll and "completed" after.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export function startMockFashn({ port, imageDir, apiKey = "test-fashn-key" }) {
  const img = (n) => readFileSync(join(imageDir, n));
  const predictions = new Map();
  const state = { lastRunBody: null, runs: 0 };
  let seq = 0;
  const server = createServer((req, res) => {
    const send = (code, body, type = "application/json") => {
      res.writeHead(code, { "Content-Type": type });
      res.end(type === "application/json" ? JSON.stringify(body) : body);
    };
    if (req.method === "POST" && req.url === "/v1/run") {
      let data = "";
      req.on("data", (c) => (data += c));
      req.on("end", () => {
        if (req.headers.authorization !== `Bearer ${apiKey}`) return send(401, { error: { name: "Unauthorized", message: "bad key" } });
        state.lastRunBody = JSON.parse(data);
        state.runs++;
        const id = `mock-pred-${++seq}`;
        predictions.set(id, 0);
        send(200, { id, error: null });
      });
      return;
    }
    const m = req.url?.match(/^\/v1\/status\/(.+)$/);
    if (req.method === "GET" && m) {
      const id = decodeURIComponent(m[1]);
      if (!predictions.has(id)) return send(404, { error: "unknown prediction" });
      const n = predictions.get(id) + 1;
      predictions.set(id, n);
      return send(200, n < 2 ? { id, status: "processing", output: null, error: null } : { id, status: "completed", output: [`http://127.0.0.1:${port}/out.png`], error: null });
    }
    if (req.url === "/out.png") return send(200, img("crew-tee-white.png"), "image/png");
    if (req.url === "/img/jacket.png") return send(200, img("denim-jacket-indigo.png"), "image/png");
    send(404, { error: "not found" });
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve({ server, state, close: () => server.close() })));
}
