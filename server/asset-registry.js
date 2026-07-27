import { CANONICAL_QQQ } from "./constants.js";
import { readLimitedText } from "./response.js";

const ACTIVE = "ASSET_STATUS_ACTIVE";
const TRADABLE = "TRADING_STATUS_TRADABLE";

function unavailable(checkedAt) {
  return {
    verified: false,
    tokenSymbol: null,
    status: null,
    marketWhole: null,
    marketFractional: null,
    checkedAt,
  };
}

export async function checkStockAssetRegistry(config, { fetchImpl = fetch } = {}) {
  const checkedAt = new Date().toISOString();
  if (!config.stockAssetRegistryCheckEnabled) return unavailable(checkedAt);
  let response;
  try {
    response = await fetchImpl(config.stockAssetRegistryUrl, {
      method: "GET",
      headers: { accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(config.stockAssetRegistryTimeoutMs),
    });
  } catch {
    return unavailable(checkedAt);
  }
  if (!response.ok) return unavailable(checkedAt);

  let payload;
  try {
    const raw = await readLimitedText(response, config.stockAssetRegistryMaxBytes);
    payload = JSON.parse(raw);
  } catch {
    return unavailable(checkedAt);
  }
  const assets = payload?.assets;
  if (!Array.isArray(assets)) return unavailable(checkedAt);

  const matches = [];
  for (const asset of assets) {
    if (!Array.isArray(asset?.deployments)) continue;
    for (const deployment of asset.deployments) {
      if (
        Number(deployment?.chainId) === config.chainId
        && String(deployment?.contractAddress || "").toLowerCase() === CANONICAL_QQQ.toLowerCase()
      ) {
        matches.push(asset);
      }
    }
  }
  if (matches.length !== 1) return unavailable(checkedAt);

  const asset = matches[0];
  const marketWhole = asset.tradingCapabilities?.market?.whole || null;
  const marketFractional = asset.tradingCapabilities?.market?.fractional || null;
  return {
    verified: asset.tokenSymbol === "QQQ"
      && asset.status === ACTIVE
      && marketWhole === TRADABLE
      && marketFractional === TRADABLE,
    tokenSymbol: asset.tokenSymbol || null,
    status: asset.status || null,
    marketWhole,
    marketFractional,
    checkedAt,
  };
}
