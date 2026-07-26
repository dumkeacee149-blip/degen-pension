import { getAddress, isAddress } from "viem";
import { ApiError } from "./http.js";
import {
  CANONICAL_QQQ,
  CANONICAL_QQQ_DECIMALS,
  CANONICAL_SWAP_ROUTER,
  CANONICAL_USDG,
  CANONICAL_USDG_DECIMALS,
  CANONICAL_USDG_QQQ_POOL,
  ERC20_DECIMALS_ABI,
  SPLIT_BUY_EVENT,
  UNISWAP_V3_SWAP_EVENT,
} from "./constants.js";
import { getPublicClient, loadRuntime } from "./runtime.js";
import {
  canUseBoundedStatsFallback,
  isStatsIndexerConfigured,
  loadIndexedStatsSnapshot,
} from "./stats-indexer.js";
import { readLimitedText } from "./response.js";

const statsCache = new Map();
const MAX_HOLDER_SOURCE_BYTES = 65_536;
const PRODUCTION_STATS_FOUNDATION_CHECKS = [
  "releaseManifest",
  "rpcChain",
  "foundationCode",
  "factoryAuthority",
  "factoryImplementation",
];
const PRODUCTION_STATS_MARKET_CHECKS = [
  "gatewayCode",
  "gatewayBindings",
  "activatedBlock",
];

function cached(key) {
  const value = statsCache.get(key);
  return value && value.expiresAt > Date.now() ? value.payload : null;
}

function store(config, key, payload) {
  statsCache.set(key, {
    expiresAt: Date.now() + config.statsCacheSeconds * 1_000,
    payload,
  });
  return payload;
}

async function runtimeOrNull(config, runtimeLoader) {
  try {
    return await runtimeLoader(config);
  } catch {
    return null;
  }
}

function canonicalAddress(runtimeValue, configuredValue, label, code) {
  const discovered = runtimeValue && isAddress(runtimeValue)
    ? getAddress(runtimeValue)
    : null;
  const configured = configuredValue && isAddress(configuredValue)
    ? getAddress(configuredValue)
    : null;
  if (discovered && configured && discovered !== configured) {
    throw new ApiError(503, code, `${label} does not match the configured canonical address.`);
  }
  return discovered || configured;
}

function positiveBlock(runtimeValue, configuredValue) {
  const discovered = Number(runtimeValue || 0);
  const configured = Number(configuredValue || 0);
  const validDiscovered = Number.isSafeInteger(discovered) && discovered > 0
    ? discovered
    : 0;
  const validConfigured = Number.isSafeInteger(configured) && configured > 0
    ? configured
    : 0;
  if (validDiscovered && validConfigured && validDiscovered !== validConfigured) {
    throw new ApiError(
      503,
      "ACTIVATION_BLOCK_MISMATCH",
      "Gateway activation block does not match the configured canonical block.",
    );
  }
  return validDiscovered || validConfigured;
}

function runtimeBinding(runtime, name) {
  return runtime?.canonical?.[name] || runtime?.[name];
}

function validateProductionStatsRuntime(config, runtime) {
  if (!runtime || runtime.status === "RPC_UNAVAILABLE") {
    throw new ApiError(
      503,
      "STATS_RUNTIME_UNAVAILABLE",
      "The current V2 Registry runtime could not be read.",
    );
  }

  const registryAddress = runtimeBinding(runtime, "registryAddress");
  if (
    !isAddress(config.registryAddress || "")
    || !isAddress(registryAddress || "")
    || !sameAddress(config.registryAddress, registryAddress)
    || PRODUCTION_STATS_FOUNDATION_CHECKS.some((check) => runtime.checks?.[check] !== true)
  ) {
    throw new ApiError(
      503,
      "STATS_RUNTIME_UNVERIFIED",
      "The current V2 Registry runtime could not be verified.",
    );
  }

  const discoveredOfficialToken = runtimeBinding(runtime, "officialTokenAddress");
  const discoveredGateway = runtimeBinding(runtime, "gatewayAddress");
  const discoveredStockToken = runtimeBinding(runtime, "stockTokenAddress");
  const discoveredActivatedBlock = Number(runtimeBinding(runtime, "activatedBlock") || 0);
  if (
    runtime.marketRegistered !== true
    || !isAddress(discoveredOfficialToken || "")
    || !isAddress(discoveredGateway || "")
    || !isAddress(discoveredStockToken || "")
    || !Number.isSafeInteger(discoveredActivatedBlock)
    || discoveredActivatedBlock <= 0
  ) {
    throw new ApiError(
      503,
      "STATS_MARKET_NOT_CONFIGURED",
      "The current V2 Registry market is not configured.",
    );
  }
  if (
    runtime.gatewayInitializedOnchain !== true
    || PRODUCTION_STATS_MARKET_CHECKS.some((check) => runtime.checks?.[check] !== true)
  ) {
    throw new ApiError(
      503,
      "STATS_RUNTIME_UNVERIFIED",
      "The current V2 Registry market bindings could not be verified.",
    );
  }

  return {
    runtime,
    registryAddress: getAddress(registryAddress),
    officialTokenAddress: canonicalAddress(
      discoveredOfficialToken,
      config.officialTokenAddress,
      "Official token CA",
      "OFFICIAL_TOKEN_MISMATCH",
    ),
    gatewayAddress: canonicalAddress(
      discoveredGateway,
      config.gatewayAddress,
      "Official Gateway",
      "GATEWAY_MISMATCH",
    ),
    stockTokenAddress: canonicalAddress(
      discoveredStockToken,
      config.stockTokenAddress,
      "Stock Token",
      "STOCK_TOKEN_MISMATCH",
    ),
    activatedBlock: positiveBlock(discoveredActivatedBlock, config.activatedBlock),
  };
}

