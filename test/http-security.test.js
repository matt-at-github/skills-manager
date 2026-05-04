import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import http from "node:http";
import { createServer } from "../src/server.js";

function rawRequest({ port, method = "GET", path = "/", headers = {}, body }) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, method, path, headers },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () =>
          resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }),
        );
      },
    );
    req.on("error", reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

async function findFreePort() {
  return await new Promise((resolve, reject) => {
    const s = net.createServer();
    s.unref();
    s.on("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

let server;
let port;
let baseUrl;

before(async () => {
  port = await findFreePort();
  server = createServer({ port });
  baseUrl = `http://localhost:${port}`;
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

test("GET / from same origin returns index.html", async () => {
  const res = await fetch(`${baseUrl}/`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /text\/html/);
});

test("GET / with attacker Host header is rejected 403", async () => {
  const res = await rawRequest({
    port,
    headers: { Host: `evil.example.com:${port}` },
  });
  assert.equal(res.status, 403);
});

test("GET / with mismatched Host port is rejected 403", async () => {
  const res = await rawRequest({
    port,
    headers: { Host: `localhost:1` },
  });
  assert.equal(res.status, 403);
});

test("POST with foreign Origin is rejected 403", async () => {
  const res = await fetch(`${baseUrl}/write`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "http://evil.example.com",
    },
    body: JSON.stringify({ path: "/tmp/x", content: "" }),
  });
  assert.equal(res.status, 403);
});

test("POST with matching Origin passes security (route not implemented → 405)", async () => {
  const res = await fetch(`${baseUrl}/write`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: baseUrl,
    },
    body: JSON.stringify({ path: "/tmp/x", content: "" }),
  });
  assert.equal(res.status, 405);
});

test("POST with no Origin and no Referer is rejected 403", async () => {
  const res = await fetch(`${baseUrl}/write`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(res.status, 403);
});
