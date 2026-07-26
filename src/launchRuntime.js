const ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;
const HEX_PATTERN = /^0x[0-9a-fA-F]+$/;
const BUY_NATIVE_SELECTOR = "0x111bc375";
const BUY_NATIVE_HEAD_WORDS = 6;
const BUY_NATIVE_DYNAMIC_OFFSET = 32 * BUY_NATIVE_HEAD_WORDS;
const ELIGIBILITY_SIGNATURE_BYTES = 65;
const RUNTIME_CHECK_GROUPS = Object.freeze({
  runtime: [
    "rpcChain",
    "foundationCode",
    "factoryAuthority",
    "factoryImplementation",
    "factoryMarket",
    "gatewayCode",
    "gatewayInitialized",
    "gatewayBindings",
    "adapterCode",
    "adapterBindings",
    "activatedBlock",
  ],
  quote: ["quoterCode", "quoteRoutes"],
  eligibility: [
    "eligibilityProvider",
    "eligibilityChecker",
    "eligibilitySigner",
    "policyHash",
  ],
});

export class LaunchRuntimeError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = "LaunchRuntimeError";
    this.code = code;
    this.details = details;
  }
}

export function normalizeAddress(value, label = "address") {
  const address = String(value || "").trim();
  if (!ADDRESS_PATTERN.test(address)) {
    throw new LaunchRuntimeError("INVALID_ADDRESS", `${label} is not a valid address.`);
  }
  return address.toLowerCase();
}

export function normalizeChainId(value) {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new LaunchRuntimeError("INVALID_CHAIN", "Chain ID is invalid.");
    }
    return value;
  }

  const text = String(value ?? "").trim();
  const radix = /^0x/i.test(text) ? 16 : 10;
  const chainId = Number.parseInt(text, radix);
  if (!text || !Number.isSafeInteger(chainId) || chainId < 0) {
    throw new LaunchRuntimeError("INVALID_CHAIN", "Chain ID is invalid.");
  }
  return chainId;
}

export function parseEthToWei(value) {
  const text = String(value ?? "").trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(text)) {
    throw new LaunchRuntimeError("INVALID_AMOUNT", "Enter a valid ETH amount with at most 18 decimals.");
  }

  const [whole, fraction = ""] = text.split(".");
  const wei = (BigInt(whole) * 10n ** 18n) + BigInt((fraction + "0".repeat(18)).slice(0, 18));
  if (wei <= 0n) {
    throw new LaunchRuntimeError("INVALID_AMOUNT", "ETH amount must be greater than zero.");
  }
  return wei;
}

function parseUnsignedInteger(value, label) {
  if (typeof value === "bigint") {
    if (value < 0n) throw new LaunchRuntimeError("INVALID_QUOTE", `${label} cannot be negative.`);
    return value;
  }

  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new LaunchRuntimeError("INVALID_QUOTE", `${label} is not a safe integer.`);
    }
    return BigInt(value);
  }

  const text = String(value ?? "").trim();
  if (!text || (!/^\d+$/.test(text) && !/^0x[0-9a-fA-F]+$/.test(text))) {
    throw new LaunchRuntimeError("INVALID_QUOTE", `${label} is not an unsigned integer.`);
  }
  return BigInt(text);
}

function parseTimestamp(value, label) {
  const timestamp = typeof value === "number" ? value : Date.parse(String(value || ""));
  if (!Number.isFinite(timestamp)) {
    throw new LaunchRuntimeError("INVALID_EXPIRY", `${label} is missing or invalid.`);
  }
  return timestamp;
}

function parseSafeNumber(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new LaunchRuntimeError("INVALID_RUNTIME", `${label} is not a safe non-negative integer.`);
  }
  return number;
}

function validateLiveWindow({ checkedAt, expiresAt, nowMs, maxAgeMs, label }) {
  const checked = parseTimestamp(checkedAt, `${label} checkedAt`);
  const expires = parseTimestamp(expiresAt, `${label} expiresAt`);
  const fresh = checked <= nowMs + 30_000
    && nowMs - checked <= maxAgeMs
    && expires > nowMs + 5_000
    && expires > checked;
  if (!fresh) {
    throw new LaunchRuntimeError("STALE_RESPONSE", `${label} response is stale or expired.`);
  }
  return { checkedAt: checked, expiresAt: expires };
}