async function loadProductionStatsBindings(config, runtimeLoader) {
  let runtime;
  try {
    runtime = await runtimeLoader(config);
  } catch {
    throw new ApiError(
      503,
      "STATS_RUNTIME_UNAVAILABLE",
      "The current V2 Registry runtime could not be read.",
    );
  }
  return validateProductionStatsRuntime(config, runtime);
}

function normalizeRecipient(recipient) {
  if (recipient === undefined || recipient === null || recipient === "") return null;
  if (typeof recipient !== "string" || !isAddress(recipient.trim())) {
    throw new ApiError(400, "INVALID_RECIPIENT", "Recipient must be a valid EVM address.");
  }
  return getAddress(recipient.trim());
}

function tokenDecimals(value, label) {
  const decimals = Number(value);
  if (!Number.isSafeInteger(decimals) || decimals < 0 || decimals > 36) {
    throw new ApiError(503, "TOKEN_DECIMALS_INVALID", `${label} returned invalid decimals.`);
  }
  return decimals;
}

function formatUnitsTrimmed(value, decimals, maximumFractionDigits = decimals) {
  const scale = 10n ** BigInt(decimals);
  const whole = value / scale;
  const fractionLimit = Math.min(decimals, maximumFractionDigits);
  if (fractionLimit === 0) return whole.toString();
  const fraction = (value % scale)
    .toString()
    .padStart(decimals, "0")
    .slice(0, fractionLimit)
    .replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function formatNominalUsd(value, decimals) {
  const scale = 10n ** BigInt(decimals);
  const cents = (value * 100n + scale / 2n) / scale;
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, "0")}`;
}

function unsignedIntegerString(value, label) {
  const normalized = String(value ?? "");
  if (!/^(0|[1-9][0-9]*)$/.test(normalized)) {
    throw new ApiError(503, "STATS_INDEXER_PAYLOAD_INVALID", `${label} is invalid.`);
  }
  return normalized;
}

function safeCount(value, label) {
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new ApiError(503, "STATS_INDEXER_PAYLOAD_INVALID", `${label} is invalid.`);
  }
  return count;
}

function sameAddress(left, right) {
  return isAddress(String(left || ""))
    && isAddress(String(right || ""))
    && getAddress(String(left)) === getAddress(String(right));
}

function validateIndexedEnvelope(config, payload, {
  gatewayAddress,
  officialTokenAddress,
  stockTokenAddress,
  activatedBlock,
}) {
  const checkedAtMs = Date.parse(payload.checkedAt || "");
  const now = Date.now();
  const asOfBlock = unsignedIntegerString(payload.asOfBlock, "asOfBlock");
  const confirmations = safeCount(payload.confirmations, "confirmations");
  if (
    payload.schemaVersion !== 1
    || Number(payload.chainId) !== config.chainId
    || !sameAddress(payload.gatewayAddress, gatewayAddress)
    || !sameAddress(payload.officialTokenAddress, officialTokenAddress)
    || !sameAddress(payload.stockTokenAddress, stockTokenAddress)
    || String(payload.activatedBlock) !== String(activatedBlock)
    || confirmations < config.confirmations
    || BigInt(asOfBlock) < BigInt(activatedBlock) - 1n
    || !Number.isFinite(checkedAtMs)
    || checkedAtMs > now + 30_000
    || now - checkedAtMs > config.statsIndexerMaxAgeSeconds * 1_000
  ) {
    throw new ApiError(
      503,
      "STATS_INDEXER_BINDING_MISMATCH",
      "Stats indexer snapshot is stale or does not match the canonical market.",
    );
  }
  return { asOfBlock, checkedAt: new Date(checkedAtMs).toISOString() };
}

function indexedMemberSnapshot(config, payload, bindings, recipient) {
  const envelope = validateIndexedEnvelope(config, payload, bindings);
  const memberCount = safeCount(payload.members?.memberCount, "memberCount");
  const buyCount = safeCount(payload.members?.buyCount, "buyCount");
  if (buyCount < memberCount || payload.members?.scope !== "ALL_CANONICAL_GATEWAY_EPOCHS") {
    throw new ApiError(503, "STATS_INDEXER_PAYLOAD_INVALID", "Member totals are inconsistent.");
  }
  let memberNumber = null;
  if (recipient) {
    if (!sameAddress(payload.members?.recipient, recipient)) {
      throw new ApiError(503, "STATS_INDEXER_BINDING_MISMATCH", "Member lookup recipient does not match.");
    }
    if (payload.members.memberNumber !== null) {
      memberNumber = safeCount(payload.members.memberNumber, "memberNumber");
      if (memberNumber < 1 || memberNumber > memberCount) {
        throw new ApiError(503, "STATS_INDEXER_PAYLOAD_INVALID", "Member number is out of range.");
      }
    }
  }
  return {
    schemaVersion: 1,
    memberCount,
    buyCount,
    gatewayAddress: bindings.gatewayAddress,
    asOfBlock: envelope.asOfBlock,
    source: "CONFIRMED_SPLITBUY_LOGS",
    scope: "ALL_CANONICAL_GATEWAY_EPOCHS",
    dataPlane: "SIGNED_DURABLE_INDEXER",
    checkedAt: envelope.checkedAt,
    ...(recipient ? { recipient, memberNumber } : {}),
  };
}

function indexedHolderStockSnapshot(config, payload, bindings) {
  const envelope = validateIndexedEnvelope(config, payload, bindings);
  const proof = payload.holderStock;
  const selfBuyCount = safeCount(proof?.selfBuyCount, "selfBuyCount");
  const uniqueBuyerCount = safeCount(proof?.uniqueBuyerCount, "uniqueBuyerCount");
  const usdgSpentRaw = unsignedIntegerString(proof?.usdgSpentRaw, "usdgSpentRaw");
  const qqqAmountOutRaw = unsignedIntegerString(proof?.qqqAmountOutRaw, "qqqAmountOutRaw");
  const expectedStatus = selfBuyCount > 0
    ? "ready"
    : (BigInt(envelope.asOfBlock) < BigInt(bindings.activatedBlock) ? "activation_pending" : "empty");
  if (
    !proof
    || proof.status !== expectedStatus
    || uniqueBuyerCount > selfBuyCount
    || Number(proof.usdgDecimals) !== CANONICAL_USDG_DECIMALS
    || Number(proof.qqqDecimals) !== CANONICAL_QQQ_DECIMALS
    || !sameAddress(proof.settlementTokenAddress, CANONICAL_USDG)
    || !sameAddress(proof.settlementPoolAddress, CANONICAL_USDG_QQQ_POOL)
    || proof.source !== "CONFIRMED_SELF_SPLITBUY_USDG_QQQ_SWAPS"
    || proof.scope !== "CURRENT_CANONICAL_GATEWAY_SINCE_ACTIVATION"
    || proof.valuationBasis !== "USDG_NOMINAL_DOLLAR"
    || proof.qualification !== "PAYER_EQUALS_RECIPIENT_AND_ALL_SPLIT_AMOUNTS_POSITIVE"
    || proof.usdgSpent !== formatUnitsTrimmed(BigInt(usdgSpentRaw), CANONICAL_USDG_DECIMALS)
    || proof.qqqAmount !== formatUnitsTrimmed(BigInt(qqqAmountOutRaw), CANONICAL_QQQ_DECIMALS, 8)
    || proof.approximateUsdValue !== formatNominalUsd(BigInt(usdgSpentRaw), CANONICAL_USDG_DECIMALS)
    || (selfBuyCount === 0 && (usdgSpentRaw !== "0" || qqqAmountOutRaw !== "0"))
    || (selfBuyCount > 0 && (usdgSpentRaw === "0" || qqqAmountOutRaw === "0"))
  ) {
    throw new ApiError(503, "STATS_INDEXER_PAYLOAD_INVALID", "Holder Stock totals are inconsistent.");
  }
  return {
    schemaVersion: 1,
    status: proof.status,
    selfBuyCount,
    uniqueBuyerCount,
    usdgSpentRaw,
    usdgSpent: proof.usdgSpent,
    usdgDecimals: CANONICAL_USDG_DECIMALS,
    qqqAmountOutRaw,
    qqqAmount: proof.qqqAmount,
    qqqDecimals: CANONICAL_QQQ_DECIMALS,
    approximateUsdValue: proof.approximateUsdValue,
    officialTokenAddress: bindings.officialTokenAddress,
    gatewayAddress: bindings.gatewayAddress,
    stockTokenAddress: bindings.stockTokenAddress,
    settlementTokenAddress: CANONICAL_USDG,
    settlementPoolAddress: CANONICAL_USDG_QQQ_POOL,
    activatedBlock: String(bindings.activatedBlock),
    asOfBlock: envelope.asOfBlock,
    source: proof.source,
    scope: proof.scope,
    valuationBasis: proof.valuationBasis,
    qualification: proof.qualification,
    dataPlane: "SIGNED_DURABLE_INDEXER",
    checkedAt: envelope.checkedAt,
  };
}

export async function loadHolderCount(config, {
  fetchImpl = fetch,
  runtimeLoader = loadRuntime,
} = {}) {
  const productionBindings = config.vercelEnvironment === "production"
    ? await loadProductionStatsBindings(config, runtimeLoader)
    : null;
  const runtime = productionBindings
    ? productionBindings.runtime
    : (config.officialTokenAddress ? null : await runtimeOrNull(config, runtimeLoader));
  const officialTokenAddress = productionBindings?.officialTokenAddress || canonicalAddress(
    runtimeBinding(runtime, "officialTokenAddress"),
    config.officialTokenAddress,
    "Official token CA",
    "OFFICIAL_TOKEN_MISMATCH",
  );
  if (!officialTokenAddress) {
    throw new ApiError(503, "OFFICIAL_TOKEN_NOT_CONFIGURED", "Official token CA is not configured.");
  }
  const key = `holders:${officialTokenAddress}`;
  const cachedValue = cached(key);
  if (cachedValue) return cachedValue;

  let response;
  try {
    response = await fetchImpl(
      `${config.explorerUrl}/api/v2/tokens/${officialTokenAddress}`,
      {
        headers: { accept: "application/json" },
        redirect: "error",
        signal: AbortSignal.timeout(config.rpcTimeoutMs),
      },
    );
  } catch {
    throw new ApiError(503, "HOLDER_SOURCE_UNAVAILABLE", "Holder source did not respond.");
  }
  if (!response.ok) {
    throw new ApiError(503, "HOLDER_SOURCE_UNAVAILABLE", "Holder source rejected the request.");
  }
  let payload;
  try {
    payload = JSON.parse(await readLimitedText(response, MAX_HOLDER_SOURCE_BYTES));
  } catch {
    throw new ApiError(503, "HOLDER_SOURCE_INVALID", "Holder source returned invalid JSON.");
  }
  const holderCount = Number(payload.holders_count);
  if (!Number.isSafeInteger(holderCount) || holderCount < 0) {
    throw new ApiError(503, "HOLDER_SOURCE_INVALID", "Holder source returned an invalid count.");
  }
  return store(config, key, {
    schemaVersion: 1,
    holderCount,
    officialTokenAddress,
    source: "BLOCKSCOUT_TOKEN_API",
    checkedAt: new Date().toISOString(),
  });
}

function compareLogPosition(left, right) {
  const fields = ["blockNumber", "transactionIndex", "logIndex"];
  for (const field of fields) {
    if (left[field] === undefined || right[field] === undefined) continue;
    const leftValue = BigInt(left[field]);
    const rightValue = BigInt(right[field]);
    if (leftValue < rightValue) return -1;
    if (leftValue > rightValue) return 1;
  }
  return left.__index - right.__index;
}

function publicMemberSnapshot(snapshot, recipient) {
  const { memberNumbers, ...payload } = snapshot;
  if (!recipient) return payload;
  return {
    ...payload,
    recipient,
    memberNumber: memberNumbers.get(recipient.toLowerCase()) ?? null,
  };
}

export async function loadMemberCount(config, {
  runtimeLoader = loadRuntime,
  clientFactory = getPublicClient,
  fetchImpl = fetch,
  recipient: recipientInput,
} = {}) {
  const recipient = normalizeRecipient(recipientInput);
  const productionBindings = config.vercelEnvironment === "production"
    ? await loadProductionStatsBindings(config, runtimeLoader)
    : null;
  const runtime = productionBindings
    ? productionBindings.runtime
    : (config.gatewayAddress && config.activatedBlock
      ? null
      : await runtimeOrNull(config, runtimeLoader));
  const gatewayAddress = productionBindings?.gatewayAddress || canonicalAddress(
    runtimeBinding(runtime, "gatewayAddress"),
    config.gatewayAddress,
    "Official Gateway",
    "GATEWAY_MISMATCH",
  );
  const activatedBlock = productionBindings?.activatedBlock || positiveBlock(
    runtimeBinding(runtime, "activatedBlock"),
    config.activatedBlock,
  );
  if (!gatewayAddress || !activatedBlock) {
    throw new ApiError(503, "GATEWAY_NOT_CONFIGURED", "Official Gateway is not configured.");
  }
  const officialTokenAddress = productionBindings?.officialTokenAddress || canonicalAddress(
    runtimeBinding(runtime, "officialTokenAddress"),
    config.officialTokenAddress,
    "Official token CA",
    "OFFICIAL_TOKEN_MISMATCH",
  );
  const stockTokenAddress = productionBindings?.stockTokenAddress || config.stockTokenAddress;
  if (isStatsIndexerConfigured(config)) {
    if (!officialTokenAddress || !stockTokenAddress) {
      throw new ApiError(
        503,
        "STATS_INDEXER_BINDINGS_INCOMPLETE",
        "The trusted indexer requires canonical CA, Gateway, and QQQ bindings.",
      );
    }
    const indexedKey = `members:indexer:${gatewayAddress}:${activatedBlock}:${recipient || "all"}`;
    const cachedValue = cached(indexedKey);
    if (cachedValue) return cachedValue;
    const bindings = {
      gatewayAddress,
      officialTokenAddress,
      stockTokenAddress,
      activatedBlock,
    };
    const payload = await loadIndexedStatsSnapshot(config, {
      ...bindings,
      recipient,
      fetchImpl,
    });
    return store(config, indexedKey, indexedMemberSnapshot(config, payload, bindings, recipient));
  }
  if (!canUseBoundedStatsFallback(config)) {
    throw new ApiError(
      503,
      "STATS_INDEXER_REQUIRED",
      "A trusted durable stats indexer is required; bounded RPC fallback is disabled.",
    );
  }
  const key = `members:${gatewayAddress}:${activatedBlock}`;
  const cachedValue = cached(key);
  if (cachedValue) return publicMemberSnapshot(cachedValue, recipient);

  const client = clientFactory(config);
  let latest;
  try {
    latest = await client.getBlockNumber();
  } catch {
    throw new ApiError(503, "RPC_UNAVAILABLE", "RPC did not return the latest block.");
  }
  const confirmationLag = config.confirmations > 0
    ? BigInt(config.confirmations - 1)
    : 0n;
  const safeBlock = latest >= confirmationLag
    ? latest - confirmationLag
    : 0n;
  const fromBlock = BigInt(activatedBlock);
  if (safeBlock < fromBlock) {
    const snapshot = store(config, key, {
      schemaVersion: 1,
      memberCount: 0,
      buyCount: 0,
      gatewayAddress,
      asOfBlock: safeBlock.toString(),
      source: "CONFIRMED_SPLITBUY_LOGS",
      scope: "CURRENT_CANONICAL_GATEWAY_SINCE_ACTIVATION",
      dataPlane: "BOUNDED_RPC_FALLBACK",
      checkedAt: new Date().toISOString(),
      memberNumbers: new Map(),
    });
    return publicMemberSnapshot(snapshot, recipient);
  }
  const scanBlocks = safeBlock - fromBlock + 1n;
  if (scanBlocks > BigInt(config.memberMaxScanBlocks)) {
    throw new ApiError(
      503,
      "MEMBER_INDEX_REQUIRED",
      "Confirmed log range exceeds the safe serverless scan limit.",
    );
  }

  const memberNumbers = new Map();
  let buyCount = 0;
  const chunk = BigInt(config.memberLogChunk);
  try {
    for (let start = fromBlock; start <= safeBlock; start += chunk) {
      const end = start + chunk - 1n > safeBlock ? safeBlock : start + chunk - 1n;
      const logs = await client.getLogs({
        address: gatewayAddress,
        event: SPLIT_BUY_EVENT,
        fromBlock: start,
        toBlock: end,
        strict: true,
      });
      const orderedLogs = logs
        .map((log, index) => ({ ...log, __index: index }))
        .sort(compareLogPosition);
      for (const log of orderedLogs) {
        if (!log.args.recipient || !log.args.stockAmountOut || log.args.stockAmountOut <= 0n) continue;
        const normalized = log.args.recipient.toLowerCase();
        if (!memberNumbers.has(normalized)) {
          memberNumbers.set(normalized, memberNumbers.size + 1);
        }
        buyCount += 1;
      }
    }
  } catch {
    throw new ApiError(503, "MEMBER_LOG_SCAN_FAILED", "Confirmed SplitBuy logs could not be scanned.");
  }

  const snapshot = store(config, key, {
    schemaVersion: 1,
    memberCount: memberNumbers.size,
    buyCount,
    gatewayAddress,
    asOfBlock: safeBlock.toString(),
    source: "CONFIRMED_SPLITBUY_LOGS",
    scope: "CURRENT_CANONICAL_GATEWAY_SINCE_ACTIVATION",
    dataPlane: "BOUNDED_RPC_FALLBACK",
    checkedAt: new Date().toISOString(),
    memberNumbers,
  });
  return publicMemberSnapshot(snapshot, recipient);
}

export async function loadHolderStockProof(config, {
  runtimeLoader = loadRuntime,
  clientFactory = getPublicClient,
  fetchImpl = fetch,
} = {}) {
  if (!Number.isSafeInteger(config.confirmations) || config.confirmations < 1) {
    throw new ApiError(
      503,
      "STOCK_PROOF_CONFIRMATIONS_INVALID",
      "Holder Stock proof requires at least one confirmation.",
    );
  }
  let runtime;
  let productionBindings = null;
  if (config.vercelEnvironment === "production") {
    productionBindings = await loadProductionStatsBindings(config, runtimeLoader);
    runtime = productionBindings.runtime;
  } else {
    try {
      runtime = await runtimeLoader(config);
    } catch {
      throw new ApiError(503, "STOCK_PROOF_RUNTIME_UNAVAILABLE", "Canonical runtime could not be verified.");
    }
  }
  const requiredRuntimeChecks = [
    "rpcChain",
    "foundationCode",
    "factoryAuthority",
    "factoryImplementation",
    "gatewayCode",
    "gatewayBindings",
    "adapterCode",
    "adapterBindings",
    "quoterCode",
    "quoteRoutes",
    "activatedBlock",
  ];
  if (
    !runtime
    || !isAddress(runtime.registryAddress || "")
    || runtime.marketRegistered !== true
    || runtime.gatewayInitializedOnchain !== true
    || requiredRuntimeChecks.some((check) => runtime.checks?.[check] !== true)
  ) {
    throw new ApiError(
      503,
      "STOCK_PROOF_RUNTIME_UNVERIFIED",
      "Canonical CA, Gateway, and settlement route checks are incomplete.",
    );
  }
  const officialTokenAddress = productionBindings?.officialTokenAddress || canonicalAddress(
    runtimeBinding(runtime, "officialTokenAddress"),
    config.officialTokenAddress,
    "Official token CA",
    "OFFICIAL_TOKEN_MISMATCH",
  );
  const gatewayAddress = productionBindings?.gatewayAddress || canonicalAddress(
    runtimeBinding(runtime, "gatewayAddress"),
    config.gatewayAddress,
    "Official Gateway",
    "GATEWAY_MISMATCH",
  );
  const stockTokenAddress = productionBindings?.stockTokenAddress || canonicalAddress(
    runtimeBinding(runtime, "stockTokenAddress"),
    config.stockTokenAddress,
    "Stock Token",
    "STOCK_TOKEN_MISMATCH",
  );
  const activatedBlock = productionBindings?.activatedBlock || positiveBlock(
    runtimeBinding(runtime, "activatedBlock"),
    config.activatedBlock,
  );
  if (!officialTokenAddress || !gatewayAddress || !activatedBlock) {
    throw new ApiError(
      503,
      "STOCK_PROOF_NOT_CONFIGURED",
      "Official CA, Gateway, and activation block are required.",
    );
  }
  if (!stockTokenAddress || stockTokenAddress.toLowerCase() !== CANONICAL_QQQ.toLowerCase()) {
    throw new ApiError(503, "STOCK_TOKEN_MISMATCH", "The canonical QQQ binding is unavailable.");
  }

  const registryAddress = productionBindings?.registryAddress || getAddress(runtime.registryAddress);
  const statsSource = isStatsIndexerConfigured(config) ? config.statsIndexerUrl : "bounded-rpc";
  const key = `holder-stock:${statsSource}:${registryAddress}:${officialTokenAddress}:${gatewayAddress}:${activatedBlock}`;
  const cachedValue = cached(key);
  if (cachedValue) return cachedValue;

  const bindings = {
    gatewayAddress,
    officialTokenAddress,
    stockTokenAddress,
    activatedBlock,
  };
  if (isStatsIndexerConfigured(config)) {
    const payload = await loadIndexedStatsSnapshot(config, {
      ...bindings,
      fetchImpl,
    });
    return store(config, key, indexedHolderStockSnapshot(config, payload, bindings));
  }
  if (!canUseBoundedStatsFallback(config)) {
    throw new ApiError(
      503,
      "STATS_INDEXER_REQUIRED",
      "A trusted durable stats indexer is required; bounded RPC fallback is disabled.",
    );
  }

  const client = clientFactory(config);
  let latest;
  try {
    latest = await client.getBlockNumber();
  } catch {
    throw new ApiError(503, "RPC_UNAVAILABLE", "RPC did not return the latest block.");
  }
  const confirmationLag = config.confirmations > 0
    ? BigInt(config.confirmations - 1)
    : 0n;
  const safeBlock = latest >= confirmationLag
    ? latest - confirmationLag
    : 0n;
  const fromBlock = BigInt(activatedBlock);
  if (safeBlock < fromBlock) {
    return store(config, key, {
      schemaVersion: 1,
      status: "activation_pending",
      selfBuyCount: 0,
      uniqueBuyerCount: 0,
      usdgSpentRaw: "0",
      usdgSpent: "0",
      qqqAmountOutRaw: "0",
      qqqAmount: "0",
      approximateUsdValue: "0.00",
      officialTokenAddress,
      gatewayAddress,
      stockTokenAddress,
      settlementTokenAddress: CANONICAL_USDG,
      settlementPoolAddress: CANONICAL_USDG_QQQ_POOL,
      activatedBlock: String(activatedBlock),
      asOfBlock: safeBlock.toString(),
      source: "CONFIRMED_SELF_SPLITBUY_USDG_QQQ_SWAPS",
      scope: "CURRENT_CANONICAL_GATEWAY_SINCE_ACTIVATION",
      valuationBasis: "USDG_NOMINAL_DOLLAR",
      qualification: "PAYER_EQUALS_RECIPIENT_AND_ALL_SPLIT_AMOUNTS_POSITIVE",
      dataPlane: "BOUNDED_RPC_FALLBACK",
      checkedAt: new Date().toISOString(),
    });
  }
  const scanBlocks = safeBlock - fromBlock + 1n;
  if (scanBlocks > BigInt(config.memberMaxScanBlocks)) {
    throw new ApiError(
      503,
      "STOCK_PROOF_INDEX_REQUIRED",
      "Confirmed log range exceeds the safe serverless scan limit.",
    );
  }

  let selfBuyCount = 0;
  let totalUsdgSpent = 0n;
  let totalQqqAmountOut = 0n;
  const uniqueBuyers = new Set();
  const seenSplitBuys = new Set();
  const consumedSwaps = new Set();
  const chunk = BigInt(config.memberLogChunk);
  try {
    for (let start = fromBlock; start <= safeBlock; start += chunk) {
      const end = start + chunk - 1n > safeBlock ? safeBlock : start + chunk - 1n;
      const [splitLogs, swapLogs] = await Promise.all([
        client.getLogs({
          address: gatewayAddress,
          event: SPLIT_BUY_EVENT,
          fromBlock: start,
          toBlock: end,
          strict: true,
        }),
        client.getLogs({
          address: CANONICAL_USDG_QQQ_POOL,
          event: UNISWAP_V3_SWAP_EVENT,
          fromBlock: start,
          toBlock: end,
          strict: true,
        }),
      ]);
      const swapsByTransaction = new Map();
      for (const [index, log] of swapLogs.entries()) {
        const hash = String(log.transactionHash || "").toLowerCase();
        if (!/^0x[a-f0-9]{64}$/.test(hash)) continue;
        const list = swapsByTransaction.get(hash) || [];
        list.push({ ...log, __index: index });
        swapsByTransaction.set(hash, list);
      }
      for (const list of swapsByTransaction.values()) list.sort(compareLogPosition);

      const orderedSplitLogs = splitLogs
        .map((log, index) => ({ ...log, __index: index }))
        .sort(compareLogPosition);
      for (const log of orderedSplitLogs) {
        const payer = String(log.args.payer || "").toLowerCase();
        const recipient = String(log.args.recipient || "").toLowerCase();
        const projectAmountIn = BigInt(log.args.projectAmountIn || 0n);
        const stockAmountIn = BigInt(log.args.stockAmountIn || 0n);
        const projectAmountOut = BigInt(log.args.projectAmountOut || 0n);
        const stockAmountOut = BigInt(log.args.stockAmountOut || 0n);
        if (
          !isAddress(payer)
          || !isAddress(recipient)
          || payer !== recipient
          || projectAmountIn <= 0n
          || stockAmountIn <= 0n
          || projectAmountOut <= 0n
          || stockAmountOut <= 0n
        ) {
          continue;
        }
        const transactionHash = String(log.transactionHash || "").toLowerCase();
        const splitLogIndex = log.logIndex === undefined || log.logIndex === null
          ? null
          : BigInt(log.logIndex);
        const splitKey = `${transactionHash}:${String(splitLogIndex)}`;
        if (
          !/^0x[a-f0-9]{64}$/.test(transactionHash)
          || splitLogIndex === null
          || splitLogIndex < 0n
          || seenSplitBuys.has(splitKey)
        ) {
          throw new ApiError(503, "STOCK_PROOF_LOG_INVALID", "A confirmed SplitBuy log is invalid.");
        }
        seenSplitBuys.add(splitKey);

        const matches = (swapsByTransaction.get(transactionHash) || []).filter((swap) => {
          const swapLogIndex = swap.logIndex === undefined || swap.logIndex === null
            ? null
            : BigInt(swap.logIndex);
          const swapKey = `${transactionHash}:${String(swapLogIndex)}`;
          const swapSender = String(swap.args.sender || "").toLowerCase();
          const swapRecipient = String(swap.args.recipient || "").toLowerCase();
          const amount0 = BigInt(swap.args.amount0 || 0n);
          const amount1 = BigInt(swap.args.amount1 || 0n);
          return swapLogIndex !== null
            && swapLogIndex >= 0n
            && swapLogIndex < splitLogIndex
            && !consumedSwaps.has(swapKey)
            && swapSender === CANONICAL_SWAP_ROUTER.toLowerCase()
            && swapRecipient === recipient
            && amount0 > 0n
            && amount1 < 0n
            && -amount1 === stockAmountOut;
        });
        if (matches.length !== 1) {
          throw new ApiError(
            503,
            "STOCK_PROOF_SWAP_MISMATCH",
            "A confirmed SplitBuy could not be matched to one canonical USDG to QQQ swap.",
          );
        }
        consumedSwaps.add(`${transactionHash}:${String(matches[0].logIndex)}`);

        selfBuyCount += 1;
        uniqueBuyers.add(recipient);
        totalUsdgSpent += BigInt(matches[0].args.amount0);
        totalQqqAmountOut += stockAmountOut;
      }
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(503, "STOCK_PROOF_LOG_SCAN_FAILED", "Confirmed trade logs could not be scanned.");
  }

  let usdgDecimals;
  let qqqDecimals;
  try {
    [usdgDecimals, qqqDecimals] = await Promise.all([
      client.readContract({
        address: CANONICAL_USDG,
        abi: ERC20_DECIMALS_ABI,
        functionName: "decimals",
      }),
      client.readContract({
        address: CANONICAL_QQQ,
        abi: ERC20_DECIMALS_ABI,
        functionName: "decimals",
      }),
    ]);
  } catch {
    throw new ApiError(503, "STOCK_PROOF_DECIMALS_UNAVAILABLE", "Token decimals could not be verified.");
  }
  usdgDecimals = tokenDecimals(usdgDecimals, "USDG");
  qqqDecimals = tokenDecimals(qqqDecimals, "QQQ");
  if (
    usdgDecimals !== CANONICAL_USDG_DECIMALS
    || qqqDecimals !== CANONICAL_QQQ_DECIMALS
  ) {
    throw new ApiError(
      503,
      "STOCK_PROOF_DECIMALS_MISMATCH",
      "Canonical settlement token decimals do not match the verified route.",
    );
  }

  return store(config, key, {
    schemaVersion: 1,
    status: selfBuyCount === 0 ? "empty" : "ready",
    selfBuyCount,
    uniqueBuyerCount: uniqueBuyers.size,
    usdgSpentRaw: totalUsdgSpent.toString(),
    usdgSpent: formatUnitsTrimmed(totalUsdgSpent, usdgDecimals),
    usdgDecimals,
    qqqAmountOutRaw: totalQqqAmountOut.toString(),
    qqqAmount: formatUnitsTrimmed(totalQqqAmountOut, qqqDecimals, 8),
    qqqDecimals,
    approximateUsdValue: formatNominalUsd(totalUsdgSpent, usdgDecimals),
    officialTokenAddress,
    gatewayAddress,
    stockTokenAddress,
    settlementTokenAddress: CANONICAL_USDG,
    settlementPoolAddress: CANONICAL_USDG_QQQ_POOL,
    activatedBlock: String(activatedBlock),
    asOfBlock: safeBlock.toString(),
    source: "CONFIRMED_SELF_SPLITBUY_USDG_QQQ_SWAPS",
    scope: "CURRENT_CANONICAL_GATEWAY_SINCE_ACTIVATION",
    valuationBasis: "USDG_NOMINAL_DOLLAR",
    qualification: "PAYER_EQUALS_RECIPIENT_AND_ALL_SPLIT_AMOUNTS_POSITIVE",
    dataPlane: "BOUNDED_RPC_FALLBACK",
    checkedAt: new Date().toISOString(),
  });
}

export function __resetStatsCacheForTests() {
  statsCache.clear();
}
