import { MARKET, STOCK_PROOF_ROUTE, STOCK_TOKEN } from "./config.js";

const ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;
const INTEGER_PATTERN = /^(0|[1-9][0-9]*)$/;
const DECIMAL_PATTERN = /^(0|[1-9][0-9]*)(?:\.[0-9]+)?$/;

function normalizeAddress(value, label) {
  const address = String(value || "").trim();
  if (!ADDRESS_PATTERN.test(address)) throw new Error(`${label} is invalid`);
  return address.toLowerCase();
}

function normalizeCount(value, label) {
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 0) throw new Error(`${label} is invalid`);
  return count;
}

function normalizeIntegerString(value, label) {
  const integer = String(value ?? "").trim();
  if (!INTEGER_PATTERN.test(integer)) throw new Error(`${label} is invalid`);
  return integer;
}

function normalizeDecimal(value, label) {
  const decimal = String(value ?? "").trim();
  if (!DECIMAL_PATTERN.test(decimal)) throw new Error(`${label} is invalid`);
  return decimal;
}

function normalizeCheckedAt(value) {
  const checkedAt = Date.parse(String(value || ""));
  if (!Number.isFinite(checkedAt)) throw new Error("Holder Stock proof timestamp is invalid");
  return checkedAt;
}

function normalizeDecimals(value, label) {
  const decimals = normalizeCount(value, label);
  if (decimals > 36) throw new Error(`${label} is invalid`);
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

export async function loadHolderStockStats({
  signal,
  officialTokenAddress,
  gatewayAddress,
  activatedBlock,
  fetchImpl = globalThis.fetch,
  nowMs = Date.now(),
  maxAgeMs = MARKET.runtimeMaxAgeMs,
} = {}) {
  if (!MARKET.holderStockStatsEndpoint) throw new Error("Holder Stock proof endpoint is unavailable");
  if (typeof fetchImpl !== "function") throw new Error("Holder Stock proof fetch is unavailable");
  const expectedOfficialToken = normalizeAddress(officialTokenAddress, "Official token CA");
  const expectedGateway = normalizeAddress(gatewayAddress, "Official Gateway");
  const expectedActivatedBlock = normalizeIntegerString(activatedBlock, "Activation block");
  if (BigInt(expectedActivatedBlock) <= 0n) throw new Error("Activation block is invalid");

  const response = await fetchImpl(MARKET.holderStockStatsEndpoint, {
    headers: { accept: "application/json" },
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw new Error(`Holder Stock proof failed (${response.status})`);

  const payload = await response.json();
  if (payload.schemaVersion !== 1) throw new Error("Holder Stock proof schema is unsupported");

  const returnedOfficialToken = normalizeAddress(
    payload.officialTokenAddress,
    "Holder Stock proof token CA",
  );
  if (returnedOfficialToken !== expectedOfficialToken) {
    throw new Error("Holder Stock proof is not bound to the canonical official token");
  }
  const returnedGateway = normalizeAddress(payload.gatewayAddress, "Holder Stock Gateway");
  if (returnedGateway !== expectedGateway) {
    throw new Error("Holder Stock proof is not bound to the canonical Gateway");
  }
  const returnedActivatedBlock = normalizeIntegerString(
    payload.activatedBlock,
    "Holder Stock activation block",
  );
  if (returnedActivatedBlock !== expectedActivatedBlock) {
    throw new Error("Holder Stock proof is not bound to the canonical activation block");
  }

  const stockTokenAddress = normalizeAddress(payload.stockTokenAddress, "Holder Stock QQQ");
  if (stockTokenAddress !== normalizeAddress(MARKET.stockTokenAddress, "Configured QQQ")) {
    throw new Error("Holder Stock proof is not bound to canonical QQQ");
  }
  const settlementTokenAddress = normalizeAddress(
    payload.settlementTokenAddress,
    "Holder Stock settlement token",
  );
  const settlementPoolAddress = normalizeAddress(
    payload.settlementPoolAddress,
    "Holder Stock settlement pool",
  );
  if (
    settlementTokenAddress !== normalizeAddress(
      STOCK_PROOF_ROUTE.settlementTokenAddress,
      "Configured settlement token",
    )
    || settlementPoolAddress !== normalizeAddress(
      STOCK_PROOF_ROUTE.settlementPoolAddress,
      "Configured settlement pool",
    )
  ) {
    throw new Error("Holder Stock proof settlement route is not canonical");
  }

  const selfBuyCount = normalizeCount(payload.selfBuyCount, "Self-buy count");
  const uniqueBuyerCount = normalizeCount(payload.uniqueBuyerCount, "Unique buyer count");
  if (uniqueBuyerCount > selfBuyCount) throw new Error("Unique buyer count exceeds self-buy count");
  const asOfBlock = normalizeIntegerString(payload.asOfBlock, "Holder Stock block");
  const activationPending = payload.status === "activation_pending";
  if (
    (!activationPending && payload.status !== (selfBuyCount === 0 ? "empty" : "ready"))
    || (activationPending && (
      selfBuyCount !== 0
      || BigInt(asOfBlock) >= BigInt(returnedActivatedBlock)
    ))
  ) {
    throw new Error("Holder Stock proof status does not match the confirmed self-buy count");
  }
  const usdgSpentRaw = normalizeIntegerString(payload.usdgSpentRaw, "USDG raw total");
  const qqqAmountOutRaw = normalizeIntegerString(payload.qqqAmountOutRaw, "QQQ raw total");
  const usdgSpent = normalizeDecimal(payload.usdgSpent, "USDG total");
  const qqqAmount = normalizeDecimal(payload.qqqAmount, "QQQ total");
  const approximateUsdValue = normalizeDecimal(
    payload.approximateUsdValue,
    "Nominal dollar total",
  );
  if (
    (selfBuyCount === 0 && (
      usdgSpentRaw !== "0"
      || usdgSpent !== "0"
      || qqqAmountOutRaw !== "0"
      || qqqAmount !== "0"
      || approximateUsdValue !== "0.00"
    ))
    || (selfBuyCount > 0 && (usdgSpentRaw === "0" || qqqAmountOutRaw === "0"))
  ) {
    throw new Error("Holder Stock proof totals do not match the confirmed self-buy count");
  }
  const hasAnyDecimals = payload.usdgDecimals !== undefined || payload.qqqDecimals !== undefined;
  const hasDecimals = payload.usdgDecimals !== undefined && payload.qqqDecimals !== undefined;
  let usdgDecimals = null;
  let qqqDecimals = null;
  if (hasDecimals) {
    usdgDecimals = normalizeDecimals(payload.usdgDecimals, "USDG decimals");
    qqqDecimals = normalizeDecimals(payload.qqqDecimals, "QQQ decimals");
    if (
      usdgDecimals !== STOCK_PROOF_ROUTE.settlementTokenDecimals
      || qqqDecimals !== STOCK_TOKEN.decimals
    ) {
      throw new Error("Holder Stock proof token decimals do not match the canonical route");
    }
    if (
      usdgSpent !== formatUnitsTrimmed(BigInt(usdgSpentRaw), usdgDecimals)
      || qqqAmount !== formatUnitsTrimmed(BigInt(qqqAmountOutRaw), qqqDecimals, 8)
      || approximateUsdValue !== formatNominalUsd(BigInt(usdgSpentRaw), usdgDecimals)
    ) {
      throw new Error("Holder Stock proof formatted totals do not match the raw canonical amounts");
    }
  } else if (hasAnyDecimals || selfBuyCount > 0) {
    throw new Error("Holder Stock proof token decimals are missing");
  }
  if (
    payload.source !== "CONFIRMED_SELF_SPLITBUY_USDG_QQQ_SWAPS"
    || payload.scope !== "CURRENT_CANONICAL_GATEWAY_SINCE_ACTIVATION"
    || payload.valuationBasis !== "USDG_NOMINAL_DOLLAR"
  ) {
    throw new Error("Holder Stock proof methodology is unsupported");
  }

  const updatedAt = normalizeCheckedAt(payload.checkedAt);
  const stale = !Number.isFinite(maxAgeMs)
    || maxAgeMs <= 0
    || updatedAt > nowMs + 30_000
    || nowMs - updatedAt > maxAgeMs;

  return {
    status: activationPending
      ? "activation_pending"
      : stale
        ? "stale"
        : selfBuyCount === 0
          ? "empty"
          : "ready",
    selfBuyCount,
    uniqueBuyerCount,
    usdgSpentRaw,
    usdgSpent,
    qqqAmountOutRaw,
    qqqAmount,
    approximateUsdValue,
    usdgDecimals,
    qqqDecimals,
    officialTokenAddress: returnedOfficialToken,
    gatewayAddress: returnedGateway,
    stockTokenAddress,
    settlementTokenAddress,
    settlementPoolAddress,
    activatedBlock: returnedActivatedBlock,
    asOfBlock,
    source: payload.source,
    scope: payload.scope,
    valuationBasis: payload.valuationBasis,
    checkedAt: new Date(updatedAt).toISOString(),
    updatedAt,
    stale,
    error: null,
  };
}
