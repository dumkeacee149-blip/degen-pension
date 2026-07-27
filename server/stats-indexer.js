import {
  createHmac,
  timingSafeEqual,
} from "node:crypto";
import { ApiError } from "./errors.js";
import { hasStrongSecret } from "./config.js";
import { readLimitedText } from "./response.js";

const MAX_RESPONSE_BYTES = 65_536;

function validApiKey(value) {
  return typeof value === "string" && value.length >= 16;
}

export function isStatsIndexerConfigured(config) {
  return Boolean(config.statsIndexerUrl)
    && validApiKey(config.statsIndexerApiKey)
    && hasStrongSecret(config.statsIndexerHmacSecret);
}

export function canUseBoundedStatsFallback(config) {
  return config.vercelEnvironment !== "production"
    && config.allowBoundedStatsFallback === true;
}

function signature(secret, value) {
  return createHmac("sha256", secret).update(value).digest("hex");
}

function equalHex(left, right) {
  if (!/^[a-f0-9]{64}$/i.test(left || "") || !/^[a-f0-9]{64}$/i.test(right || "")) {
    return false;
  }
  const supplied = Buffer.from(left, "hex");
  const expected = Buffer.from(right, "hex");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function signedHeaders(config, url) {
  const timestamp = String(Math.floor(Date.now() / 1_000));
  const requestTarget = `${url.pathname}${url.search}`;
  return {
    accept: "application/json",
    authorization: `Bearer ${config.statsIndexerApiKey}`,
    "x-degen-request-timestamp": timestamp,
    "x-degen-request-signature": `sha256=${signature(
      config.statsIndexerHmacSecret,
      `${timestamp}.GET.${requestTarget}`,
    )}`,
  };
}

async function readSignedJson(config, response) {
  let raw;
  try {
    raw = await readLimitedText(response, MAX_RESPONSE_BYTES);
  } catch {
    throw new ApiError(503, "STATS_INDEXER_RESPONSE_TOO_LARGE", "Stats indexer response is too large.");
  }
  if (!response.ok) {
    throw new ApiError(503, "STATS_INDEXER_UNAVAILABLE", "Stats indexer rejected the request.");
  }

  const timestamp = response.headers.get("x-degen-indexer-timestamp");
  const supplied = String(response.headers.get("x-degen-indexer-signature") || "")
    .replace(/^sha256=/i, "");
  const timestampSeconds = Number(timestamp);
  const nowSeconds = Math.floor(Date.now() / 1_000);
  if (
    !Number.isSafeInteger(timestampSeconds)
    || Math.abs(nowSeconds - timestampSeconds) > config.statsIndexerMaxAgeSeconds
    || !equalHex(
      supplied,
      signature(config.statsIndexerHmacSecret, `${timestamp}.${raw}`),
    )
  ) {
    throw new ApiError(
      503,
      "STATS_INDEXER_SIGNATURE_INVALID",
      "Stats indexer response signature is missing, stale, or invalid.",
    );
  }

  try {
    const payload = JSON.parse(raw);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("invalid payload");
    return payload;
  } catch {
    throw new ApiError(503, "STATS_INDEXER_RESPONSE_INVALID", "Stats indexer returned invalid JSON.");
  }
}

async function request(config, url, fetchImpl) {
  if (!isStatsIndexerConfigured(config)) {
    throw new ApiError(503, "STATS_INDEXER_NOT_CONFIGURED", "A trusted durable stats indexer is required.");
  }
  let response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      redirect: "error",
      headers: signedHeaders(config, url),
      signal: AbortSignal.timeout(config.statsIndexerTimeoutMs),
    });
  } catch {
    throw new ApiError(503, "STATS_INDEXER_UNAVAILABLE", "Stats indexer did not respond.");
  }
  return readSignedJson(config, response);
}

export async function checkStatsIndexerHealth(config, { fetchImpl = fetch } = {}) {
  if (!isStatsIndexerConfigured(config)) return false;
  const url = new URL("healthz", `${config.statsIndexerUrl}/`);
  try {
    const payload = await request(config, url, fetchImpl);
    return payload.schemaVersion === 1
      && payload.ok === true
      && Number(payload.chainId) === config.chainId
      && /^(0|[1-9][0-9]*)$/.test(String(payload.indexedThroughBlock));
  } catch {
    return false;
  }
}

export async function loadIndexedStatsSnapshot(config, {
  gatewayAddress,
  officialTokenAddress,
  stockTokenAddress,
  activatedBlock,
  recipient = null,
  fetchImpl = fetch,
}) {
  const url = new URL("v1/canonical-market-snapshot", `${config.statsIndexerUrl || "https://invalid.local"}/`);
  url.searchParams.set("chainId", String(config.chainId));
  url.searchParams.set("gatewayAddress", gatewayAddress);
  url.searchParams.set("officialTokenAddress", officialTokenAddress || "");
  url.searchParams.set("stockTokenAddress", stockTokenAddress || "");
  url.searchParams.set("activatedBlock", String(activatedBlock));
  url.searchParams.set("confirmations", String(config.confirmations));
  if (recipient) url.searchParams.set("recipient", recipient);
  return request(config, url, fetchImpl);
}
