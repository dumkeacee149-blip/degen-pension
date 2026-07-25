export const ROBINHOOD_CHAIN = Object.freeze({
  chainId: "0x1237",
  chainIdDecimal: 4663,
  chainName: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: ["https://rpc.mainnet.chain.robinhood.com"],
  blockExplorerUrls: ["https://robinhoodchain.blockscout.com"],
});

export const STOCK_TOKEN = Object.freeze({
  symbol: "QQQ",
  name: "Invesco QQQ • Robinhood Token",
  address: "0xD5f3879160bc7c32ebb4dC785F8a4F505888de68",
  chainId: 4663,
  statusAtVerification: "ASSET_STATUS_ACTIVE",
  verifiedAt: "2026-07-24T23:56:00+08:00",
  registryUrl: "https://api.robinhood.com/rhj/assets",
});

const gatewayAddress = String(import.meta.env.VITE_GATEWAY_ADDRESS || "").trim();
const officialTokenAddress = String(import.meta.env.VITE_OFFICIAL_TOKEN_ADDRESS || "").trim();
const activatedBlockValue = Number(import.meta.env.VITE_GATEWAY_ACTIVATED_BLOCK || 0);
const confirmationsValue = Number(import.meta.env.VITE_LOG_CONFIRMATIONS || 12);
const explicitFeeBpsValue = Number(import.meta.env.VITE_EXPLICIT_FEE_BPS || 0);
const isAddress = (value) => /^0x[a-fA-F0-9]{40}$/.test(value);
const validActivatedBlock = Number.isSafeInteger(activatedBlockValue) && activatedBlockValue > 0;

export const MARKET = Object.freeze({
  gatewayAddress,
  officialTokenAddress,
  activatedBlock: validActivatedBlock ? activatedBlockValue : 0,
  confirmations: Number.isSafeInteger(confirmationsValue) && confirmationsValue >= 0
    ? confirmationsValue
    : 12,
  explicitFeeBps: Number.isSafeInteger(explicitFeeBpsValue) && explicitFeeBpsValue >= 0 && explicitFeeBpsValue <= 500
    ? explicitFeeBpsValue
    : 0,
  memberStatsEndpoint: String(import.meta.env.VITE_MEMBER_STATS_ENDPOINT || "").trim(),
  buyQuoteEndpoint: String(import.meta.env.VITE_BUY_QUOTE_ENDPOINT || "").trim(),
  marketReady: Boolean(isAddress(gatewayAddress) && isAddress(officialTokenAddress) && validActivatedBlock),
});