function normalizeLimits(limits) {
  if (!limits || typeof limits !== "object" || Array.isArray(limits)) {
    throw new LaunchRuntimeError("INVALID_RUNTIME", "Runtime safety limits are missing.");
  }
  const minAmountInWei = parseUnsignedInteger(limits.minimumBuyWei, "Runtime minimum input");
  const maxAmountInWei = parseUnsignedInteger(limits.maximumBuyWei, "Runtime maximum input");
  const defaultSlippageBps = parseSafeNumber(
    limits.defaultSlippageBps,
    "Runtime default slippage",
  );
  const maxSlippageBps = parseSafeNumber(
    limits.maximumSlippageBps,
    "Runtime maximum slippage",
  );
  const quoteTtlSeconds = parseSafeNumber(limits.quoteTtlSeconds, "Runtime quote TTL");
  const confirmations = parseSafeNumber(limits.confirmations, "Runtime confirmations");
  if (
    minAmountInWei <= 0n
    || maxAmountInWei < minAmountInWei
    || defaultSlippageBps <= 0
    || defaultSlippageBps > maxSlippageBps
    || maxSlippageBps <= 0
    || maxSlippageBps > 1_000
    || quoteTtlSeconds < 10
    || quoteTtlSeconds > 600
    || confirmations < 1
    || confirmations > 100
  ) {
    throw new LaunchRuntimeError("INVALID_RUNTIME", "Runtime safety limits are invalid.");
  }
  return {
    minAmountInWei,
    maxAmountInWei,
    defaultSlippageBps,
    maxSlippageBps,
    quoteTtlSeconds,
    confirmations,
  };
}

function normalizeEligibilityProof(value, {
  wallet,
  chainId,
  stockTokenAddress,
  nowMs,
  label = "Eligibility proof",
} = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new LaunchRuntimeError("INVALID_ELIGIBILITY", `${label} is missing or invalid.`);
  }
  const token = String(value.token || "").trim();
  const decisionId = String(value.decisionId || "").trim();
  const issuedAt = parseTimestamp(value.issuedAt, `${label} issuedAt`);
  const expiresAt = parseTimestamp(value.expiresAt, `${label} expiresAt`);
  if (
    value.type !== "DEGEN_PENSION_ELIGIBILITY_V1"
    || !/^[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}$/.test(token)
    || token.length > 8_192
    || decisionId.length < 8
    || decisionId.length > 256
    || normalizeAddress(value.wallet, `${label} wallet`) !== normalizeAddress(wallet, "Wallet")
    || normalizeChainId(value.chainId) !== normalizeChainId(chainId)
    || normalizeAddress(value.stockTokenAddress, `${label} stock token`)
      !== normalizeAddress(stockTokenAddress, "Configured stock token")
    || issuedAt > nowMs + 30_000
    || expiresAt <= nowMs + 5_000
    || expiresAt <= issuedAt
  ) {
    throw new LaunchRuntimeError("INVALID_ELIGIBILITY", `${label} does not bind the live wallet and market.`);
  }
  return {
    type: value.type,
    token,
    wallet: normalizeAddress(value.wallet),
    chainId: normalizeChainId(value.chainId),
    stockTokenAddress: normalizeAddress(value.stockTokenAddress),
    decisionId,
    issuedAt,
    expiresAt,
  };
}

function gateReady(value) {
  if (value === true) return true;
  if (!value || typeof value !== "object") return false;
  if (value.ready === true || value.ok === true || value.healthy === true) return true;
  return String(value.status || "").toLowerCase() === "ready";
}

function readRuntimeGates(payload) {
  const checks = payload?.checks;
  if (!checks || typeof checks !== "object" || Array.isArray(checks)) {
    return { runtime: false, quote: false, eligibility: false };
  }
  const groupReady = (group) => RUNTIME_CHECK_GROUPS[group]
    .every((field) => checks[field] === true);
  return {
    runtime: groupReady("runtime"),
    quote: groupReady("quote"),
    eligibility: groupReady("eligibility"),
  };
}

function makeAbortContext(signal, timeoutMs) {
  const controller = new AbortController();
  let timedOut = false;
  const abortFromParent = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", abortFromParent, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  return {
    signal: controller.signal,
    didTimeout: () => timedOut,
    dispose: () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abortFromParent);
    },
  };
}

