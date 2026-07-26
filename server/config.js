import { getAddress, isAddress } from "viem";
import {
  CANONICAL_QQQ,
  CANONICAL_QUOTER,
  ROBINHOOD_CHAIN_ID,
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
  const configuredRegistry = address(env.REGISTRY_ADDRESS);
  return Object.freeze({
    chainId: ROBINHOOD_CHAIN_ID,
    rpcUrl: text(env.ROBINHOOD_RPC_URL, ROBINHOOD_RPC_URL),
    explorerUrl: text(env.BLOCKSCOUT_URL, ROBINHOOD_EXPLORER_URL).replace(/\/$/, ""),
    registryAddress: configuredRegistry,
    factoryAddress: address(env.FACTORY_ADDRESS),
    expectedAuthority: address(env.PROJECT_AUTHORITY_ADDRESS),
    expectedImplementation: address(env.GATEWAY_IMPLEMENTATION_ADDRESS),
    expectedImplementationCodeHash: text(env.GATEWAY_IMPLEMENTATION_CODE_HASH).toLowerCase(),
    gatewayAddress: address(env.GATEWAY_ADDRESS),
    officialTokenAddress: address(env.OFFICIAL_TOKEN_ADDRESS),
    stockTokenAddress: address(env.STOCK_TOKEN_ADDRESS, CANONICAL_QQQ),
    activatedBlock: integer(env.GATEWAY_ACTIVATED_BLOCK, 0, 0, Number.MAX_SAFE_INTEGER),
    confirmations: integer(env.LOG_CONFIRMATIONS, 12, 0, 1_000),
    quoterAddress: address(env.CHAIN_QUOTER_ADDRESS, CANONICAL_QUOTER),
    projectQuotePath: hexBytes(env.PROJECT_QUOTE_PATH),
    stockQuotePath: hexBytes(env.STOCK_QUOTE_PATH),
    expectedEligibilityChecker: address(env.ELIGIBILITY_CHECKER_ADDRESS),
    expectedEligibilityPolicyHash: /^0x[a-fA-F0-9]{64}$/.test(text(env.ELIGIBILITY_POLICY_HASH))
      ? text(env.ELIGIBILITY_POLICY_HASH).toLowerCase()
      : null,
    eligibilityProviderUrl: text(env.ELIGIBILITY_PROVIDER_URL),
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
    corsAllowedOrigins: origins(env.CORS_ALLOWED_ORIGINS),
    vercelEnvironment: text(env.VERCEL_ENV, "development"),
  });
}

export function hasStrongSecret(value) {
  return typeof value === "string" && value.length >= 32;
}
