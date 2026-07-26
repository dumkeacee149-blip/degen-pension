import {
  createHmac,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { getAddress } from "viem";
import { ApiError } from "./http.js";
import { hasStrongSecret } from "./config.js";
import { isExternalEligibilityConfigured } from "./operations.js";
import { readLimitedText } from "./response.js";

const decisionCache = new Map();

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

function signTokenPayload(encodedPayload, secret) {
  return createHmac("sha256", secret).update(encodedPayload).digest("base64url");
}

function parseProviderExpiry(value, maximumSeconds) {
  const nowSeconds = Math.floor(Date.now() / 1_000);
  let providerSeconds = Number.NaN;
  if (typeof value === "number") providerSeconds = Math.floor(value);
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) providerSeconds = Math.floor(parsed / 1_000);
  }
  if (!Number.isSafeInteger(providerSeconds) || providerSeconds <= nowSeconds) return null;
  return Math.min(providerSeconds, nowSeconds + maximumSeconds);
}

function verifyProviderResponse(config, response, raw) {
  const timestamp = response.headers.get("x-degen-provider-timestamp");
  const suppliedSignature = String(response.headers.get("x-degen-provider-signature") || "")
    .replace(/^sha256=/i, "");
  const timestampSeconds = Number(timestamp);
  const expectedSignature = createHmac("sha256", config.eligibilityProviderRequestSecret)
    .update(`${timestamp}.${raw}`)
    .digest("hex");
  const supplied = /^[a-f0-9]{64}$/i.test(suppliedSignature)
    ? Buffer.from(suppliedSignature, "hex")
    : Buffer.alloc(0);
  const expected = Buffer.from(expectedSignature, "hex");
  return Number.isSafeInteger(timestampSeconds)
    && Math.abs(Math.floor(Date.now() / 1_000) - timestampSeconds) <= 60
    && supplied.length === expected.length
    && timingSafeEqual(supplied, expected);
}

function publicDecision({ eligible, reason, countryCode, checkedAtSeconds, expiresAtSeconds, proof }) {
  return {
    eligible,
    reason,
    countryCode,
    checkedAt: new Date(checkedAtSeconds * 1_000).toISOString(),
    expiresAt: new Date(expiresAtSeconds * 1_000).toISOString(),
    ...(proof ? { proof } : {}),
  };
}

function issueProviderProof(config, wallet, countryCode, providerDecision, checkedAtSeconds, expiresAtSeconds) {
  if (!hasStrongSecret(config.eligibilitySigningSecret)) {
    throw new ApiError(503, "ELIGIBILITY_SIGNING_UNAVAILABLE", "Eligibility signing is not configured.");
  }
  const payload = {
    version: 1,
    type: "DEGEN_PENSION_PROVIDER_DECISION",
    wallet: wallet.toLowerCase(),
    chainId: config.chainId,
    stockTokenAddress: config.stockTokenAddress.toLowerCase(),
    countryCode,
    decisionId: String(providerDecision.decisionId || randomUUID()),
    provider: String(providerDecision.provider || "configured-provider").slice(0, 80),
    issuedAt: checkedAtSeconds,
    expiresAt: expiresAtSeconds,
  };
  const encodedPayload = base64url(JSON.stringify(payload));
  const token = `${encodedPayload}.${signTokenPayload(encodedPayload, config.eligibilitySigningSecret)}`;
  return {
    type: "DEGEN_PENSION_ELIGIBILITY_V1",
    token,
    wallet,
    chainId: config.chainId,
    stockTokenAddress: config.stockTokenAddress,
    decisionId: payload.decisionId,
    issuedAt: new Date(checkedAtSeconds * 1_000).toISOString(),
    expiresAt: new Date(expiresAtSeconds * 1_000).toISOString(),
  };
}

