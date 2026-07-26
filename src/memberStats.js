import { MARKET } from "./config.js";

const ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;

function normalizeCount(value, label) {
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 0) throw new Error(`Invalid ${label}`);
  return count;
}

function normalizeAddress(value, label) {
  const address = String(value || "").trim();
  if (!ADDRESS_PATTERN.test(address)) throw new Error(`${label} is invalid`);
  return address.toLowerCase();
}

function normalizeCheckedAt(value) {
  const checkedAt = Date.parse(String(value || ""));
  if (!Number.isFinite(checkedAt)) throw new Error("Member snapshot timestamp is invalid");
  return checkedAt;
}

function endpointForRecipient(endpoint, recipient) {
  if (!recipient) return endpoint;
  const separator = endpoint.includes("?") ? "&" : "?";
  return `${endpoint}${separator}recipient=${encodeURIComponent(recipient)}`;
}

export async function loadMemberStats({
  recipient,
  signal,
  gatewayAddress,
  fetchImpl = globalThis.fetch,
  nowMs = Date.now(),
  maxAgeMs = MARKET.runtimeMaxAgeMs,
} = {}) {
  if (!MARKET.memberStatsEndpoint) throw new Error("Member endpoint is unavailable");
  if (typeof fetchImpl !== "function") throw new Error("Member fetch is unavailable");

  const expectedGateway = gatewayAddress
    ? normalizeAddress(gatewayAddress, "Canonical Gateway")
    : null;
  const expectedRecipient = recipient
    ? normalizeAddress(recipient, "Recipient")
    : null;
  const response = await fetchImpl(
    endpointForRecipient(MARKET.memberStatsEndpoint, expectedRecipient),
    {
      headers: { accept: "application/json" },
      cache: "no-store",
      signal,
    },
  );
  if (!response.ok) throw new Error(`Member index failed (${response.status})`);

  const payload = await response.json();
  const returnedGateway = normalizeAddress(payload.gatewayAddress, "Member snapshot Gateway");
  if (expectedGateway && returnedGateway !== expectedGateway) {
    throw new Error("Member snapshot is not bound to the canonical Gateway");
  }

  const memberCount = normalizeCount(
    payload.memberCount ?? payload.uniqueRecipients,
    "member count",
  );
  const buyCount = normalizeCount(
    payload.buyCount ?? payload.splitBuys,
    "buy count",
  );
  if (buyCount < memberCount) throw new Error("Member snapshot counts are inconsistent");

  const asOfBlock = normalizeCount(payload.asOfBlock, "confirmed block");
  const checkedAtMs = normalizeCheckedAt(payload.checkedAt);
  const stale = !Number.isFinite(maxAgeMs)
    || maxAgeMs <= 0
    || checkedAtMs > nowMs + 30_000
    || nowMs - checkedAtMs > maxAgeMs;

  let memberNumber = null;
  if (expectedRecipient) {
    const returnedRecipient = normalizeAddress(payload.recipient, "Member snapshot recipient");
    if (returnedRecipient !== expectedRecipient) {
      throw new Error("Member snapshot is not bound to the requested recipient");
    }
    if (!Object.hasOwn(payload, "memberNumber")) {
      throw new Error("Member snapshot omitted the requested member number");
    }
    if (payload.memberNumber !== null) {
      memberNumber = normalizeCount(payload.memberNumber, "member number");
      if (memberNumber < 1 || memberNumber > memberCount) {
        throw new Error("Member number is outside the canonical member range");
      }
    }
  }

  return {
    status: stale ? "stale" : memberCount === 0 && buyCount === 0 ? "empty" : "ready",
    memberCount,
    buyCount,
    memberNumber,
    recipient: expectedRecipient,
    asOfBlock,
    source: String(payload.source || "index"),
    checkedAt: new Date(checkedAtMs).toISOString(),
    gatewayAddress: returnedGateway,
    stale,
    error: null,
  };
}
