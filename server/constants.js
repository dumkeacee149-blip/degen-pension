import { keccak256, parseAbi, parseAbiItem, stringToHex } from "viem";

export const ROBINHOOD_CHAIN_ID = 4663;
export const ROBINHOOD_CHAIN_ID_HEX = "0x1237";
export const ROBINHOOD_RPC_URL = "https://rpc.mainnet.chain.robinhood.com";
export const ROBINHOOD_EXPLORER_URL = "https://robinhoodchain.blockscout.com";

export const CANONICAL_QQQ = "0xD5f3879160bc7c32ebb4dC785F8a4F505888de68";
export const CANONICAL_WETH = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73";
export const CANONICAL_USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
export const CANONICAL_V3_FACTORY = "0x1f7d7550B1b028f7571E69A784071F0205FD2EfA";
export const CANONICAL_SWAP_ROUTER = "0xCaf681a66D020601342297493863E78C959E5cb2";
export const CANONICAL_QUOTER = "0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7";
export const PONS_ACTIVE_FACTORY = "0xA5aAb3F0c6EeadF30Ef1D3Eb997108E976351feB";

export const FACTORY_ABI = parseAbi([
  "function projectAuthority() view returns (address)",
  "function implementation() view returns (address)",
  "function isMarket(address market) view returns (bool)",
]);

export const REGISTRY_ABI = parseAbi([
  "function currentMarket() view returns (address)",
  "function currentOfficialToken() view returns (address)",
  "function currentProjectAdapter() view returns (address)",
  "function stockAdapter() view returns (address)",
  "function currentStockAdapter() view returns (address)",
  "function activatedBlock() view returns (uint256)",
  "function currentActivatedBlock() view returns (uint256)",
  "function activationNonce() view returns (uint256)",
  "function currentVersion() view returns (uint256)",
  "function eligibilityChecker() view returns (address)",
  "function paused() view returns (bool)",
  "function guardian() view returns (address)",
  "function maxAmountIn() view returns (uint256)",
  "function currentPolicyHash() view returns (bytes32)",
  "function marketReady() view returns (bool)",
  "function isMarket(address market) view returns (bool)",
  "function registry() view returns (address)",
  "function protocolVersion() view returns (uint256)",
  "function implementation() view returns (address)",
  "function projectAuthority() view returns (address)",
]);

export const GATEWAY_ABI = parseAbi([
  "function initialized() view returns (bool)",
  "function inputToken() view returns (address)",
  "function officialToken() view returns (address)",
  "function stockToken() view returns (address)",
  "function projectAdapter() view returns (address)",
  "function stockAdapter() view returns (address)",
  "function feeRecipient() view returns (address)",
  "function explicitFeeBps() view returns (uint16)",
  "function eligibilityChecker() view returns (address)",
  "function guardian() view returns (address)",
  "function maxAmountIn() view returns (uint256)",
  "function paused() view returns (bool)",
  "function buyNative(uint256 minProjectOut,uint256 minStockOut,address recipient,uint256 deadline,uint256 eligibilityDeadline,bytes signature) payable returns (uint256 projectAmountOut,uint256 stockAmountOut)",
]);

export const ADAPTER_ABI = parseAbi([
  "function inputToken() view returns (address)",
  "function outputToken() view returns (address)",
  "function quoter() view returns (address)",
  "function router() view returns (address)",
  "function marketRegistry() view returns (address)",
  "function path() view returns (bytes)",
]);

export const ELIGIBILITY_CHECKER_ABI = parseAbi([
  "function eligibilityAuthority() view returns (address)",
  "function policyHash() view returns (bytes32)",
  "function domainSeparator() view returns (bytes32)",
  "function hashEligibility(address market,address payer,address recipient,uint256 validUntil) view returns (bytes32)",
  "function isEligible(address payer,address recipient,uint256 validUntil,bytes proof) view returns (bool)",
  "function policyAdmin() view returns (address)",
]);

export const QUOTER_V2_ABI = parseAbi([
  "function quoteExactInput(bytes path,uint256 amountIn) returns (uint256 amountOut,uint160[] sqrtPriceX96AfterList,uint32[] initializedTicksCrossedList,uint256 gasEstimate)",
]);

export const SPLIT_BUY_EVENT_SIGNATURE =
  "SplitBuy(address,address,uint256,uint256,uint256,uint256,uint256,uint256,uint256)";
export const SPLIT_BUY_TOPIC = keccak256(stringToHex(SPLIT_BUY_EVENT_SIGNATURE));
export const SPLIT_BUY_EVENT = parseAbiItem(
  "event SplitBuy(address indexed payer,address indexed recipient,uint256 grossAmountIn,uint256 explicitFeeAmount,uint256 netAmountIn,uint256 projectAmountIn,uint256 stockAmountIn,uint256 projectAmountOut,uint256 stockAmountOut)",
);

export const QUOTE_TYPED_DATA_TYPES = {
  Eligibility: [
    { name: "market", type: "address" },
    { name: "payer", type: "address" },
    { name: "recipient", type: "address" },
    { name: "validUntil", type: "uint256" },
    { name: "policyHash", type: "bytes32" },
  ],
};