export function verifyProviderProof(config, token, expectedWallet) {
  if (!hasStrongSecret(config.eligibilitySigningSecret)) {
    throw new ApiError(503, "ELIGIBILITY_SIGNING_UNAVAILABLE", "Eligibility signing is not configured.");
  }
  const [encodedPayload, suppliedSignature, extra] = String(token || "").split(".");
  if (!encodedPayload || !suppliedSignature || extra) {
    throw new ApiError(400, "INVALID_ELIGIBILITY_PROOF", "Eligibility proof is malformed.");
  }
  const expectedSignature = signTokenPayload(encodedPayload, config.eligibilitySigningSecret);
  const supplied = Buffer.from(suppliedSignature);
  const expected = Buffer.from(expectedSignature);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    throw new ApiError(403, "INVALID_ELIGIBILITY_PROOF", "Eligibility proof signature is invalid.");
  }
  let payload;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  } catch {
    throw new ApiError(400, "INVALID_ELIGIBILITY_PROOF", "Eligibility proof payload is invalid.");
  }
  const nowSeconds = Math.floor(Date.now() / 1_000);
  if (
    payload.version !== 1 ||
    payload.type !== "DEGEN_PENSION_PROVIDER_DECISION" ||
    payload.chainId !== config.chainId ||
    payload.stockTokenAddress !== config.stockTokenAddress.toLowerCase() ||
    payload.wallet !== expectedWallet.toLowerCase() ||
    !Number.isSafeInteger(payload.expiresAt) ||
    payload.expiresAt <= nowSeconds
  ) {
    throw new ApiError(403, "ELIGIBILITY_PROOF_MISMATCH", "Eligibility proof is expired or mismatched.");
  }
  return payload;
}

async function fetchProviderDecision(config, {
  wallet,
  countryCode,
  termsAccepted,
  notUSPerson,
  fetchImpl,
}) {
  if (config.vercelEnvironment === "production" && !isExternalEligibilityConfigured(config)) {
    throw new ApiError(
      503,
      "EXTERNAL_ELIGIBILITY_NOT_CONFIGURED",
      "Production requires a signed external eligibility provider.",
    );
  }
  if (config.eligibilityProviderMode === "geo_attestation" && !config.eligibilityProviderUrl) {
    return {
      eligible: true,
      reason: "GEO_ATTESTATION_ELIGIBLE",
      decisionId: randomUUID(),
      provider: "degen-pension-geo-attestation-v1",
      expiresAt: new Date(Date.now() + config.eligibilityTtlSeconds * 1_000).toISOString(),
    };
  }
  if (!config.eligibilityProviderUrl) {
    throw new ApiError(503, "ELIGIBILITY_PROVIDER_UNAVAILABLE", "Eligibility provider is not configured.");
  }
  const requestPayload = JSON.stringify({
    schemaVersion: 1,
    wallet,
    chainId: config.chainId,
    stockTokenAddress: config.stockTokenAddress,
    countryCode,
    termsAccepted,
    notUSPerson,
  });
  const headers = {
    accept: "application/json",
    "content-type": "application/json",
  };
  if (config.eligibilityProviderApiKey) {
    headers.authorization = `Bearer ${config.eligibilityProviderApiKey}`;
  }
  if (hasStrongSecret(config.eligibilityProviderRequestSecret)) {
    const requestTimestamp = String(Math.floor(Date.now() / 1_000));
    headers["x-degen-provider-request-timestamp"] = requestTimestamp;
    headers["x-degen-pension-signature"] =
      createHmac("sha256", config.eligibilityProviderRequestSecret)
        .update(`${requestTimestamp}.${requestPayload}`)
        .digest("hex");
  }

  let response;
  try {
    response = await fetchImpl(config.eligibilityProviderUrl, {
      method: "POST",
      redirect: "error",
      headers,
      body: requestPayload,
      signal: AbortSignal.timeout(config.eligibilityTimeoutMs),
    });
  } catch {
    throw new ApiError(503, "ELIGIBILITY_PROVIDER_UNAVAILABLE", "Eligibility provider did not respond.");
  }
  if (!response.ok) {
    throw new ApiError(503, "ELIGIBILITY_PROVIDER_UNAVAILABLE", "Eligibility provider rejected the check.");
  }
  let raw;
  try {
    raw = await readLimitedText(response, 32_768);
  } catch {
    throw new ApiError(503, "ELIGIBILITY_PROVIDER_INVALID", "Eligibility provider returned invalid JSON.");
  }
  if (
    !hasStrongSecret(config.eligibilityProviderRequestSecret)
    || !verifyProviderResponse(config, response, raw)
  ) {
    throw new ApiError(503, "ELIGIBILITY_PROVIDER_UNTRUSTED", "Eligibility provider response signature is invalid.");
  }
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw new ApiError(503, "ELIGIBILITY_PROVIDER_INVALID", "Eligibility provider returned invalid JSON.");
  }
  const decisionId = typeof payload?.decisionId === "string" ? payload.decisionId.trim() : "";
  const provider = typeof payload?.provider === "string" ? payload.provider.trim() : "";
  const reason = typeof payload?.reason === "string" ? payload.reason.trim() : "";
  if (typeof payload?.eligible !== "boolean") {
    throw new ApiError(503, "ELIGIBILITY_PROVIDER_INVALID", "Eligibility provider returned no decision.");
  }
  if (
    payload.schemaVersion !== 1
    || String(payload.wallet || "").toLowerCase() !== wallet.toLowerCase()
    || Number(payload.chainId) !== config.chainId
    || String(payload.stockTokenAddress || "").toLowerCase() !== config.stockTokenAddress.toLowerCase()
    || String(payload.countryCode || "").toUpperCase() !== countryCode
  ) {
    throw new ApiError(
      503,
      "ELIGIBILITY_PROVIDER_BINDING_MISMATCH",
      "Eligibility provider decision does not match the requested wallet and market.",
    );
  }
  if (
    !decisionId
    || decisionId.length > 160
    || !provider
    || provider.length > 80
    || !reason
    || reason.length > 120
  ) {
    throw new ApiError(503, "ELIGIBILITY_PROVIDER_INVALID", "Eligibility provider decision is not auditable.");
  }
  return {
    eligible: payload.eligible,
    reason,
    decisionId,
    provider,
    expiresAt: payload.expiresAt,
  };
}

