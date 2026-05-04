const ALLOWED_HOSTS = new Set(["localhost", "127.0.0.1"]);
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function parseHost(headerValue) {
  if (typeof headerValue !== "string" || headerValue.length === 0) {
    return null;
  }
  const lastColon = headerValue.lastIndexOf(":");
  if (lastColon === -1) {
    return { host: headerValue, port: null };
  }
  const host = headerValue.slice(0, lastColon);
  const portStr = headerValue.slice(lastColon + 1);
  const port = Number(portStr);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    return null;
  }
  return { host, port };
}

function parseOrigin(headerValue) {
  if (typeof headerValue !== "string" || headerValue.length === 0) {
    return null;
  }
  try {
    const u = new URL(headerValue);
    return u;
  } catch {
    return null;
  }
}

function originFromReferer(headerValue) {
  const u = parseOrigin(headerValue);
  if (!u) return null;
  return `${u.protocol}//${u.host}`;
}

export function check(req, expectedOrigin) {
  const expected = parseOrigin(expectedOrigin);
  if (!expected) {
    return { ok: false, reason: "bad_expected_origin" };
  }
  const expectedPort = Number(expected.port);

  const hostHeader = req.headers?.host;
  const parsedHost = parseHost(hostHeader);
  if (!parsedHost) {
    return { ok: false, reason: "bad_host_header" };
  }
  if (!ALLOWED_HOSTS.has(parsedHost.host)) {
    return { ok: false, reason: "host_not_localhost" };
  }
  if (parsedHost.port !== expectedPort) {
    return { ok: false, reason: "host_port_mismatch" };
  }

  const method = (req.method ?? "GET").toUpperCase();
  if (SAFE_METHODS.has(method)) {
    return { ok: true };
  }

  const expectedOriginNorm = `${expected.protocol}//${expected.host}`;
  const originHeader = req.headers?.origin;
  if (typeof originHeader === "string" && originHeader.length > 0) {
    if (originHeader !== expectedOriginNorm) {
      return { ok: false, reason: "origin_mismatch" };
    }
    return { ok: true };
  }
  const refererHeader = req.headers?.referer;
  const refererOrigin = originFromReferer(refererHeader);
  if (refererOrigin) {
    if (refererOrigin !== expectedOriginNorm) {
      return { ok: false, reason: "referer_mismatch" };
    }
    return { ok: true };
  }
  return { ok: false, reason: "missing_origin" };
}