async function fetchJson(url, init, {
  fetchImpl = globalThis.fetch,
  signal,
  timeoutMs = 8_000,
  label = "Request",
} = {}) {
  if (typeof fetchImpl !== "function") {
    throw new LaunchRuntimeError("FETCH_UNAVAILABLE", `${label} cannot run in this browser.`);
  }
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    throw new LaunchRuntimeError("OFFLINE", `${label} cannot run while offline.`);
  }

  const abortContext = makeAbortContext(signal, timeoutMs);
  try {
    const response = await fetchImpl(url, { ...init, signal: abortContext.signal });
    if (!response?.ok) {
      throw new LaunchRuntimeError(
        "HTTP_ERROR",
        `${label} failed (${response?.status || "network error"}).`,
      );
    }

    try {
      return await response.json();
    } catch {
      throw new LaunchRuntimeError("INVALID_JSON", `${label} returned invalid JSON.`);
    }
  } catch (error) {
    if (abortContext.didTimeout()) {
      throw new LaunchRuntimeError("TIMEOUT", `${label} timed out.`);
    }
    if (signal?.aborted) throw error;
    if (error instanceof LaunchRuntimeError) throw error;
    throw new LaunchRuntimeError("NETWORK_ERROR", `${label} could not reach the service.`);
  } finally {
    abortContext.dispose();
  }
}

export function blockedRuntimeState(reason = "Launch environment is incomplete.") {
  return {
    status: "blocked",
    ready: false,
    reason,
    checks: { runtime: false, quote: false, eligibility: false },
    checkedAt: null,
    expiresAt: null,
    limits: null,
  };
}

