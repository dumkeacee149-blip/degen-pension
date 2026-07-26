import { getAddress, isAddress } from "viem";
import { ApiError } from "./http.js";
import { SPLIT_BUY_EVENT } from "./constants.js";
import { getPublicClient, loadRuntime } from "./runtime.js";

const statsCache = new Map();

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

function normalizeRecipient(recipient) {
  if (recipient === undefined || recipient === null || recipient === "") return null;
  if (typeof recipient !== "string" || !isAddress(recipient.trim())) {
    throw new ApiError(400, "INVALID_RECIPIENT", "Recipient must be a valid EVM address.");
  }
  return getAddress(recipient.trim());
}

export async function loadHolderCount(config, {
  fetchImpl = fetch,
  runtimeLoader = loadRuntime,
} = {}) {
  const runtime = config.officialTokenAddress
    ? null
    : await runtimeOrNull(config, runtimeLoader);
  const officialTokenAddress = canonicalAddress(
    runtime?.canonical?.officialTokenAddress || runtime?.officialTokenAddress,
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
    payload = await response.json();
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
  recipient: recipientInput,
} = {}) {
  const recipient = normalizeRecipient(recipientInput);
  const runtime = config.gatewayAddress && config.activatedBlock
    ? null
    : await runtimeOrNull(config, runtimeLoader);
  const gatewayAddress = canonicalAddress(
    runtime?.canonical?.gatewayAddress || runtime?.gatewayAddress,
    config.gatewayAddress,
    "Official Gateway",
    "GATEWAY_MISMATCH",
  );
  const activatedBlock = positiveBlock(
    runtime?.canonical?.activatedBlock || runtime?.activatedBlock,
    config.activatedBlock,
  );
  if (!gatewayAddress || !activatedBlock) {
    throw new ApiError(503, "GATEWAY_NOT_CONFIGURED", "Official Gateway is not configured.");
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
  const safeBlock = latest > BigInt(config.confirmations)
    ? latest - BigInt(config.confirmations)
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
    checkedAt: new Date().toISOString(),
    memberNumbers,
  });
  return publicMemberSnapshot(snapshot, recipient);
}

export function __resetStatsCacheForTests() {
  statsCache.clear();
}
