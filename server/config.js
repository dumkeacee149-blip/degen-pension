import { getAddress, isAddress } from "viem";
import {
  CANONICAL_QQQ,
  CANONICAL_QUOTER,
  ROBINHOOD_CHAIN_ID,
  ROBINHOOD_ASSET_REGISTRY_URL,
  ROBINHOOD_EXPLORER_URL,
  ROBINHOOD_RPC_URL,
} from "./constants.js";

function text(value, fallback = "") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function address(value, fallback = "") {
  const normalized = text(value, fallback);
  return isAddress(normalized) ? getAddress(normalized) : null;
}

function integer(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

function bigintValue(value, fallback) {
  try {
    const parsed = BigInt(String(value ?? ""));
    return parsed >= 0n ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function boolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function serviceUrl(value, { production = false } = {}) {
  const normalized = text(value);
  if (!normalized) return null;
  try {
    const parsed = new URL(normalized);
    const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    const localDevelopment = !production
      && parsed.protocol === "http:"
      && ["127.0.0.1", "localhost", "::1"].includes(hostname);
    if (parsed.protocol !== "https:" && !localDevelopment) return null;
    if (parsed.username || parsed.password || parsed.hash) return null;
    if (production) {
      if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
        return null;
      }
      const ipv4 = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
      if (ipv4) {
        const octets = ipv4.slice(1).map(Number);
        const [a, b] = octets;
        if (
          octets.some((octet) => octet > 255)
          || a === 0
          || a === 10
          || a === 127
          || (a === 100 && b >= 64 && b <= 127)
          || (a === 169 && b === 254)
          || (a === 172 && b >= 16 && b <= 31)
          || (a === 192 && b === 168)
          || a >= 224
        ) return null;
      }
      if (hostname === "::1" || /^f[cd][a-f0-9:]*$/i.test(hostname) || /^fe[89ab][a-f0-9:]*$/i.test(hostname)) {
        return null;
      }
    }
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function sha256Digest(value) {
  const normalized = text(value).toLowerCase();
  return /^[a-f0-9]{64}$/.test(normalized) ? normalized : null;
}

function gitCommit(value) {
  const normalized = text(value).toLowerCase();
  return /^[a-f0-9]{40}$/.test(normalized) ? normalized : null;
}

function hexBytes(value) {
  const normalized = text(value);
  return /^0x(?:[a-fA-F0-9]{2})+$/.test(normalized) ? normalized.toLowerCase() : null;
}

function privateKey(value) {
  const normalized = text(value);
  return /^0x[a-fA-F0-9]{64}$/.test(normalized) ? normalized : null;
}

function origins(value) {
  const defaults = [
    "https://degen-pension.vercel.app",
    "http://127.0.0.1:5173",
    "http://localhost:5173",
  ];
  const configured = text(value)
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return new Set(configured.length ? configured : defaults);
}

function countries(value, fallback) {
  const configured = text(value, fallback)
    .split(",")
    .map((entry) => entry.trim().toUpperCase())
    .filter((entry) => /^[A-Z]{2}$/.test(entry));
  return new Set(configured);
}

export function getServerConfig(env = process.env) {
  const vercelEnvironment = text(env.VERCEL_ENV, "development").toLowerCase();
  const production = vercelEnvironment === "production";
  const configuredRegistry = address(env.REGISTRY_ADDRESS);
  return Object.freeze({
    chainId: ROBINHOOD_CHAIN_ID,
    rpcUrl: production
      ? ROBINHOOD_RPC_URL
      : serviceUrl(env.ROBINHOOD_RPC_URL || ROBINHOOD_RPC_URL, { production }) || ROBINHOOD_RPC_URL,
    explorerUrl: serviceUrl(env.BLOCKSCOUT_URL || ROBINHOOD_EXPLORER_URL, { production })
      || ROBINHOOD_EXPLORER_URL,
    registryAddress: configuredRegistry,
    factoryAddress: address(env.FACTORY_ADDRESS),
    expectedAuthority: address(env.PROJECT_AUTHORITY_ADDRESS),
    expectedImplementation: address(env.GATEWAY_IMPLEMENTATION_ADDRESS),
    expectedImplementationCodeHash: text(env.GATEWAY_IMPLEMENTATION_CODE_HASH).toLowerCase(),
    gatewayAddress: address(env.GATEWAY_ADDRESS),
    officialTokenAddress: address(env.OFFICIAL_TOKEN_ADDRESS),
    stockTokenAddress: address(env.STOCK_TOKEN_ADDRESS, CANONICAL_QQQ),
    stockAssetRegistryUrl: ROBINHOOD_ASSET_REGISTRY_URL,
    stockAssetRegistryCheckEnabled: production || boolean(env.VERIFY_STOCK_ASSET_REGISTRY, false),
    stockAssetRegistryTimeoutMs: integer(env.STOCK_ASSET_REGISTRY_TIMEOUT_MS, 5_000, 500, 15_000),
    stockAssetRegistryMaxBytes: integer(env.STOCK_ASSET_REGISTRY_MAX_BYTES, 200_000, 10_000, 500_000),
    activatedBlock: integer(env.GATEWAY_ACTIVATED_BLOCK, 0, 0, Number.MAX_SAFE_INTEGER),
    confirmations: integer(env.LOG_CONFIRMATIONS, 12, production ? 1 : 0, 1_000),
    quoterAddress: address(env.CHAIN_QUOTER_ADDRESS, CANONICAL_QUOTER),
    projectQuotePath: hexBytes(env.PROJECT_QUOTE_PATH),
    stockQuotePath: hexBytes(env.STOCK_QUOTE_PATH),
    expectedEligibilityChecker: address(env.ELIGIBILITY_CHECKER_ADDRESS),
    expectedEligibilityPolicyHash: /^0x[a-fA-F0-9]{64}$/.test(text(env.ELIGIBILITY_POLICY_HASH))
      ? text(env.ELIGIBILITY_POLICY_HASH).toLowerCase()
      : null,
    eligibilityProviderUrl: serviceUrl(env.ELIGIBILITY_PROVIDER_URL, { production }),
    eligibilityProviderMode: text(env.ELIGIBILITY_PROVIDER_MODE, "geo_attestation").toLowerCase(),
    eligibilityProviderApiKey: text(env.ELIGIBILITY_PROVIDER_API_KEY),
    eligibilityProviderRequestSecret: text(env.ELIGIBILITY_PROVIDER_REQUEST_SECRET),
    eligibilitySigningSecret: text(env.ELIGIBILITY_SIGNING_SECRET),
    eligibilityBlockedCountries: countries(
      env.ELIGIBILITY_BLOCKED_COUNTRIES,
      "US,CA,GB,CH,CU,BY,IR,KP,RU,SY,UA,SS,SD,MM,VE",
    ),
    eligibilityTtlSeconds: integer(env.ELIGIBILITY_TTL_SECONDS, 300, 30, 900),
    eligibilityTimeoutMs: integer(env.ELIGIBILITY_TIMEOUT_MS, 5_000, 500, 15_000),
    eligibilitySignerPrivateKey: privateKey(env.ELIGIBILITY_SIGNER_PRIVATE_KEY),
    quoteTtlSeconds: integer(env.QUOTE_TTL_SECONDS, 45, 15, 120),
    defaultSlippageBps: integer(env.DEFAULT_SLIPPAGE_BPS, 200, 1, 500),
    maximumSlippageBps: integer(env.MAX_SLIPPAGE_BPS, 500, 1, 1_000),
    minimumBuyWei: bigintValue(env.MIN_BUY_WEI, 100_000_000_000_000n),
    maximumBuyWei: bigintValue(env.MAX_BUY_WEI, 10_000_000_000_000_000_000n),
    rpcTimeoutMs: integer(env.RPC_TIMEOUT_MS, 8_000, 1_000, 20_000),
    runtimeCacheSeconds: integer(env.RUNTIME_CACHE_SECONDS, 15, 0, 60),
    statsCacheSeconds: integer(env.STATS_CACHE_SECONDS, 30, 0, 300),
    memberMaxScanBlocks: integer(env.MEMBER_MAX_SCAN_BLOCKS, 250_000, 1, 5_000_000),
    memberLogChunk: integer(env.MEMBER_LOG_CHUNK, 20_000, 100, 50_000),
    allowBoundedStatsFallback: !production && boolean(env.ALLOW_BOUNDED_STATS_FALLBACK, false),
    statsIndexerUrl: serviceUrl(env.STATS_INDEXER_URL, { production }),
    statsIndexerApiKey: text(env.STATS_INDEXER_API_KEY),
    statsIndexerHmacSecret: text(env.STATS_INDEXER_HMAC_SECRET),
    statsIndexerTimeoutMs: integer(env.STATS_INDEXER_TIMEOUT_MS, 5_000, 500, 15_000),
    statsIndexerMaxAgeSeconds: integer(env.STATS_INDEXER_MAX_AGE_SECONDS, 120, 15, 900),
    rateLimitProviderUrl: serviceUrl(env.RATE_LIMIT_PROVIDER_URL, { production }),
    rateLimitProviderToken: text(env.RATE_LIMIT_PROVIDER_TOKEN),
    rateLimitProviderHmacSecret: text(env.RATE_LIMIT_PROVIDER_HMAC_SECRET),
    rateLimitTimeoutMs: integer(env.RATE_LIMIT_TIMEOUT_MS, 2_000, 250, 10_000),
    monitoringWebhookUrl: serviceUrl(env.MONITORING_WEBHOOK_URL, { production }),
    monitoringWebhookToken: text(env.MONITORING_WEBHOOK_TOKEN),
    monitoringWebhookHmacSecret: text(env.MONITORING_WEBHOOK_HMAC_SECRET),
    monitoringTimeoutMs: integer(env.MONITORING_TIMEOUT_MS, 2_000, 250, 10_000),
    operationsHealthCacheSeconds: integer(env.OPERATIONS_HEALTH_CACHE_SECONDS, 15, 0, 60),
    independentAuditReportUrl: serviceUrl(env.INDEPENDENT_AUDIT_REPORT_URL, { production }),
    independentAuditSha256: sha256Digest(env.INDEPENDENT_AUDIT_SHA256),
    independentAuditFirm: text(env.INDEPENDENT_AUDIT_FIRM),
    independentAuditCompletedAt: text(env.INDEPENDENT_AUDIT_COMPLETED_AT),
    independentAuditSourceCommit: gitCommit(env.INDEPENDENT_AUDIT_SOURCE_COMMIT),
    independentAuditTimeoutMs: integer(env.INDEPENDENT_AUDIT_TIMEOUT_MS, 5_000, 500, 15_000),
    independentAuditMaxBytes: integer(env.INDEPENDENT_AUDIT_MAX_BYTES, 5_000_000, 10_000, 10_000_000),
    corsAllowedOrigins: origins(env.CORS_ALLOWED_ORIGINS),
    vercelEnvironment,
  });
}

export function hasStrongSecret(value) {
  return typeof value === "string" && value.length >= 32;
}