export async function loadRuntimeReadiness({
  market,
  chain,
  fetchImpl,
  signal,
  nowMs = Date.now(),
} = {}) {
  if (!market?.bootstrapConfigured || !market?.runtimeStatusEndpoint) {
    return blockedRuntimeState(
      "The same-origin production runtime endpoint is unavailable.",
    );
  }

  const payload = await fetchJson(
    market.runtimeStatusEndpoint,
    { method: "GET", headers: { accept: "application/json" }, cache: "no-store" },
    {
      fetchImpl,
      signal,
      timeoutMs: market.requestTimeoutMs,
      label: "Market readiness check",
    },
  );

  if (payload.schemaVersion !== 1) {
    throw new LaunchRuntimeError("INVALID_RUNTIME", "Unsupported runtime schema version.");
  }
  const checks = readRuntimeGates(payload);
  const limits = normalizeLimits(payload.limits);
  const liveWindow = validateLiveWindow({
    checkedAt: payload.checkedAt,
    expiresAt: payload.expiresAt,
    nowMs,
    maxAgeMs: market.runtimeMaxAgeMs,
    label: "Runtime",
  });
  const publicStatus = String(payload.status || "").toUpperCase();

  if (payload.ready !== true) {
    if (!["NOT_CONFIGURED", "NOT_READY", "RPC_UNAVAILABLE"].includes(publicStatus)) {
      throw new LaunchRuntimeError("INVALID_RUNTIME", "Runtime returned an unknown blocked status.");
    }
    const foundationReady = payload.checks?.rpcChain === true
      && payload.checks?.foundationCode === true
      && payload.checks?.factoryAuthority === true
      && payload.checks?.factoryImplementation === true;
    let foundation = null;
    if (foundationReady) {
      try {
        foundation = {
          registryAddress: normalizeAddress(payload.registryAddress || payload.factoryAddress, "Runtime Registry"),
          implementationAddress: normalizeAddress(payload.implementationAddress, "Gateway implementation"),
          implementationCodeHash: String(payload.implementationCodeHash || "").toLowerCase(),
        };
      } catch {
        foundation = null;
      }
    }
    const discoveredMarketReady = Boolean(foundation)
      && payload.checks?.factoryMarket === true
      && payload.checks?.gatewayCode === true
      && payload.checks?.gatewayInitialized === true
      && payload.checks?.gatewayBindings === true;
    const canonical = discoveredMarketReady
      ? {
          chainId: normalizeChainId(payload.chainId),
          factoryAddress: normalizeAddress(payload.factoryAddress, "Runtime Factory"),
          gatewayAddress: normalizeAddress(payload.gatewayAddress, "Runtime Gateway"),
          officialTokenAddress: normalizeAddress(payload.officialTokenAddress, "Runtime official token"),
          stockTokenAddress: normalizeAddress(payload.stockTokenAddress, "Runtime stock token"),
          inputTokenAddress: normalizeAddress(payload.inputTokenAddress, "Runtime input token"),
          projectAdapterAddress: normalizeAddress(payload.projectAdapterAddress, "Runtime project adapter"),
          stockAdapterAddress: normalizeAddress(payload.stockAdapterAddress, "Runtime stock adapter"),
        }
      : null;
    return {
      status: publicStatus === "NOT_CONFIGURED" ? "prelaunch" : "blocked",
      ready: false,
      reason: publicStatus === "NOT_CONFIGURED"
        ? "The official CA and Gateway have not been atomically activated in the production registry."
        : "Runtime, quote, and eligibility checks have not all passed.",
      checks,
      checkedAt: liveWindow.checkedAt,
      expiresAt: liveWindow.expiresAt,
      limits,
      eligibility: null,
      canonical,
      foundation,
    };
  }

  const chainMatches = normalizeChainId(payload.chainId) === chain.chainIdDecimal;
  const expectedAddressMatches = (actual, expected, label) => {
    const normalized = normalizeAddress(actual, label);
    return !expected || normalized === normalizeAddress(expected, `Development ${label}`);
  };
  const factoryMatches =
    expectedAddressMatches(payload.factoryAddress, market.factoryAddress, "Runtime Factory");
  const gatewayMatches =
    expectedAddressMatches(payload.gatewayAddress, market.gatewayAddress, "Runtime Gateway");
  const officialTokenMatches =
    expectedAddressMatches(payload.officialTokenAddress, market.officialTokenAddress, "Runtime official token");
  const stockTokenMatches =
    normalizeAddress(payload.stockTokenAddress, "Runtime stock token") ===
    normalizeAddress(market.stockTokenAddress, "Configured stock token");
  const inputTokenMatches =
    expectedAddressMatches(payload.inputTokenAddress, market.inputTokenAddress, "Runtime input token");
  const projectAdapterMatches =
    expectedAddressMatches(payload.projectAdapterAddress, market.projectAdapterAddress, "Runtime project adapter");
  const stockAdapterMatches =
    expectedAddressMatches(payload.stockAdapterAddress, market.stockAdapterAddress, "Runtime stock adapter");
  const eligibilityCheckerAddress = normalizeAddress(
    payload.eligibilityCheckerAddress,
    "Runtime eligibility checker",
  );
  const eligibilitySignerAddress = normalizeAddress(
    payload.eligibilitySignerAddress,
    "Runtime eligibility signer",
  );
  const policyHash = String(payload.policyHash || "").toLowerCase();
  if (
    eligibilityCheckerAddress === "0x0000000000000000000000000000000000000000"
    || eligibilitySignerAddress === "0x0000000000000000000000000000000000000000"
    || !/^0x[0-9a-f]{64}$/.test(policyHash)
    || /^0x0{64}$/.test(policyHash)
  ) {
    throw new LaunchRuntimeError("INVALID_RUNTIME", "Runtime eligibility bindings are invalid.");
  }
  const activatedBlock = parseSafeNumber(payload.activatedBlock, "Runtime activation block");
  const explicitFeeBps = parseSafeNumber(payload.explicitFeeBps, "Runtime explicit fee");
  const activatedBlockMatches = activatedBlock > 0
    && (!market.activatedBlock || activatedBlock === market.activatedBlock);
  const explicitFeeMatches = explicitFeeBps <= 500
    && (market.explicitFeeBps === null || explicitFeeBps === market.explicitFeeBps);
  const statusReady = publicStatus === "READY" || publicStatus === "RUNTIME_READY";
  const ready = payload.ready === true
    && statusReady
    && checks.runtime
    && checks.quote
    && checks.eligibility
    && chainMatches
    && factoryMatches
    && gatewayMatches
    && officialTokenMatches
    && stockTokenMatches
    && inputTokenMatches
    && projectAdapterMatches
    && stockAdapterMatches
    && activatedBlockMatches
    && explicitFeeMatches;

  const canonical = {
    chainId: chain.chainIdDecimal,
    factoryAddress: normalizeAddress(payload.factoryAddress),
    gatewayAddress: normalizeAddress(payload.gatewayAddress),
    officialTokenAddress: normalizeAddress(payload.officialTokenAddress),
    stockTokenAddress: normalizeAddress(payload.stockTokenAddress),
    inputTokenAddress: normalizeAddress(payload.inputTokenAddress),
    projectAdapterAddress: normalizeAddress(payload.projectAdapterAddress),
    stockAdapterAddress: normalizeAddress(payload.stockAdapterAddress),
    activatedBlock,
    explicitFeeBps,
  };

  return {
    status: ready ? "ready" : "blocked",
    ready,
    reason: ready ? "" : "Runtime, quote, and eligibility must all pass against the official market.",
    checks,
    checkedAt: liveWindow.checkedAt,
    expiresAt: liveWindow.expiresAt,
    limits,
    eligibility: {
      checkerAddress: eligibilityCheckerAddress,
      signerAddress: eligibilitySignerAddress,
      policyHash,
    },
    canonical: ready ? canonical : null,
    matches: {
      chainMatches,
      factoryMatches,
      gatewayMatches,
      officialTokenMatches,
      stockTokenMatches,
      inputTokenMatches,
      projectAdapterMatches,
      stockAdapterMatches,
      activatedBlockMatches,
      explicitFeeMatches,
    },
  };
}

