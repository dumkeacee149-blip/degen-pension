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

const isDevelopment = Boolean(import.meta.env.DEV);
const devValue = (name) => isDevelopment ? String(import.meta.env[name] || "").trim() : "";
const gatewayAddress = devValue("VITE_GATEWAY_ADDRESS");
const officialTokenAddress = devValue("VITE_OFFICIAL_TOKEN_ADDRESS");
const factoryAddress = devValue("VITE_MARKET_FACTORY_ADDRESS");
const inputTokenAddress = devValue("VITE_INPUT_TOKEN_ADDRESS");
const projectAdapterAddress = devValue("VITE_PROJECT_ADAPTER_ADDRESS");
const stockAdapterAddress = devValue("VITE_STOCK_ADAPTER_ADDRESS");
const activatedBlockValue = Number(devValue("VITE_GATEWAY_ACTIVATED_BLOCK") || 0);
const confirmationsValue = Number(import.meta.env.VITE_LOG_CONFIRMATIONS || 12);
const explicitFeeBpsText = devValue("VITE_EXPLICIT_FEE_BPS");
const explicitFeeBpsValue = explicitFeeBpsText === "" ? null : Number(explicitFeeBpsText);
const slippageBpsText = devValue("VITE_SLIPPAGE_BPS");
const slippageBpsValue = slippageBpsText === "" ? 0 : Number(slippageBpsText);
const runtimeStatusEndpoint = devValue("VITE_RUNTIME_STATUS_ENDPOINT") || "/api/runtime";
const eligibilityEndpoint = devValue("VITE_ELIGIBILITY_ENDPOINT") || "/api/eligibility";
const buyQuoteEndpoint = devValue("VITE_BUY_QUOTE_ENDPOINT") || "/api/quote";
const memberStatsEndpoint = devValue("VITE_MEMBER_STATS_ENDPOINT") || "/api/members";
const holderStatsEndpoint = devValue("VITE_HOLDER_STATS_ENDPOINT") || "/api/holders";
const requestTimeoutValue = Number(import.meta.env.VITE_REQUEST_TIMEOUT_MS || 8_000);
const receiptTimeoutValue = Number(import.meta.env.VITE_RECEIPT_TIMEOUT_MS || 120_000);
const runtimeMaxAgeValue = Number(import.meta.env.VITE_RUNTIME_MAX_AGE_MS || 120_000);
const runtimeRefreshValue = Number(import.meta.env.VITE_RUNTIME_REFRESH_MS || 10_000);
const isAddress = (value) => /^0x[a-fA-F0-9]{40}$/.test(value);
const isEndpoint = (value) => (
  /^\/(?!\/)/.test(value)
  || /^https:\/\//i.test(value)
  || (isDevelopment && /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?(?:\/|$)/i.test(value))
);
const validActivatedBlock = Number.isSafeInteger(activatedBlockValue) && activatedBlockValue > 0;
const validExplicitFeeBps = explicitFeeBpsValue === null || (Number.isSafeInteger(explicitFeeBpsValue)
  && explicitFeeBpsValue >= 0
  && explicitFeeBpsValue <= 500);
const validSlippageBps = slippageBpsValue === 0 || (Number.isSafeInteger(slippageBpsValue)
  && slippageBpsValue > 0
  && slippageBpsValue <= 1_000);
const validRequestTimeout = Number.isSafeInteger(requestTimeoutValue)
  && requestTimeoutValue >= 2_000
  && requestTimeoutValue <= 30_000;
const validReceiptTimeout = Number.isSafeInteger(receiptTimeoutValue)
  && receiptTimeoutValue >= 30_000
  && receiptTimeoutValue <= 300_000;
const validRuntimeMaxAge = Number.isSafeInteger(runtimeMaxAgeValue)
  && runtimeMaxAgeValue >= 30_000
  && runtimeMaxAgeValue <= 600_000;
const validRuntimeRefresh = Number.isSafeInteger(runtimeRefreshValue)
  && runtimeRefreshValue >= 5_000
  && runtimeRefreshValue <= 300_000;
const bootstrapConfigured = Boolean(
  validExplicitFeeBps
  && validSlippageBps
  && isEndpoint(runtimeStatusEndpoint)
  && isEndpoint(eligibilityEndpoint)
  && isEndpoint(buyQuoteEndpoint)
  && isEndpoint(memberStatsEndpoint)
  && isEndpoint(holderStatsEndpoint)
);

export const MARKET = Object.freeze({
  gatewayAddress,
  officialTokenAddress,
  factoryAddress,
  stockTokenAddress: STOCK_TOKEN.address,
  inputTokenAddress,
  projectAdapterAddress,
  stockAdapterAddress,
  activatedBlock: validActivatedBlock ? activatedBlockValue : 0,
  confirmations: Number.isSafeInteger(confirmationsValue) && confirmationsValue >= 0
    ? confirmationsValue
    : 12,
  explicitFeeBps: validExplicitFeeBps ? explicitFeeBpsValue : null,
  slippageBps: validSlippageBps ? slippageBpsValue : 0,
  memberStatsEndpoint,
  holderStatsEndpoint,
  runtimeStatusEndpoint,
  eligibilityEndpoint,
  buyQuoteEndpoint,
  requestTimeoutMs: validRequestTimeout ? requestTimeoutValue : 8_000,
  receiptTimeoutMs: validReceiptTimeout ? receiptTimeoutValue : 120_000,
  runtimeMaxAgeMs: validRuntimeMaxAge ? runtimeMaxAgeValue : 120_000,
  runtimeRefreshMs: validRuntimeRefresh ? runtimeRefreshValue : 10_000,
  tokenConfigured: isAddress(officialTokenAddress),
  bootstrapConfigured,
  marketReady: false,
});
