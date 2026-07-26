export const PRODUCTION_DEPLOYMENT = Object.freeze({
  chainIdDecimal: 4663,
  chainName: "Robinhood Chain",
  explorer: "https://robinhoodchain.blockscout.com",
  marketFactoryAddress: "0xeE5b5Cc20264Eb76C0F462efCabc823cA65E76c9",
  gatewayImplementationAddress: "0xAC5A2Cf5e3ab76f9d5EC7A2Ac5983732E5211919",
  projectAuthority: "0x1373910FB6A73b640CdFBd980a776ED88f924247",
  canonicalQqqAddress: "0xD5f3879160bc7c32ebb4dC785F8a4F505888de68",
  factorySourceVerified: true,
  gatewayImplementationSourceVerified: true,
  gatewayImplementationLocked: true,
  marketActive: false,
  officialTokenAddress: "",
  activeMarketAddress: "",
});

export function explorerAddress(address) {
  return `${PRODUCTION_DEPLOYMENT.explorer}/address/${address}`;
}