export async function requestEligibility({
  market,
  chain,
  wallet,
  termsAccepted,
  notUSPerson,
  fetchImpl,
  signal,
  nowMs = Date.now(),
} = {}) {
  if (!market?.eligibilityEndpoint) {
    throw new LaunchRuntimeError("CONFIG_INCOMPLETE", "Eligibility service is not configured.");
  }
  if (termsAccepted !== true || notUSPerson !== true) {
    throw new LaunchRuntimeError(
      "ATTESTATION_REQUIRED",
      "Accept the terms and non-US-person attestation before checking eligibility.",
    );
  }
  const normalizedWallet = normalizeAddress(wallet, "Wallet");
  const payload = await fetchJson(
    market.eligibilityEndpoint,
    {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        wallet: normalizedWallet,
        termsAccepted: true,
        notUSPerson: true,
      }),
    },
    {
      fetchImpl,
      signal,
      timeoutMs: market.requestTimeoutMs,
      label: "Eligibility check",
    },
  );

  if (typeof payload.eligible !== "boolean") {
    throw new LaunchRuntimeError("INVALID_ELIGIBILITY", "Eligibility response is incomplete.");
  }
  const reason = String(payload.reason || "").trim();
  const countryCode = String(payload.countryCode || "").trim().toUpperCase();
  if (!reason || !/^[A-Z]{2}$/.test(countryCode)) {
    throw new LaunchRuntimeError("INVALID_ELIGIBILITY", "Eligibility reason or country is missing.");
  }
  const liveWindow = validateLiveWindow({
    checkedAt: payload.checkedAt,
    expiresAt: payload.expiresAt,
    nowMs,
    maxAgeMs: Math.min(market.runtimeMaxAgeMs, 120_000),
    label: "Eligibility",
  });
  let proof = null;
  if (payload.eligible) {
    proof = normalizeEligibilityProof(payload.proof, {
      wallet: normalizedWallet,
      chainId: chain.chainIdDecimal,
      stockTokenAddress: market.stockTokenAddress,
      nowMs,
    });
  }

  return {
    eligible: payload.eligible,
    reason,
    countryCode,
    checkedAt: liveWindow.checkedAt,
    expiresAt: liveWindow.expiresAt,
    proof,
  };
}

