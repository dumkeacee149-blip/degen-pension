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
