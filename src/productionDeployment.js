import productionManifest from "../contracts/deployments/robinhood-mainnet.json" with { type: "json" };

const LEGACY_V1_FOUNDATION = Object.freeze({
  marketFactoryAddress: "0xeE5b5Cc20264Eb76C0F462efCabc823cA65E76c9",
  gatewayImplementationAddress: "0xAC5A2Cf5e3ab76f9d5EC7A2Ac5983732E5211919",
  projectAuthority: "0x1373910FB6A73b640CdFBd980a776ED88f924247",
  factorySourceVerified: true,
  gatewayImplementationSourceVerified: true,
  status: "LEGACY_V1_REFERENCE_ONLY",
});

export const PRODUCTION_DEPLOYMENT = Object.freeze({
  manifestId: productionManifest.manifestId,
  protocolVersion: productionManifest.protocolVersion,
  status: productionManifest.status,
  chainIdDecimal: productionManifest.chainId,
  chainName: productionManifest.network,
  explorer: "https://robinhoodchain.blockscout.com",
  deployedAt: productionManifest.deployedAt,
  deploymentBlockNumber: productionManifest.blockNumber,
  deploymentTransactionHash: productionManifest.transactionHash,
  registryAddress: productionManifest.registry,
  gatewayImplementationAddress: productionManifest.gatewayImplementation,
  gatewayImplementationCodeHash: productionManifest.gatewayImplementationRuntimeCodeHash,
  gatewayImplementationLocked: productionManifest.gatewayImplementationLocked,
  eligibilityCheckerAddress: productionManifest.eligibilityChecker,
  stockAdapterAddress: productionManifest.stockAdapter,
  ponsAdapterFactoryAddress: productionManifest.ponsAdapterFactory,
  projectAuthority: productionManifest.projectAuthority,
  launchOperator: productionManifest.launchOperator,
  guardian: productionManifest.guardian,
  eligibilityAuthority: productionManifest.eligibilityAuthority,
  eligibilityPolicyHash: productionManifest.eligibilityPolicyHash,
  operatorAuthorized: productionManifest.operatorAuthorized,
  registrySourceVerified: productionManifest.registrySourceVerified,
  gatewayImplementationSourceVerified: productionManifest.gatewayImplementationSourceVerified,
  eligibilityCheckerSourceVerified: productionManifest.eligibilityCheckerSourceVerified,
  stockAdapterSourceVerified: productionManifest.stockAdapterSourceVerified,
  ponsAdapterFactorySourceVerified: productionManifest.ponsAdapterFactorySourceVerified,
  tradingActive: productionManifest.tradingActive,
  marketActive: productionManifest.tradingActive,
  officialTokenAddress: productionManifest.currentOfficialToken || "",
  activeMarketAddress: productionManifest.currentMarket || "",
  activatedBlock: productionManifest.currentActivatedBlock,
  legacyV1Foundation: LEGACY_V1_FOUNDATION,
});

export function explorerAddress(address) {
  return `${PRODUCTION_DEPLOYMENT.explorer}/address/${address}`;
}