export function decodeBuyNativeCalldata(data) {
  const calldata = String(data || "");
  if (!HEX_PATTERN.test(calldata) || calldata.length < 2 + 8 + (64 * 7)) {
    throw new LaunchRuntimeError("INVALID_CALLDATA", "Quote calldata is missing or malformed.");
  }
  if (calldata.slice(0, 10).toLowerCase() !== BUY_NATIVE_SELECTOR) {
    throw new LaunchRuntimeError("INVALID_SELECTOR", "Quote is not the approved Gateway V2 buyNative call.");
  }

  const body = calldata.slice(10);
  if (body.length % 64 !== 0) {
    throw new LaunchRuntimeError("INVALID_CALLDATA", "Quote calldata is not canonical ABI encoding.");
  }
  const wordAt = (index) => body.slice(index * 64, (index + 1) * 64);
  const minProjectOutWord = wordAt(0);
  const minStockOutWord = wordAt(1);
  const recipientWord = wordAt(2);
  const deadlineWord = wordAt(3);
  const eligibilityDeadlineWord = wordAt(4);
  const signatureOffset = BigInt(`0x${wordAt(5)}`);
  if (!/^0{24}[0-9a-fA-F]{40}$/.test(recipientWord)) {
    throw new LaunchRuntimeError("INVALID_RECIPIENT", "Quote recipient encoding is invalid.");
  }
  if (signatureOffset !== BigInt(BUY_NATIVE_DYNAMIC_OFFSET)) {
    throw new LaunchRuntimeError("INVALID_CALLDATA", "Eligibility signature offset is not canonical.");
  }

  const tailStart = Number(signatureOffset) * 2;
  const signatureLengthWord = body.slice(tailStart, tailStart + 64);
  if (signatureLengthWord.length !== 64) {
    throw new LaunchRuntimeError("INVALID_CALLDATA", "Eligibility signature length is missing.");
  }
  const signatureLength = BigInt(`0x${signatureLengthWord}`);
  if (signatureLength !== BigInt(ELIGIBILITY_SIGNATURE_BYTES)) {
    throw new LaunchRuntimeError("INVALID_SIGNATURE", "Eligibility signature must be the approved 65-byte proof.");
  }
  const signatureStart = tailStart + 64;
  const signatureHexLength = Number(signatureLength) * 2;
  const paddedSignatureHexLength = Math.ceil(Number(signatureLength) / 32) * 64;
  const expectedBodyLength = signatureStart + paddedSignatureHexLength;
  if (body.length !== expectedBodyLength) {
    throw new LaunchRuntimeError("INVALID_CALLDATA", "Quote calldata contains trailing or truncated bytes.");
  }
  const signature = `0x${body.slice(signatureStart, signatureStart + signatureHexLength)}`.toLowerCase();
  const padding = body.slice(signatureStart + signatureHexLength, expectedBodyLength);
  if (!/^0*$/.test(padding)) {
    throw new LaunchRuntimeError("INVALID_CALLDATA", "Eligibility signature padding is not canonical.");
  }

  return {
    selector: BUY_NATIVE_SELECTOR,
    minProjectOut: BigInt(`0x${minProjectOutWord}`),
    minStockOut: BigInt(`0x${minStockOutWord}`),
    recipient: `0x${recipientWord.slice(24)}`.toLowerCase(),
    deadline: BigInt(`0x${deadlineWord}`),
    eligibilityDeadline: BigInt(`0x${eligibilityDeadlineWord}`),
    eligibilitySignature: signature,
  };
}

