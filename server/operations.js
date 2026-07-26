import {
  createHmac,
  createHash,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { ApiError } from "./errors.js";
import { checkStockAssetRegistry } from "./asset-registry.js";
import { hasStrongSecret } from "./config.js";
import {
  checkStatsIndexerHealth,
  isStatsIndexerConfigured,
} from "./stats-indexer.js";
import {
  readLimitedBytes,
  readLimitedText,
} from "./response.js";

const auditVerificationCache = new Map();
const readinessCache = new Map();

function validToken(value) {
  return typeof value === "string" && value.length >= 16;
}

function configuredUrlSecret(url, token, secret) {
  return Boolean(url) && validToken(token) && hasStrongSecret(secret);
}

export function isExternalEligibilityConfigured(config) {
  return config.eligibilityProviderMode === "external"
    && Boolean(config.eligibilityProviderUrl)
    && validToken(config.eligibilityProviderApiKey)
    && hasStrongSecret(config.eligibilityProviderRequestSecret)
    && hasStrongSecret(config.eligibilitySigningSecret);
}

export function isDistributedRateLimitConfigured(config) {
  return configuredUrlSecret(
    config.rateLimitProviderUrl,
    config.rateLimitProviderToken,
    config.rateLimitProviderHmacSecret,
  );
}

export function isMonitoringConfigured(config) {
  return configuredUrlSecret(
    config.monitoringWebhookUrl,
    config.monitoringWebhookToken,
    config.monitoringWebhookHmacSecret,
  );
}

export function isIndependentAuditConfigured(config) {
  const completedAt = Date.parse(config.independentAuditCompletedAt || "");
  return Boolean(config.independentAuditReportUrl)
    && /^[a-f0-9]{64}$/.test(config.independentAuditSha256 || "")
    && config.independentAuditFirm.length >= 2
    && Number.isFinite(completedAt)
    && completedAt <= Date.now();
}

async function verifyIndependentAudit(config, { fetchImpl = fetch } = {}) {
  if (!isIndependentAuditConfigured(config)) return false;
  const cacheKey = `${config.independentAuditReportUrl}:${config.independentAuditSha256}`;
  const cached = auditVerificationCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.verified;
  let verified = false;
  try {
    const response = await fetchImpl(config.independentAuditReportUrl, {
      method: "GET",
      headers: { accept: "application/pdf" },
      redirect: "error",
      signal: AbortSignal.timeout(config.independentAuditTimeoutMs),
    });
    const contentLength = Number(response.headers.get("content-length") || 0);
    if (
      !response.ok
      || !String(response.headers.get("content-type") || "").toLowerCase().startsWith("application/pdf")
      || (Number.isFinite(contentLength) && contentLength > config.independentAuditMaxBytes)
    ) {
      throw new Error("audit report unavailable");
    }
    const bytes = await readLimitedBytes(response, config.independentAuditMaxBytes);
    if (bytes.subarray(0, 5).toString("ascii") !== "%PDF-") {
      throw new Error("audit report invalid");
    }
    verified = createHash("sha256").update(bytes).digest("hex") === config.independentAuditSha256;
  } catch {
    verified = false;
  }
  auditVerificationCache.set(cacheKey, {
    verified,
    expiresAt: Date.now() + (verified ? 3_600_000 : config.operationsHealthCacheSeconds * 1_000),
  });
  return verified;
}

function developmentEligibilityConfigured(config) {
  const provider = config.eligibilityProviderMode === "geo_attestation"
    || isExternalEligibilityConfigured(config);
  return provider && hasStrongSecret(config.eligibilitySigningSecret);
}

export async function checkOperationalReadiness(config, { fetchImpl = fetch } = {}) {
  const cacheKey = [
    config.vercelEnvironment,
    config.eligibilityProviderMode,
    config.eligibilityProviderUrl,
    isExternalEligibilityConfigured(config),
    config.statsIndexerUrl,
    isStatsIndexerConfigured(config),
    config.rateLimitProviderUrl,
    isDistributedRateLimitConfigured(config),
    config.monitoringWebhookUrl,
    isMonitoringConfigured(config),
    config.independentAuditReportUrl,
    config.independentAuditSha256,
    config.stockAssetRegistryCheckEnabled,
  ].join(":");
  const cached = readinessCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const production = config.vercelEnvironment === "production";
  const statsIndexerConfigured = isStatsIndexerConfigured(config);
  const [
    statsIndexerHealthy,
    independentAuditVerified,
    distributedRateLimitHealthy,
    monitoringHealthy,
    stockAssetRegistry,
  ] = await Promise.all([
    statsIndexerConfigured ? checkStatsIndexerHealth(config, { fetchImpl }) : false,
    verifyIndependentAudit(config, { fetchImpl }),
    checkSignedOperationalHealth(config, "rate-limit", { fetchImpl }),
    checkSignedOperationalHealth(config, "monitoring", { fetchImpl }),
    checkStockAssetRegistry(config, { fetchImpl }),
  ]);
  const checks = {
    eligibilityProvider: production
      ? isExternalEligibilityConfigured(config)
      : developmentEligibilityConfigured(config),
    statsIndexer: statsIndexerConfigured && statsIndexerHealthy,
    distributedRateLimit: distributedRateLimitHealthy,
    monitoring: monitoringHealthy,
    independentAudit: independentAuditVerified,
    stockAssetRegistry: stockAssetRegistry.verified,
  };
  const value = {
    checks,
    publicValue: {
      environment: config.vercelEnvironment,
      eligibilityProviderMode: config.eligibilityProviderMode,
      eligibilityExternalRequired: production,
      statsIndexer: {
        configured: statsIndexerConfigured,
        healthy: statsIndexerHealthy,
        boundedFallbackEnabled: config.allowBoundedStatsFallback === true,
      },
      distributedRateLimitHealthy: checks.distributedRateLimit,
      monitoringHealthy: checks.monitoring,
      independentAuditVerified: checks.independentAudit,
      stockAssetRegistry,
    },
  };
  readinessCache.set(cacheKey, {
    value,
    expiresAt: Date.now() + config.operationsHealthCacheSeconds * 1_000,
  });
  return value;
}

export function __resetOperationalCachesForTests() {
  auditVerificationCache.clear();
  readinessCache.clear();
}

function hmac(secret, value) {
  return createHmac("sha256", secret).update(value).digest("hex");
}

function safeEqualHex(left, right) {
  if (!/^[a-f0-9]{64}$/i.test(left || "") || !/^[a-f0-9]{64}$/i.test(right || "")) return false;
  const supplied = Buffer.from(left, "hex");
  const expected = Buffer.from(right, "hex");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

async function signedPost({ url, token, secret, timeoutMs, payload, fetchImpl }) {
  const timestamp = String(Math.floor(Date.now() / 1_000));
  const requestId = randomUUID();
  const body = JSON.stringify({ ...payload, requestId });
  let response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      redirect: "error",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "x-degen-request-timestamp": timestamp,
        "x-degen-request-signature": `sha256=${hmac(secret, `${timestamp}.${body}`)}`,
      },
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new ApiError(503, "OPERATIONAL_SERVICE_UNAVAILABLE", "An operational dependency did not respond.");
  }
  let raw;
  try {
    raw = await readLimitedText(response, 16_384);
  } catch {
    throw new ApiError(503, "OPERATIONAL_SERVICE_UNAVAILABLE", "An operational dependency returned too much data.");
  }
  if (!response.ok) {
    throw new ApiError(503, "OPERATIONAL_SERVICE_UNAVAILABLE", "An operational dependency rejected the request.");
  }
  const responseTimestamp = response.headers.get("x-degen-service-timestamp");
  const suppliedSignature = String(response.headers.get("x-degen-service-signature") || "")
    .replace(/^sha256=/i, "");
  const timestampSeconds = Number(responseTimestamp);
  if (
    !Number.isSafeInteger(timestampSeconds)
    || Math.abs(Math.floor(Date.now() / 1_000) - timestampSeconds) > 60
    || !safeEqualHex(suppliedSignature, hmac(secret, `${responseTimestamp}.${raw}`))
  ) {
    throw new ApiError(503, "OPERATIONAL_SERVICE_UNTRUSTED", "An operational dependency returned an invalid signature.");
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ApiError(503, "OPERATIONAL_SERVICE_INVALID", "An operational dependency returned invalid JSON.");
  }
  if (parsed?.requestId !== requestId) {
    throw new ApiError(503, "OPERATIONAL_SERVICE_MISMATCH", "An operational dependency returned a mismatched decision.");
  }
  return parsed;
}

