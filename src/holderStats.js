import { MARKET } from "./config.js";

const ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;

function normalizeHolderCount(value) {
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 0) throw new Error("Invalid holder count");
  return count;
}

function normalizeAddress(value, label) {
  const address = String(value || "").trim();
  if (!ADDRESS_PATTERN.test(address)) throw new Error(`${label} is invalid`);
  return address.toLowerCase();
}

function normalizeCheckedAt(value) {
  const checkedAt = Date.parse(String(value || ""));
  if (!Number.isFinite(checkedAt)) throw new Error("Holder snapshot timestamp is invalid");
  return checkedAt;
}

export async function loadHolderStats({
  signal,
  officialTokenAddress,
  fetchImpl = globalThis.fetch,
  nowMs = Date.now(),
  maxAgeMs = MARKET.runtimeMaxAgeMs,
} = {}) {
  if (!MARKET.holderStatsEndpoint) throw new Error("Holder endpoint is unavailable");
  if (typeof fetchImpl !== "function") throw new Error("Holder fetch is unavailable");

  const expectedToken = officialTokenAddress
    ? normalizeAddress(officialTokenAddress, "Official token CA")
    : null;
  const response = await fetchImpl(MARKET.holderStatsEndpoint, {
    headers: { accept: "application/json" },
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw new Error(`Holder index failed (${response.status})`);

  const payload = await response.json();
  const returnedToken = normalizeAddress(payload.officialTokenAddress, "Holder snapshot token CA");
  if (expectedToken && returnedToken !== expectedToken) {
    throw new Error("Holder snapshot is not bound to the canonical official token");
  }

  const holderCount = normalizeHolderCount(
    payload.holderCount ?? payload.holders_count ?? payload.holders,
  );
  const updatedAt = normalizeCheckedAt(payload.checkedAt);
  const stale = !Number.isFinite(maxAgeMs)
    || maxAgeMs <= 0
    || updatedAt > nowMs + 30_000
    || nowMs - updatedAt > maxAgeMs;

  return {
    status: stale ? "stale" : holderCount === 0 ? "empty" : "ready",
    holderCount,
    source: String(payload.source || "index"),
    updatedAt,
    checkedAt: new Date(updatedAt).toISOString(),
    officialTokenAddress: returnedToken,
    stale,
    error: null,
  };
}
