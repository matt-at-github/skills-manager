import { test } from "node:test";
import assert from "node:assert/strict";
import { check } from "../src/requestSecurity.js";

const EXPECTED = "http://localhost:7842";

function req(method, headers) {
  return { method, headers, url: "/" };
}

test("accepts GET with localhost host header", () => {
  const r = check(req("GET", { host: "localhost:7842" }), EXPECTED);
  assert.equal(r.ok, true);
});

test("accepts GET with 127.0.0.1 host header", () => {
  const r = check(req("GET", { host: "127.0.0.1:7842" }), EXPECTED);
  assert.equal(r.ok, true);
});

test("rejects host header pointing at attacker domain", () => {
  const r = check(req("GET", { host: "evil.example.com:7842" }), EXPECTED);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "host_not_localhost");
});

test("rejects host header on wrong port", () => {
  const r = check(req("GET", { host: "localhost:9999" }), EXPECTED);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "host_port_mismatch");
});

test("rejects missing host header", () => {
  const r = check(req("GET", {}), EXPECTED);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "bad_host_header");
});

test("rejects host header without port", () => {
  const r = check(req("GET", { host: "localhost" }), EXPECTED);
  assert.equal(r.ok, false);
});

test("accepts POST with matching Origin", () => {
  const r = check(
    req("POST", { host: "localhost:7842", origin: "http://localhost:7842" }),
    EXPECTED,
  );
  assert.equal(r.ok, true);
});

test("rejects POST with foreign Origin", () => {
  const r = check(
    req("POST", { host: "localhost:7842", origin: "http://evil.example.com" }),
    EXPECTED,
  );
  assert.equal(r.ok, false);
  assert.equal(r.reason, "origin_mismatch");
});

test("rejects POST with no Origin and no Referer", () => {
  const r = check(req("POST", { host: "localhost:7842" }), EXPECTED);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "missing_origin");
});

test("accepts POST with matching Referer when Origin missing", () => {
  const r = check(
    req("POST", { host: "localhost:7842", referer: "http://localhost:7842/index.html" }),
    EXPECTED,
  );
  assert.equal(r.ok, true);
});

test("rejects POST with foreign Referer when Origin missing", () => {
  const r = check(
    req("POST", { host: "localhost:7842", referer: "http://evil.example.com/x" }),
    EXPECTED,
  );
  assert.equal(r.ok, false);
  assert.equal(r.reason, "referer_mismatch");
});

test("Origin mismatch wins over Referer fallback", () => {
  const r = check(
    req("POST", {
      host: "localhost:7842",
      origin: "http://evil.example.com",
      referer: "http://localhost:7842/",
    }),
    EXPECTED,
  );
  assert.equal(r.ok, false);
  assert.equal(r.reason, "origin_mismatch");
});

test("HEAD treated as safe (no origin required)", () => {
  const r = check(req("HEAD", { host: "localhost:7842" }), EXPECTED);
  assert.equal(r.ok, true);
});
