import { MARKET, ROBINHOOD_CHAIN } from "./config.js";

export const SPLIT_BUY_TOPIC =
  "0x3f48157d8f14c00327e39782f0aeb0f0de21cacab1712f09548ce09aca7d921c";

const LOG_BLOCK_CHUNK = 20_000;

function toHex(value) {
  return `0x${Number(value).toString(16)}`;
}

function normalizeCount(value) {
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 0) throw new Error("Invalid member count");
  return count;
}

async function rpc(method, params, signal) {
  const response = await fetch(ROBINHOOD_CHAIN.rpcUrls[0], {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal,
  });
  if (!response.ok) throw new Error(`RPC request failed (${response.status})`);
  const payload = await response.json();
  if (payload.error) throw new Error(payload.error.message || "RPC returned an error");
  return payload.result;
}

async function loadIndexedStats(signal) {
  const response = await fetch(MARKET.memberStatsEndpoint, {
    headers: { accept: "application/json" },
    signal,
  });
  if (!response.ok) throw new Error(`Member index failed (${response.status})`);
  const payload = await response.json();
  return {
    status: "ready",
    memberCount: normalizeCount(payload.memberCount ?? payload.uniqueRecipients),
    buyCount: normalizeCount(payload.buyCount ?? payload.splitBuys ?? 0),
    asOfBlock: payload.asOfBlock ? Number(payload.asOfBlock) : null,
    source: "index",
  };
}

async function scanGatewayStats(signal) {
  const latestBlock = Number.parseInt(await rpc("eth_blockNumber", [], signal), 16);
  if (!Number.isSafeInteger(latestBlock) || latestBlock < 0) {
    throw new Error("RPC returned an invalid latest block");
  }
  const safeBlock = Math.max(0, latestBlock - MARKET.confirmations);
  if (safeBlock < MARKET.activatedBlock) {
    return {
      status: "ready",
      memberCount: 0,
      buyCount: 0,
      asOfBlock: safeBlock,
      source: "rpc",
    };
  }
  const recipients = new Set();
  let buyCount = 0;

  for (let fromBlock = MARKET.activatedBlock; fromBlock <= safeBlock; fromBlock += LOG_BLOCK_CHUNK) {
    const toBlock = Math.min(fromBlock + LOG_BLOCK_CHUNK - 1, safeBlock);
    const logs = await rpc(
      "eth_getLogs",
      [{
        address: MARKET.gatewayAddress,
        fromBlock: toHex(fromBlock),
        toBlock: toHex(toBlock),
        topics: [SPLIT_BUY_TOPIC],
      }],
      signal,
    );

    for (const log of logs) {
      const recipientTopic = log.topics?.[2];
      const stockAmountOutWord = log.data?.slice(-64);
      if (!recipientTopic || !stockAmountOutWord) continue;
      if (BigInt(`0x${stockAmountOutWord}`) === 0n) continue;
      recipients.add(`0x${recipientTopic.slice(-40)}`.toLowerCase());
      buyCount += 1;
    }
  }

  return {
    status: "ready",
    memberCount: recipients.size,
    buyCount,
    asOfBlock: safeBlock,
    source: "rpc",
  };
}

export async function loadMemberStats({ signal } = {}) {
  if (!MARKET.marketReady) {
    return {
      status: "prelaunch",
      memberCount: null,
      buyCount: null,
      asOfBlock: null,
      source: "none",
    };
  }
  if (MARKET.memberStatsEndpoint) return loadIndexedStats(signal);
  return scanGatewayStats(signal);
}
