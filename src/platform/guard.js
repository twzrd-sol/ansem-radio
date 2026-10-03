/**
 * Request guards for the local platform service (docs/PLATFORM_V0.md). The service is for
 * this machine only until a separate decision says otherwise, so every request must come
 * from loopback, name loopback in its Host header (which also stops DNS rebinding), carry
 * no proxy headers, and, when a browser sent it, come from this page's own origin.
 */

const LOOPBACK_ADDRESSES = ["127.0.0.1", "::1", "::ffff:127.0.0.1"];

export class HttpError extends Error {
  constructor(status, code, message = code) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
  }
}

/** True only for a Host header naming this machine. */
export function isLoopbackHost(hostHeader) {
  if (typeof hostHeader !== "string") return false;
  const match = /^(\[[0-9a-f:]+\]|[^:\s]+)(?::\d{1,5})?$/i.exec(hostHeader.trim());
  if (!match) return false;
  const host = match[1].toLowerCase();
  return host === "127.0.0.1" || host === "localhost" || host === "[::1]";
}

/** No proxy is trusted: a request that went through one is refused rather than believed. */
export function isLocalRequest(request) {
  const h = request.headers;
  if (!LOOPBACK_ADDRESSES.includes(request.socket?.remoteAddress) || !isLoopbackHost(h.host)) return false;
  if (Object.keys(h).some((key) => key === "forwarded" || key.startsWith("x-forwarded-") || key === "x-real-ip" || key === "via")) return false;
  if (h["sec-fetch-site"] && !["same-origin", "none"].includes(h["sec-fetch-site"])) return false;
  if (h.origin) {
    try {
      if (new URL(h.origin).origin !== `http://${h.host.toLowerCase()}`) return false;
    } catch {
      return false;
    }
  }
  return true;
}

/** Read a JSON object body of at most `limit` bytes. JSON content type only, so a cross-site form cannot post. */
export async function readJson(request, limit = 16_384) {
  const type = String(request.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
  if (type !== "application/json") throw new HttpError(415, "content_type_must_be_json");
  const declared = Number(request.headers["content-length"]);
  if (Number.isFinite(declared) && declared > limit) throw new HttpError(413, "body_too_large");
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, "body_too_large");
    chunks.push(chunk);
  }
  let parsed;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "invalid_json");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new HttpError(400, "body_must_be_an_object");
  return parsed;
}

/** A small fixed-window limiter per client key: `limit` requests per `windowMs`. */
export function createRateLimiter({ limit = 30, windowMs = 60_000, clock = Date.now } = {}) {
  const windows = new Map();
  return (key) => {
    const now = clock();
    const current = windows.get(key);
    if (!current || now - current.start >= windowMs) {
      windows.set(key, { start: now, count: 1 });
      if (windows.size > 1000) for (const [k, v] of windows) if (now - v.start >= windowMs) windows.delete(k);
      return true;
    }
    current.count += 1;
    return current.count <= limit;
  };
}