export function validateQuotePayload(payload, {
  market,
  runtime,
  recipient,
  amountWei,
  chainId,
  slippageBps,
  nowMs = Date.now(),
} = {}) {
  if (!payload || typeof payload !== "object") {
    throw new LaunchRuntimeError("INVALID_QUOTE", "Quote response is empty.");
  }
  if (payload.schemaVersion !== 1) {
    throw new LaunchRuntimeError("INVALID_QUOTE", "Unsupported quote schema version.");
  }
  const expiresAt = parseTimestamp(payload.expiresAt, "Quote expiresAt");
  if (expiresAt <= nowMs + 5_000) {
    throw new LaunchRuntimeError("QUOTE_EXPIRED", "Quote expired before wallet submission.");
  }
  if (!runtime?.ready || runtime.expiresAt <= nowMs + 5_000) {
    throw new LaunchRuntimeError("RUNTIME_EXPIRED", "Market readiness expired before quote validation.");
  }
  if (expiresAt > runtime.expiresAt) {
    throw new LaunchRuntimeError("RUNTIME_EXPIRED", "Quote outlives the verified runtime window.");
  }

  const transaction = payload.transaction;
  if (!transaction || typeof transaction !== "object") {
    throw new LaunchRuntimeError("INVALID_QUOTE", "Quote transaction is missing.");
  }
  if (
    normalizeAddress(transaction.to, "Quote target")
    !== normalizeAddress(runtime.canonical?.gatewayAddress, "Official Gateway")
  ) {
    throw new LaunchRuntimeError("INVALID_TARGET", "Quote target is not the official Gateway.");
  }
  if (normalizeChainId(transaction.chainId) !== normalizeChainId(chainId)) {
    throw new LaunchRuntimeError("INVALID_CHAIN", "Quote transaction targets the wrong chain.");
  }

  const expectedAmount = parseUnsignedInteger(amountWei, "Expected input amount");
  const quotedAmount = parseUnsignedInteger(payload.amountInWei, "Quoted input amount");
  const transactionValue = parseUnsignedInteger(transaction.value, "Quote transaction value");
  const expectedSlippageBps = parseSafeNumber(
    slippageBps ?? market.slippageBps ?? runtime.limits.defaultSlippageBps,
    "Requested slippage",
  );
  const quotedSlippageBps = parseSafeNumber(payload.slippageBps, "Quoted slippage");
  if (
    transactionValue <= 0n
    || transactionValue !== expectedAmount
    || quotedAmount !== expectedAmount
  ) {
    throw new LaunchRuntimeError("INVALID_INPUT", "Quote input amount does not match the entered ETH amount.");
  }
  if (
    expectedAmount < runtime.limits.minAmountInWei
    || expectedAmount > runtime.limits.maxAmountInWei
    || expectedSlippageBps <= 0
    || expectedSlippageBps > runtime.limits.maxSlippageBps
    || quotedSlippageBps !== expectedSlippageBps
  ) {
    throw new LaunchRuntimeError("OUTSIDE_LIMITS", "Quote is outside the live market safety limits.");
  }

  const decoded = decodeBuyNativeCalldata(transaction.data);
  if (decoded.recipient !== normalizeAddress(recipient, "Quote recipient")) {
    throw new LaunchRuntimeError("INVALID_RECIPIENT", "Quote recipient does not match the connected wallet.");
  }
  if (decoded.minProjectOut <= 0n || decoded.minStockOut <= 0n) {
    throw new LaunchRuntimeError("ZERO_MIN_OUT", "Quote minimum outputs must both be greater than zero.");
  }
  const nowSeconds = BigInt(Math.floor(nowMs / 1_000));
  if (
    decoded.deadline <= nowSeconds + 5n
    || decoded.eligibilityDeadline <= nowSeconds + 5n
    || decoded.deadline > decoded.eligibilityDeadline
    || decoded.deadline !== BigInt(Math.floor(expiresAt / 1_000))
  ) {
    throw new LaunchRuntimeError(
      "INVALID_DEADLINE",
      "Quote and eligibility deadlines are expired, inconsistent, or not bound to the response.",
    );
  }

  const quotedMinProject = parseUnsignedInteger(payload.minProjectOut, "Quoted project minOut");
  const quotedMinStock = parseUnsignedInteger(payload.minStockOut, "Quoted stock minOut");
  if (quotedMinProject !== decoded.minProjectOut || quotedMinStock !== decoded.minStockOut) {
    throw new LaunchRuntimeError("CALLDATA_MISMATCH", "Quote minimums do not match the transaction calldata.");
  }

  const projectAmountOut = parseUnsignedInteger(payload.projectAmountOut, "Quoted project output");
  const stockAmountOut = parseUnsignedInteger(payload.stockAmountOut, "Quoted stock output");
  if (projectAmountOut < decoded.minProjectOut || stockAmountOut < decoded.minStockOut) {
    throw new LaunchRuntimeError("INVALID_MIN_OUT", "Quoted outputs are below the encoded minimums.");
  }
  const proof = payload.eligibilityProof;
  if (!proof || typeof proof !== "object" || Array.isArray(proof)) {
    throw new LaunchRuntimeError("INVALID_ELIGIBILITY", "Quote eligibility proof is missing.");
  }
  const proofValidUntil = parseUnsignedInteger(proof.validUntil, "Eligibility proof validUntil");
  const proofPolicyHash = String(proof.policyHash || "").toLowerCase();
  const proofSignature = String(proof.signature || "").toLowerCase();
  const proofSigner = normalizeAddress(proof.signer, "Eligibility proof signer");
  const proofChecker = normalizeAddress(proof.checker, "Eligibility proof checker");
  if (
    proofValidUntil !== decoded.eligibilityDeadline
    || proofPolicyHash !== runtime.eligibility.policyHash
    || proofSignature !== decoded.eligibilitySignature
    || !/^0x[0-9a-f]{130}$/.test(proofSignature)
    || proofSigner !== runtime.eligibility.signerAddress
    || proofChecker !== runtime.eligibility.checkerAddress
  ) {
    throw new LaunchRuntimeError(
      "INVALID_ELIGIBILITY",
      "Quote eligibility proof does not match the Gateway runtime and calldata.",
    );
  }

  return {
    expiresAt,
    transaction: {
      to: normalizeAddress(transaction.to),
      data: String(transaction.data).toLowerCase(),
      value: `0x${transactionValue.toString(16)}`,
    },
    decoded,
    eligibilityProof: {
      validUntil: proofValidUntil,
      policyHash: proofPolicyHash,
      signature: proofSignature,
      signer: proofSigner,
      checker: proofChecker,
    },
    quote: {
      projectAmountOut,
      stockAmountOut,
      minProjectOut: decoded.minProjectOut,
      minStockOut: decoded.minStockOut,
    },
  };
}

