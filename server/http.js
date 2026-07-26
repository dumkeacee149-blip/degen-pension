import { getServerConfig } from "./config.js";

const rateWindows = new Map();

export class ApiError extends Error {
  constructor(status, code, message, details = undefined) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function header(req, name) {
  if (typeof req.headers?.get === "function") return req.headers.get(name);
  const value = req.headers?.[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

export function getClientIp(req) {
  const forwarded = header(req, "x-vercel-forwarded-for") || header(req, "x-forwarded-for");
  return String(forwarded || req.socket?.remoteAddress || "unknown").split(",")[0].trim();
}

export function getTrustedCountry(req) {
  const country = String(header(req, "x-vercel-ip-country") || "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(country) ? country : null;
}

function applyCommonHeaders(req, res, config) {
  const origin = String(header(req, "origin") || "");
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("referrer-policy", "no-referrer");
  res.setHeader("vary", "Origin");
  if (origin && config.corsAllowedOrigins.has(origin)) {
    res.setHeader("access-control-allow-origin", origin);
    res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
    res.setHeader("access-control-allow-headers", "content-type, x-request-id");
  }
  return origin;
}

function consumeRateLimit(key, maximum, windowMs) {
  const now = Date.now();
  const current = rateWindows.get(key);
  if (!current || current.resetAt <= now) {
    rateWindows.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: maximum - 1, resetAt: now + windowMs };
  }
  current.count += 1;
  return {
    allowed: current.count <= maximum,
    remaining: Math.max(0, maximum - current.count),
    resetAt: current.resetAt,
  };
}

async function readJson(req, maximumBytes = 16_384) {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === "string") {
    if (Buffer.byteLength(req.body) > maximumBytes) throw new ApiError(413, "BODY_TOO_LARGE", "Request body is too large.");
    try {
      return JSON.parse(req.body);
    } catch {
      throw new ApiError(400, "INVALID_JSON", "Request body must be valid JSON.");
    }
  }

  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (Buffer.byteLength(body) > maximumBytes) {
      throw new ApiError(413, "BODY_TOO_LARGE", "Request body is too large.");
    }
  }
  if (!body) return {};
  try {
    return JSON.parse(body);
  } catch {
    throw new ApiError(400, "INVALID_JSON", "Request body must be valid JSON.");
  }
}

function send(res, status, payload, headers = {}) {
  for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
  res.statusCode = status;
  res.end(JSON.stringify(payload));
}

export function createApiHandler({
  name,
  methods,
  rateLimit = 30,
  rateWindowMs = 60_000,
  cacheControl = "no-store",
  body = false,
}, action) {
  const allowedMethods = new Set(methods);
  return async function apiHandler(req, res) {
    const config = getServerConfig();
    const origin = applyCommonHeaders(req, res, config);
    res.setHeader("cache-control", cacheControl);

    if (req.method === "OPTIONS") {
      if (origin && !config.corsAllowedOrigins.has(origin)) {
        return send(res, 403, { ok: false, error: { code: "ORIGIN_DENIED", message: "Origin is not allowed." } });
      }
      res.statusCode = 204;
      return res.end();
    }

    if (origin && !config.corsAllowedOrigins.has(origin)) {
      return send(res, 403, { ok: false, error: { code: "ORIGIN_DENIED", message: "Origin is not allowed." } });
    }
    if (!allowedMethods.has(req.method)) {
      res.setHeader("allow", [...allowedMethods].join(", "));
      return send(res, 405, { ok: false, error: { code: "METHOD_NOT_ALLOWED", message: "Method is not allowed." } });
    }

    const rate = consumeRateLimit(`${name}:${getClientIp(req)}`, rateLimit, rateWindowMs);
    res.setHeader("x-ratelimit-limit", String(rateLimit));
    res.setHeader("x-ratelimit-remaining", String(rate.remaining));
    res.setHeader("x-ratelimit-reset", String(Math.ceil(rate.resetAt / 1_000)));
    if (!rate.allowed) {
      res.setHeader("retry-after", String(Math.max(1, Math.ceil((rate.resetAt - Date.now()) / 1_000))));
      return send(res, 429, { ok: false, error: { code: "RATE_LIMITED", message: "Too many requests." } });
    }

    try {
      const requestBody = body ? await readJson(req) : undefined;
      const result = await action({
        req,
        body: requestBody,
        config,
        clientIp: getClientIp(req),
        country: getTrustedCountry(req),
      });
      return send(res, result?.status || 200, result?.body ?? result, result?.headers);
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.status >= 500) {
          console.error(`[${name}] ${error.code}: ${error.message}`);
          return send(res, error.status, {
            ok: false,
            error: {
              code: "SERVICE_UNAVAILABLE",
              message: "The service is temporarily unavailable.",
            },
          });
        }
        return send(res, error.status, {
          ok: false,
          error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) },
        });
      }
      console.error(`[${name}]`, error instanceof Error ? error.message : "Unknown server error");
      return send(res, 500, {
        ok: false,
        error: { code: "INTERNAL_ERROR", message: "The service failed closed." },
      });
    }
  };
}

export function __resetRateLimitsForTests() {
  rateWindows.clear();
}
