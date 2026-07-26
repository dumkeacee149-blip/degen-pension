import productionManifest from "../contracts/deployments/robinhood-mainnet.json" with { type: "json" };
import { isAddressEqual } from "viem";

const ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;
const HASH_PATTERN = /^0x[a-fA-F0-9]{64}$/;
const PRODUCTION_MANIFEST_ID = "robinhood-mainnet-production-v2";
const PRODUCTION_CHAIN_ID = 4663;
const PRODUCTION_PROTOCOL_VERSION = 2;

function address(value) {
  const normalized = String(value || "");
  return ADDRESS_PATTERN.test(normalized) && !/^0x0{40}$/i.test(normalized);
}

function hash(value) {
  return HASH_PATTERN.test(String(value || ""));
}

function sameAddress(left, right) {
  return address(left) && address(right) && isAddressEqual(left, right);
}

function sameHash(left, right) {
  return hash(left) && hash(right) && String(left).toLowerCase() === String(right).toLowerCase();
}

function sameUnsignedInteger(left, right) {
  try {
    return BigInt(left) >= 0n && BigInt(left) === BigInt(right);
  } catch {
    return false;
  }
}

export function isValidProductionReleaseManifest(manifest) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) return false;
  if (
    manifest.schemaVersion !== 1
    || manifest.manifestId !== PRODUCTION_MANIFEST_ID
    || manifest.network !== "Robinhood Chain"
    || manifest.chainId !== PRODUCTION_CHAIN_ID
    || manifest.protocolVersion !== PRODUCTION_PROTOCOL_VERSION
    || !address(manifest.registry)
    || !address(manifest.deployer)
    || !address(manifest.projectAuthority)
    || !address(manifest.launchOperator)
    || !address(manifest.guardian)
    || !address(manifest.gatewayImplementation)
    || !hash(manifest.gatewayImplementationRuntimeCodeHash)
    || !address(manifest.eligibilityChecker)
    || !address(manifest.eligibilityAuthority)
    || !hash(manifest.eligibilityPolicyHash)
    || !address(manifest.stockAdapter)
    || !address(manifest.ponsAdapterFactory)
    || manifest.gatewayImplementationLocked !== true
    || manifest.operatorAuthorized !== true
    || manifest.registrySourceVerified !== true
    || manifest.gatewayImplementationSourceVerified !== true
    || manifest.eligibilityCheckerSourceVerified !== true
    || manifest.stockAdapterSourceVerified !== true
    || manifest.ponsAdapterFactorySourceVerified !== true
    || manifest.maxAmountInWei !== "10000000000000000000"
  ) {
    return false;
  }
  if (manifest.tradingActive === true) {
    return address(manifest.currentOfficialToken)
      && address(manifest.currentMarket)
      && Number.isSafeInteger(manifest.currentActivatedBlock)
      && manifest.currentActivatedBlock > 0;
  }
  return manifest.tradingActive === false
    && manifest.currentOfficialToken === null
    && manifest.currentMarket === null
    && manifest.currentActivatedBlock === 0;
}

export const PRODUCTION_RELEASE_MANIFEST = Object.freeze({ ...productionManifest });

export function releaseManifestConfigMatches(config, manifest = PRODUCTION_RELEASE_MANIFEST) {
  if (!isValidProductionReleaseManifest(manifest)) return false;
  return Number(config.chainId) === manifest.chainId
    && sameAddress(config.registryAddress, manifest.registry)
    && sameAddress(config.expectedAuthority, manifest.projectAuthority)
    && sameAddress(config.expectedImplementation, manifest.gatewayImplementation)
    && sameHash(config.expectedImplementationCodeHash, manifest.gatewayImplementationRuntimeCodeHash)
    && sameAddress(config.expectedEligibilityChecker, manifest.eligibilityChecker)
    && sameHash(config.expectedEligibilityPolicyHash, manifest.eligibilityPolicyHash)
    && (!config.officialTokenAddress
      || sameAddress(config.officialTokenAddress, manifest.currentOfficialToken))
    && (!config.gatewayAddress || sameAddress(config.gatewayAddress, manifest.currentMarket))
    && (!config.activatedBlock || config.activatedBlock === manifest.currentActivatedBlock);
}

export function releaseManifestSnapshotMatches(snapshot, manifest = PRODUCTION_RELEASE_MANIFEST) {
  if (!isValidProductionReleaseManifest(manifest) || manifest.tradingActive !== true) return false;
  return Number(snapshot.chainId) === manifest.chainId
    && Number(snapshot.protocolVersion) === manifest.protocolVersion
    && sameAddress(snapshot.registryAddress, manifest.registry)
    && sameAddress(snapshot.projectAuthorityAddress, manifest.projectAuthority)
    && sameAddress(snapshot.officialTokenAddress, manifest.currentOfficialToken)
    && sameAddress(snapshot.gatewayAddress, manifest.currentMarket)
    && Number(snapshot.activatedBlock) === manifest.currentActivatedBlock
    && sameAddress(snapshot.implementationAddress, manifest.gatewayImplementation)
    && sameHash(snapshot.implementationCodeHash, manifest.gatewayImplementationRuntimeCodeHash)
    && sameAddress(snapshot.eligibilityCheckerAddress, manifest.eligibilityChecker)
    && sameAddress(snapshot.eligibilityAuthorityAddress, manifest.eligibilityAuthority)
    && sameHash(snapshot.policyHash, manifest.eligibilityPolicyHash)
    && sameAddress(snapshot.stockAdapterAddress, manifest.stockAdapter)
    && sameUnsignedInteger(snapshot.maxAmountInWei, manifest.maxAmountInWei)
    && snapshot.marketReady === true;
}

export function releaseManifestRuntimeMatches(
  config,
  runtime,
  manifest = PRODUCTION_RELEASE_MANIFEST,
) {
  return releaseManifestConfigMatches(config, manifest)
    && runtime?.checks?.releaseManifest === true
    && runtime?.releaseManifest?.manifestId === manifest.manifestId
    && runtime?.releaseManifest?.tradingActive === true
    && runtime?.releaseManifest?.bound === true
    && releaseManifestSnapshotMatches({
      chainId: runtime?.chainId,
      protocolVersion: runtime?.protocolVersion,
      registryAddress: runtime?.registryAddress || runtime?.factoryAddress,
      projectAuthorityAddress: runtime?.projectAuthorityAddress,
      officialTokenAddress: runtime?.officialTokenAddress,
      gatewayAddress: runtime?.gatewayAddress,
      activatedBlock: runtime?.activatedBlock,
      implementationAddress: runtime?.implementationAddress,
      implementationCodeHash: runtime?.implementationCodeHash,
      eligibilityCheckerAddress: runtime?.eligibilityCheckerAddress,
      eligibilityAuthorityAddress: runtime?.eligibilitySignerAddress,
      policyHash: runtime?.policyHash,
      stockAdapterAddress: runtime?.stockAdapterAddress,
      maxAmountInWei: runtime?.onchainMaximumBuyWei,
      marketReady: runtime?.checks?.factoryMarket === true,
    }, manifest);
}

export function publicReleaseManifestState({
  production,
  manifest = PRODUCTION_RELEASE_MANIFEST,
  bound = false,
} = {}) {
  if (!production) {
    return Object.freeze({ required: false, manifestId: null, tradingActive: null, bound: true });
  }
  const valid = isValidProductionReleaseManifest(manifest);
  return Object.freeze({
    required: true,
    manifestId: valid ? manifest.manifestId : null,
    tradingActive: valid ? manifest.tradingActive : false,
    bound: valid && bound === true,
  });
}