async function checkSignedOperationalHealth(config, service, { fetchImpl = fetch } = {}) {
  const isRateLimit = service === "rate-limit";
  const configured = isRateLimit
    ? isDistributedRateLimitConfigured(config)
    : isMonitoringConfigured(config);
  if (!configured) return false;
  try {
    const result = await signedPost({
      url: isRateLimit ? config.rateLimitProviderUrl : config.monitoringWebhookUrl,
      token: isRateLimit ? config.rateLimitProviderToken : config.monitoringWebhookToken,
      secret: isRateLimit ? config.rateLimitProviderHmacSecret : config.monitoringWebhookHmacSecret,
      timeoutMs: isRateLimit ? config.rateLimitTimeoutMs : config.monitoringTimeoutMs,
      payload: { schemaVersion: 1, operation: "health" },
      fetchImpl,
    });
    return result?.schemaVersion === 1 && result?.ok === true;
  } catch {
    return false;
  }
}

export async function consumeDistributedRateLimit(config, {
  key,
  maximum,
  windowMs,
  fetchImpl = fetch,
}) {
  if (!isDistributedRateLimitConfigured(config)) {
    throw new ApiError(503, "DISTRIBUTED_RATE_LIMIT_NOT_CONFIGURED", "Distributed rate limiting is required.");
  }
  const payload = await signedPost({
    url: config.rateLimitProviderUrl,
    token: config.rateLimitProviderToken,
    secret: config.rateLimitProviderHmacSecret,
    timeoutMs: config.rateLimitTimeoutMs,
    payload: {
      schemaVersion: 1,
      operation: "consume",
      key: hmac(config.rateLimitProviderHmacSecret, key),
      maximum,
      windowMs,
    },
    fetchImpl,
  });
  const remaining = Number(payload.remaining);
  const resetAt = Number(payload.resetAt);
  if (
    payload.schemaVersion !== 1
    || typeof payload.allowed !== "boolean"
    || !Number.isSafeInteger(remaining)
    || remaining < 0
    || !Number.isSafeInteger(resetAt)
    || resetAt <= Date.now()
  ) {
    throw new ApiError(503, "DISTRIBUTED_RATE_LIMIT_INVALID", "Distributed rate limiter returned an invalid decision.");
  }
  return { allowed: payload.allowed, remaining, resetAt };
}

export async function emitMonitoringEvent(config, event, { fetchImpl = fetch } = {}) {
  if (!isMonitoringConfigured(config)) return false;
  try {
    await signedPost({
      url: config.monitoringWebhookUrl,
      token: config.monitoringWebhookToken,
      secret: config.monitoringWebhookHmacSecret,
      timeoutMs: config.monitoringTimeoutMs,
      payload: {
        schemaVersion: 1,
        eventId: randomUUID(),
        emittedAt: new Date().toISOString(),
        environment: config.vercelEnvironment,
        ...event,
      },
      fetchImpl,
    });
    return true;
  } catch {
    return false;
  }
}