export async function decideEligibility(config, {
  wallet,
  countryCode,
  termsAccepted,
  notUSPerson,
  fetchImpl = fetch,
  fresh = false,
}) {
  const checkedAtSeconds = Math.floor(Date.now() / 1_000);
  const shortExpiry = checkedAtSeconds + Math.min(60, config.eligibilityTtlSeconds);
  if (termsAccepted !== true) {
    return publicDecision({
      eligible: false,
      reason: "TERMS_NOT_ACCEPTED",
      countryCode,
      checkedAtSeconds,
      expiresAtSeconds: shortExpiry,
    });
  }
  if (notUSPerson !== true) {
    return publicDecision({
      eligible: false,
      reason: "US_PERSON_BLOCKED",
      countryCode,
      checkedAtSeconds,
      expiresAtSeconds: shortExpiry,
    });
  }
  if (!countryCode) {
    return publicDecision({
      eligible: false,
      reason: "COUNTRY_UNKNOWN",
      countryCode: null,
      checkedAtSeconds,
      expiresAtSeconds: shortExpiry,
    });
  }
  if (config.eligibilityBlockedCountries.has(countryCode)) {
    return publicDecision({
      eligible: false,
      reason: "JURISDICTION_BLOCKED",
      countryCode,
      checkedAtSeconds,
      expiresAtSeconds: shortExpiry,
    });
  }

  const cacheKey = `${wallet.toLowerCase()}:${countryCode}`;
  const cached = decisionCache.get(cacheKey);
  if (!fresh && cached && cached.expiresAtSeconds > checkedAtSeconds) return cached.publicValue;

  const providerDecision = await fetchProviderDecision(config, {
    wallet,
    countryCode,
    termsAccepted,
    notUSPerson,
    fetchImpl,
  });
  const expiresAtSeconds = parseProviderExpiry(providerDecision.expiresAt, config.eligibilityTtlSeconds);
  if (!expiresAtSeconds) {
    throw new ApiError(503, "ELIGIBILITY_PROVIDER_INVALID", "Eligibility provider returned no valid future expiry.");
  }
  const proof = providerDecision.eligible
    ? issueProviderProof(config, getAddress(wallet), countryCode, providerDecision, checkedAtSeconds, expiresAtSeconds)
    : undefined;
  const publicValue = publicDecision({
    eligible: providerDecision.eligible,
    reason: providerDecision.reason,
    countryCode,
    checkedAtSeconds,
    expiresAtSeconds,
    proof,
  });
  decisionCache.set(cacheKey, { expiresAtSeconds, publicValue });
  return publicValue;
}

export function __resetEligibilityCacheForTests() {
  decisionCache.clear();
}