export async function requestAndValidateQuote({
  market,
  chain,
  wallet,
  amountEth,
  runtime,
  termsAccepted,
  notUSPerson,
  fetchImpl,
  signal,
  nowMs = Date.now(),
} = {}) {
  if (!market?.buyQuoteEndpoint) {
    throw new LaunchRuntimeError("CONFIG_INCOMPLETE", "Quote service is not configured.");
  }
  const recipient = normalizeAddress(wallet, "Wallet");
  const amountWei = parseEthToWei(amountEth);
  const slippageBps = market.slippageBps || runtime?.limits?.defaultSlippageBps;
  if (termsAccepted !== true || notUSPerson !== true) {
    throw new LaunchRuntimeError("ATTESTATION_REQUIRED", "Required eligibility attestations are missing.");
  }

  const payload = await fetchJson(
    market.buyQuoteEndpoint,
    {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        wallet: recipient,
        recipient,
        amountInWei: amountWei.toString(),
        slippageBps,
        termsAccepted: true,
        notUSPerson: true,
      }),
    },
    {
      fetchImpl,
      signal,
      timeoutMs: market.requestTimeoutMs,
      label: "Executable quote",
    },
  );

  return validateQuotePayload(payload, {
    market,
    runtime,
    recipient,
    amountWei,
    chainId: chain.chainIdDecimal,
    slippageBps,
    nowMs,
  });
}

export async function waitForTransactionReceipt({
  ethereum,
  hash,
  gatewayAddress,
  signal,
  timeoutMs = 120_000,
  pollMs = 1_500,
} = {}) {
  if (!ethereum?.request) {
    throw new LaunchRuntimeError("WALLET_UNAVAILABLE", "Wallet provider is unavailable.");
  }
  if (!/^0x[a-fA-F0-9]{64}$/.test(String(hash || ""))) {
    throw new LaunchRuntimeError("INVALID_HASH", "Wallet returned an invalid transaction hash.");
  }

  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (signal?.aborted) {
      throw new LaunchRuntimeError("ABORTED", "Receipt wait was interrupted.");
    }
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      throw new LaunchRuntimeError("OFFLINE", "Transaction was submitted, but confirmation cannot be checked offline.");
    }

    const receipt = await ethereum.request({
      method: "eth_getTransactionReceipt",
      params: [hash],
    });
    if (receipt) {
      if (String(receipt.to || "").toLowerCase() !== normalizeAddress(gatewayAddress, "Official Gateway")) {
        throw new LaunchRuntimeError("INVALID_RECEIPT", "Confirmed transaction did not target the official Gateway.");
      }
      if (String(receipt.status || "").toLowerCase() !== "0x1") {
        throw new LaunchRuntimeError("TRANSACTION_REVERTED", "The 99/1 transaction reverted.");
      }
      return receipt;
    }

    await new Promise((resolve, reject) => {
      const finish = (callback, value) => {
        clearTimeout(timeout);
        signal?.removeEventListener("abort", onAbort);
        callback(value);
      };
      const timeout = setTimeout(() => finish(resolve), pollMs);
      const onAbort = () => {
        finish(reject, new LaunchRuntimeError("ABORTED", "Receipt wait was interrupted."));
      };
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  throw new LaunchRuntimeError("RECEIPT_TIMEOUT", "Transaction is still pending after the confirmation timeout.");
}

export { BUY_NATIVE_SELECTOR };
