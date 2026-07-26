import {
  createHmac,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { getAddress } from "viem";
import { ApiError } from "./http.js";
import { hasStrongSecret } from "./config.js";

const decisionCache = new Map();

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

function signTokenPayload(encodedPayload, secret) {
  return createHmac("sha256", secret).update(encodedPayload).digest("base64url");
}

function parseProviderExpiry(value, maximumSeconds) {
  const nowSeconds = Math.floor(Date.now() / 1_000);
  let providerSeconds = 0;
  if (typeof value === "number") providerSeconds = Math.floor(value);
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) providerSeconds = Math.floor(parsed / 1_000);
  }
  if (providerSeconds <= nowSeconds) return nowSeconds + maximumSeconds;
  return Math.min(providerSeconds, nowSeconds + maximumSeconds);
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
    headers["x-degen-pension-signature"] =
      createHmac("sha256", config.eligibilityProviderRequestSecret).update(requestPayload).digest("hex");
  }

  let response;
  try {
    response = await fetchImpl(config.eligibilityProviderUrl, {
      method: "POST",
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
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new ApiError(503, "ELIGIBILITY_PROVIDER_INVALID", "Eligibility provider returned invalid JSON.");
  }
  if (typeof payload?.eligible !== "boolean") {
    throw new ApiError(503, "ELIGIBILITY_PROVIDER_INVALID", "Eligibility provider returned no decision.");
  }
  return {
    eligible: payload.eligible,
    reason: String(payload.reason || (payload.eligible ? "ELIGIBLE" : "PROVIDER_DENIED")).slice(0, 120),
    decisionId: String(payload.decisionId || randomUUID()).slice(0, 160),
    provider: String(payload.provider || "configured-provider").slice(0, 80),
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
