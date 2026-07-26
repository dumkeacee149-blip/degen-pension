import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import process from "node:process";
import {
  createPublicClient,
  decodeEventLog,
  decodeFunctionData,
  decodeFunctionResult,
  formatEther,
  getAddress,
  http,
  isAddress,
  isAddressEqual,
  keccak256,
  parseAbi,
  recoverMessageAddress,
  zeroAddress,
} from "viem";

// This address is the immutable project authority, not the launch operator.
// Keep the legacy export because the public deployment record imports it.
export const CONTROL_WALLET = "0x1373910FB6A73b640CdFBd980a776ED88f924247";
export const ELIGIBILITY_AUTHORITY = "0xE1f58F712f7A98D37D82CaD9F039e2c9b0f0b367";
export const ELIGIBILITY_POLICY_HASH =
  "0xb4367ebc10997be2f01f45b58197b507e9637ee66570eaf9b329cd3455b834cf";

const PROJECT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const DEPLOYMENT_MANIFEST_FILE = resolve(
  PROJECT_DIR,
  "contracts/deployments/robinhood-mainnet.json",
);
const RPC_URL = "https://rpc.mainnet.chain.robinhood.com";
const SITE_URL = "https://degen-pension.vercel.app";
const PONS_FACTORY = "0xA5aAb3F0c6EeadF30Ef1D3Eb997108E976351feB";
const WETH = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73";
const CANONICAL_QQQ = "0xD5f3879160bc7c32ebb4dC785F8a4F505888de68";
const V3_FACTORY = "0x1f7d7550B1b028f7571E69A784071F0205FD2EfA";
const PONS_POOL_FEE = 10_000;
const DEFAULT_PROBE_AMOUNT_WEI = 100_000_000_000_000n;
const DEFAULT_CANARY_CONFIRMATIONS = 12;
const DEFAULT_CANARY_MAX_AMOUNT_WEI = 10_000_000_000_000_000n;
const DEFAULT_CANARY_MAX_CONFIRMATIONS = 10_000;
const OPERATOR_PROOF_TTL_SECONDS = 5 * 60;
const OPERATOR_PROOF_FUTURE_SKEW_SECONDS = 15;
const MAX_RUNTIME_AGE_MS = 90_000;
const MAX_RUNTIME_VALIDITY_MS = 75_000;
const REQUIRED_RUNTIME_CHECKS = Object.freeze([
  "releaseManifest",
  "rpcChain",
  "foundationCode",
  "factoryAuthority",
  "factoryImplementation",
  "factoryMarket",
  "gatewayCode",
  "gatewayInitialized",
  "gatewayBindings",
  "adapterCode",
  "adapterBindings",
  "quoterCode",
  "quoteRoutes",
  "eligibilityProvider",
  "eligibilityChecker",
  "eligibilitySigner",
  "policyHash",
  "activatedBlock",
  "statsIndexer",
  "distributedRateLimit",
  "monitoring",
  "independentAudit",
  "stockAssetRegistry",
]);
export const LEGACY_VERCEL_RUNTIME_KEYS = Object.freeze([
  "FACTORY_ADDRESS",
  "GATEWAY_ADDRESS",
  "OFFICIAL_TOKEN_ADDRESS",
  "GATEWAY_ACTIVATED_BLOCK",
]);

const issuedOperatorChallenges = new Map();
const consumedOperatorProofs = new Set();
const usedOperatorProofsForGate = new Set();
const completedOperatorProofsForGate = new Set();

const registryAbi = parseAbi([
  "function operatorAuthorized() view returns (bool)",
  "function launchOperator() view returns (address)",
  "function projectAuthority() view returns (address)",
  "function guardian() view returns (address)",
  "function implementation() view returns (address)",
  "function eligibilityChecker() view returns (address)",
  "function stockAdapter() view returns (address)",
  "function ponsAdapterFactory() view returns (address)",
  "function maxAmountIn() view returns (uint256)",
  "function currentMarket() view returns (address)",
  "function currentOfficialToken() view returns (address)",
  "function currentActivatedBlock() view returns (uint256)",
  "function marketReady() view returns (bool)",
  "function activatePonsMarket(address officialToken) returns (address market,address projectAdapter)",
]);

const checkerAbi = parseAbi([
  "function eligibilityAuthority() view returns (address)",
  "function policyAdmin() view returns (address)",
  "function policyHash() view returns (bytes32)",
]);

const implementationAbi = parseAbi([
  "function initialized() view returns (bool)",
  "function paused() view returns (bool)",
]);

const gatewayAbi = parseAbi([
  "function buyNative(uint256 minProjectOut,uint256 minStockOut,address recipient,uint256 deadline,uint256 eligibilityDeadline,bytes signature) payable returns (uint256 projectAmountOut,uint256 stockAmountOut)",
]);

const splitBuyEventAbi = parseAbi([
  "event SplitBuy(address indexed payer,address indexed recipient,uint256 grossAmountIn,uint256 explicitFeeAmount,uint256 netAmountIn,uint256 projectAmountIn,uint256 stockAmountIn,uint256 projectAmountOut,uint256 stockAmountOut)",
]);

const ponsFactoryAbi = [{
  type: "function",
  name: "getLaunchedToken",
  stateMutability: "view",
  inputs: [{ name: "token", type: "address" }],
  outputs: [{
    name: "launched",
    type: "tuple",
    components: [
      { name: "token", type: "address" },
      { name: "deployer", type: "address" },
      { name: "pairedToken", type: "address" },
      { name: "positionManager", type: "address" },
      { name: "positionId", type: "uint256" },
      { name: "dexId", type: "uint256" },
      { name: "launchConfigId", type: "uint256" },
      { name: "restrictionsEndBlock", type: "uint256" },
      { name: "supply", type: "uint256" },
      { name: "isToken0", type: "bool" },
      { name: "poolFee", type: "uint24" },
      { name: "exists", type: "bool" },
      { name: "initialBuyAmount", type: "uint256" },
    ],
  }],
}];

const v3FactoryAbi = parseAbi([
  "function getPool(address tokenA,address tokenB,uint24 fee) view returns (address pool)",
]);
const tokenAbi = parseAbi(["function liquidityPool() view returns (address pool)"]);

const client = createPublicClient({
  chain: {
    id: 4663,
    name: "Robinhood Chain",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [RPC_URL] } },
  },
  transport: http(RPC_URL, { timeout: 20_000, retryCount: 2 }),
});

function same(left, right) {
  return Boolean(left && right && isAddressEqual(left, right));
}

function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: PROJECT_DIR,
      stdio: options.stdio || "inherit",
      env: options.env || process.env,
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${command} exited with status ${code}.`));
    });
  });
}

function runCapture(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: PROJECT_DIR,
      stdio: ["ignore", "pipe", "pipe"],
      env: options.env || process.env,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("exit", (code) => resolvePromise({ code, stdout, stderr }));
  });
}

function requireAddress(value, label) {
  if (!isAddress(value || "")) throw new Error(`${label} must be a complete address.`);
  return getAddress(value);
}

function requireHash(value, label) {
  if (!/^0x[a-fA-F0-9]{64}$/.test(String(value || ""))) {
    throw new Error(`${label} must be a 32-byte hex value.`);
  }
  return String(value).toLowerCase();
}

function nullableAddress(value, label) {
  if (value === null) return null;
  return requireAddress(value, label);
}

function manifestIdentity(manifest) {
  return {
    schemaVersion: manifest.schemaVersion,
    manifestId: manifest.manifestId,
    chainId: manifest.chainId,
    protocolVersion: manifest.protocolVersion,
    transactionHash: manifest.transactionHash,
    registry: manifest.registry,
    projectAuthority: manifest.projectAuthority,
    launchOperator: manifest.launchOperator,
    guardian: manifest.guardian,
    gatewayImplementation: manifest.gatewayImplementation,
    gatewayImplementationRuntimeCodeHash: manifest.gatewayImplementationRuntimeCodeHash,
    eligibilityChecker: manifest.eligibilityChecker,
    stockAdapter: manifest.stockAdapter,
    ponsAdapterFactory: manifest.ponsAdapterFactory,
    currentOfficialToken: manifest.currentOfficialToken,
    currentMarket: manifest.currentMarket,
    currentActivatedBlock: manifest.currentActivatedBlock,
    tradingActive: manifest.tradingActive,
  };
}

export function validateDeploymentManifest(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Deployment manifest must be a JSON object.");
  }
  if (input.schemaVersion !== 1) throw new Error("Deployment manifest schemaVersion must be 1.");
  if (input.manifestId !== "robinhood-mainnet-production-v2") {
    throw new Error("Deployment manifestId is not the pinned production identifier.");
  }
  if (input.chainId !== 4663 || input.protocolVersion !== 2) {
    throw new Error("Deployment manifest chain or protocol version is invalid.");
  }
  if (input.network !== "Robinhood Chain") throw new Error("Deployment manifest network is invalid.");
  if (input.maxAmountInWei !== "10000000000000000000") {
    throw new Error("Deployment manifest maximum input is not the fixed 10 ETH limit.");
  }

  const manifest = {
    ...input,
    transactionHash: requireHash(input.transactionHash, "Deployment transaction hash"),
    registry: requireAddress(input.registry, "Registry"),
    deployer: requireAddress(input.deployer, "Deployer"),
    projectAuthority: requireAddress(input.projectAuthority, "Project authority"),
    launchOperator: requireAddress(input.launchOperator, "Launch operator"),
    guardian: requireAddress(input.guardian, "Guardian"),
    eligibilityAuthority: requireAddress(input.eligibilityAuthority, "Eligibility authority"),
    gatewayImplementation: requireAddress(input.gatewayImplementation, "Gateway implementation"),
    gatewayImplementationRuntimeCodeHash: requireHash(
      input.gatewayImplementationRuntimeCodeHash,
      "Gateway implementation runtime code hash",
    ),
    eligibilityChecker: requireAddress(input.eligibilityChecker, "Eligibility checker"),
    stockAdapter: requireAddress(input.stockAdapter, "Stock adapter"),
    ponsAdapterFactory: requireAddress(input.ponsAdapterFactory, "Pons adapter factory"),
    eligibilityPolicyHash: requireHash(input.eligibilityPolicyHash, "Eligibility policy hash"),
    currentOfficialToken: nullableAddress(input.currentOfficialToken, "Current official token"),
    currentMarket: nullableAddress(input.currentMarket, "Current market"),
  };

  if (manifest.projectAuthority !== getAddress(CONTROL_WALLET)) {
    throw new Error("Deployment manifest project authority does not match the immutable foundation authority.");
  }
  if (manifest.eligibilityAuthority !== getAddress(ELIGIBILITY_AUTHORITY)) {
    throw new Error("Deployment manifest eligibility authority does not match production.");
  }
  if (manifest.eligibilityPolicyHash !== ELIGIBILITY_POLICY_HASH) {
    throw new Error("Deployment manifest eligibility policy hash does not match production.");
  }
  if (manifest.operatorAuthorized !== true) {
    throw new Error("Deployment manifest does not record the one-way operator authorization.");
  }
  if (manifest.gatewayImplementationLocked !== true) {
    throw new Error("Deployment manifest does not attest the locked Gateway implementation.");
  }
  if (!Number.isSafeInteger(manifest.currentActivatedBlock) || manifest.currentActivatedBlock < 0) {
    throw new Error("Deployment manifest currentActivatedBlock is invalid.");
  }
  if (manifest.tradingActive === true) {
    if (!manifest.currentOfficialToken || !manifest.currentMarket || manifest.currentActivatedBlock <= 0) {
      throw new Error("Active deployment manifest is missing its CA, Gateway or activation block.");
    }
  } else if (
    manifest.tradingActive !== false
    || manifest.currentOfficialToken !== null
    || manifest.currentMarket !== null
    || manifest.currentActivatedBlock !== 0
  ) {
    throw new Error("Inactive deployment manifest must not contain an active market binding.");
  }
  return Object.freeze(manifest);
}

export async function loadDeploymentManifest() {
  return validateDeploymentManifest(JSON.parse(await readFile(DEPLOYMENT_MANIFEST_FILE, "utf8")));
}

export function deploymentManifestDigest(manifest) {
  return createHash("sha256").update(JSON.stringify(manifestIdentity(manifest))).digest("hex");
}

function requireCommit(value, label = "Release code commit") {
  if (!/^[a-fA-F0-9]{40}$/.test(String(value || ""))) {
    throw new Error(`${label} must be a full 40-character Git commit.`);
  }
  return String(value).toLowerCase();
}

function normalizeOperatorEnvelope(manifest, proof, expectedCodeCommit = null) {
  if (!proof || typeof proof !== "object" || Array.isArray(proof)) {
    throw new Error("OPERATOR_PROOF_INVALID · proof envelope is missing.");
  }
  const issuedAt = Number(proof.issuedAt);
  const expiresAt = Number(proof.expiresAt);
  if (!Number.isSafeInteger(issuedAt) || !Number.isSafeInteger(expiresAt)) {
    throw new Error("OPERATOR_PROOF_INVALID · issuedAt and expiresAt must be Unix seconds.");
  }
  if (expiresAt <= issuedAt || expiresAt - issuedAt > OPERATOR_PROOF_TTL_SECONDS) {
    throw new Error("OPERATOR_PROOF_INVALID · proof lifetime exceeds the five-minute limit.");
  }
  const challenge = requireHash(proof.challenge, "Operator challenge");
  const codeCommit = requireCommit(proof.codeCommit);
  const manifestSha256 = deploymentManifestDigest(manifest);
  if (
    proof.schemaVersion !== 1
    || proof.chainId !== manifest.chainId
    || !same(proof.registryAddress, manifest.registry)
    || !same(proof.operatorAddress, manifest.launchOperator)
    || proof.manifestSha256 !== manifestSha256
    || (expectedCodeCommit && codeCommit !== requireCommit(expectedCodeCommit))
  ) {
    throw new Error("OPERATOR_PROOF_BINDING_MISMATCH · proof differs from manifest, chain, Registry, operator or code commit.");
  }
  return Object.freeze({
    schemaVersion: 1,
    issuedAt,
    expiresAt,
    challenge,
    chainId: manifest.chainId,
    registryAddress: manifest.registry,
    operatorAddress: manifest.launchOperator,
    manifestSha256,
    codeCommit,
  });
}

export function createOperatorControlChallenge(manifest, {
  codeCommit,
  nowSeconds = Math.floor(Date.now() / 1_000),
  ttlSeconds = OPERATOR_PROOF_TTL_SECONDS,
  randomBytesImpl = randomBytes,
} = {}) {
  if (!Number.isSafeInteger(nowSeconds) || nowSeconds <= 0) {
    throw new Error("Operator proof issue time is invalid.");
  }
  if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 30 || ttlSeconds > OPERATOR_PROOF_TTL_SECONDS) {
    throw new Error("Operator proof TTL must be between 30 and 300 seconds.");
  }
  const challenge = `0x${Buffer.from(randomBytesImpl(32)).toString("hex")}`;
  const proof = normalizeOperatorEnvelope(manifest, {
    schemaVersion: 1,
    issuedAt: nowSeconds,
    expiresAt: nowSeconds + ttlSeconds,
    challenge,
    chainId: manifest.chainId,
    registryAddress: manifest.registry,
    operatorAddress: manifest.launchOperator,
    manifestSha256: deploymentManifestDigest(manifest),
    codeCommit,
  }, codeCommit);
  issuedOperatorChallenges.set(proof.challenge, JSON.stringify(proof));
  return proof;
}

export function operatorControlMessage(manifest, proof) {
  const normalized = normalizeOperatorEnvelope(manifest, proof, proof?.codeCommit);
  return [
    "DEGEN PENSION LAUNCH OPERATOR CONTROL V2",
    `issuedAt:${normalized.issuedAt}`,
    `expiresAt:${normalized.expiresAt}`,
    `challenge:${normalized.challenge}`,
    `chainId:${normalized.chainId}`,
    `registry:${normalized.registryAddress}`,
    `operator:${normalized.operatorAddress}`,
    `manifestSha256:${normalized.manifestSha256}`,
    `codeCommit:${normalized.codeCommit}`,
  ].join("\n");
}

export async function auditOperatorControlProof(manifest, proof, {
  codeCommit = proof?.codeCommit,
} = {}) {
  const normalized = normalizeOperatorEnvelope(manifest, proof, codeCommit);
  if (!/^0x[a-fA-F0-9]{130}$/.test(String(proof.signature || ""))) {
    throw new Error("OPERATOR_PROOF_INVALID · signature must be 65 bytes.");
  }
  const verifiedAt = Number(proof.verifiedAt);
  if (
    !Number.isSafeInteger(verifiedAt)
    || verifiedAt < normalized.issuedAt - OPERATOR_PROOF_FUTURE_SKEW_SECONDS
    || verifiedAt > normalized.expiresAt
  ) {
    throw new Error("OPERATOR_PROOF_TIME_INVALID · artifact was not verified inside its signed time window.");
  }
  const recovered = await recoverMessageAddress({
    message: operatorControlMessage(manifest, normalized),
    signature: proof.signature,
  });
  if (!same(recovered, manifest.launchOperator)) {
    throw new Error(
      `OPERATOR_PROOF_MISMATCH · proof recovered ${recovered}; expected ${manifest.launchOperator}.`,
    );
  }
  return Object.freeze({
    ...normalized,
    signature: proof.signature,
    verifiedAt,
    recoveredOperator: getAddress(recovered),
  });
}

function operatorProofIdentifier(proof) {
  return createHash("sha256")
    .update(`${proof.challenge}:${String(proof.signature || "").toLowerCase()}`)
    .digest("hex");
}

export async function verifyOperatorControl(manifest, {
  proof,
  signature,
  codeCommit = proof?.codeCommit,
  nowSeconds = Math.floor(Date.now() / 1_000),
} = {}) {
  const normalized = normalizeOperatorEnvelope(manifest, proof, codeCommit);
  const proofId = operatorProofIdentifier({ ...normalized, signature });
  if (consumedOperatorProofs.has(proofId)) {
    throw new Error("OPERATOR_PROOF_REPLAYED · this proof was already consumed in the current process.");
  }
  const issued = issuedOperatorChallenges.get(normalized.challenge);
  if (!issued || issued !== JSON.stringify(normalized)) {
    throw new Error("OPERATOR_CHALLENGE_UNKNOWN · launch must sign the fresh challenge generated by this process.");
  }
  if (normalized.issuedAt > nowSeconds + OPERATOR_PROOF_FUTURE_SKEW_SECONDS) {
    throw new Error("OPERATOR_PROOF_FROM_FUTURE · proof issue time is ahead of the verifier clock.");
  }
  if (normalized.expiresAt <= nowSeconds) {
    throw new Error("OPERATOR_PROOF_EXPIRED · generate and sign a new launch challenge.");
  }
  const artifact = await auditOperatorControlProof(manifest, {
    ...normalized,
    signature,
    verifiedAt: nowSeconds,
  }, { codeCommit });
  issuedOperatorChallenges.delete(normalized.challenge);
  consumedOperatorProofs.add(proofId);
  return artifact;
}

export function __resetOperatorProofsForTests() {
  issuedOperatorChallenges.clear();
  consumedOperatorProofs.clear();
  usedOperatorProofsForGate.clear();
  completedOperatorProofsForGate.clear();
}

export async function readReleaseCodeCommit({ runCaptureImpl = runCapture } = {}) {
  const revisionBefore = await runCaptureImpl("git", ["rev-parse", "--verify", "HEAD"]);
  if (revisionBefore.code !== 0) throw new Error("RELEASE_COMMIT_UNAVAILABLE · cannot resolve Git HEAD.");
  const status = await runCaptureImpl("git", ["status", "--porcelain", "--untracked-files=normal"]);
  if (status.code !== 0) throw new Error("RELEASE_WORKTREE_UNKNOWN · cannot verify Git worktree state.");
  if (status.stdout.trim()) {
    throw new Error("RELEASE_WORKTREE_DIRTY · commit every production change before generating operator proof.");
  }
  const revisionAfter = await runCaptureImpl("git", ["rev-parse", "--verify", "HEAD"]);
  if (revisionAfter.code !== 0) throw new Error("RELEASE_COMMIT_UNAVAILABLE · cannot re-resolve Git HEAD.");
  const before = requireCommit(revisionBefore.stdout.trim());
  const after = requireCommit(revisionAfter.stdout.trim());
  if (after !== before) {
    throw new Error("RELEASE_COMMIT_CHANGED · Git HEAD changed during the clean-worktree check.");
  }
  return after;
}

export async function assertReleaseCommitUnchanged(expectedCodeCommit, {
  codeCommitLoader = readReleaseCodeCommit,
} = {}) {
  const expected = requireCommit(expectedCodeCommit);
  const current = requireCommit(await codeCommitLoader());
  if (current !== expected) {
    throw new Error(
      `RELEASE_COMMIT_CHANGED · current clean commit ${current} differs from signed commit ${expected}.`,
    );
  }
  return current;
}

async function collectFreshOperatorProof(manifest, {
  signatureProvider,
  codeCommitLoader = readReleaseCodeCommit,
} = {}) {
  if (typeof signatureProvider !== "function") {
    throw new Error("OPERATOR_CONTROL_UNPROVEN · no interactive signature provider is available.");
  }
  const codeCommit = await codeCommitLoader();
  const proof = createOperatorControlChallenge(manifest, { codeCommit });
  const message = operatorControlMessage(manifest, proof);
  console.log("\nFRESH OPERATOR CONTROL CHALLENGE · expires in five minutes");
  console.log(JSON.stringify(proof, null, 2));
  console.log("\nSign this exact personal_sign message with the manifest launch operator:\n");
  console.log(message);
  const signature = String(await signatureProvider({ proof, message })).trim();
  await assertReleaseCommitUnchanged(codeCommit, { codeCommitLoader });
  return verifyOperatorControl(manifest, { proof, signature, codeCommit });
}

export function assertRegistrySnapshotMatchesManifest(snapshot, manifest) {
  const comparisons = [
    ["launchOperator", snapshot.launchOperator, manifest.launchOperator],
    ["projectAuthority", snapshot.projectAuthority, manifest.projectAuthority],
    ["guardian", snapshot.guardian, manifest.guardian],
    ["implementation", snapshot.implementationAddress, manifest.gatewayImplementation],
    ["eligibilityChecker", snapshot.eligibilityCheckerAddress, manifest.eligibilityChecker],
    ["stockAdapter", snapshot.stockAdapterAddress, manifest.stockAdapter],
    ["ponsAdapterFactory", snapshot.ponsAdapterFactoryAddress, manifest.ponsAdapterFactory],
    ["eligibilityAuthority", snapshot.eligibilityAuthority, manifest.eligibilityAuthority],
    ["policyAdmin", snapshot.policyAdmin, manifest.projectAuthority],
  ];
  for (const [label, actual, expected] of comparisons) {
    if (!same(actual, expected)) {
      throw new Error(`DEPLOYMENT_MANIFEST_MISMATCH · ${label} is ${actual}; manifest requires ${expected}.`);
    }
  }
  if (snapshot.implementationCodeHash?.toLowerCase() !== manifest.gatewayImplementationRuntimeCodeHash) {
    throw new Error("DEPLOYMENT_MANIFEST_MISMATCH · Gateway implementation code hash changed.");
  }
  if (snapshot.eligibilityPolicyHash?.toLowerCase() !== manifest.eligibilityPolicyHash) {
    throw new Error("DEPLOYMENT_MANIFEST_MISMATCH · eligibility policy hash changed.");
  }
  if (snapshot.maxAmountIn !== BigInt(manifest.maxAmountInWei)) {
    throw new Error("DEPLOYMENT_MANIFEST_MISMATCH · maximum input changed.");
  }
  if (snapshot.operatorAuthorized !== manifest.operatorAuthorized) {
    throw new Error("DEPLOYMENT_MANIFEST_MISMATCH · operator authorization state changed.");
  }
  if (snapshot.implementationInitialized !== true || snapshot.implementationPaused !== true) {
    throw new Error("DEPLOYMENT_MANIFEST_MISMATCH · Gateway implementation is not initialized and paused.");
  }

  if (manifest.tradingActive) {
    if (
      !snapshot.marketReady
      || !same(snapshot.currentOfficialToken, manifest.currentOfficialToken)
      || !same(snapshot.currentMarket, manifest.currentMarket)
      || snapshot.activatedBlock !== manifest.currentActivatedBlock
    ) {
      throw new Error("DEPLOYMENT_MANIFEST_MISMATCH · active market binding differs from the manifest.");
    }
  } else if (
    snapshot.marketReady
    || snapshot.currentOfficialToken
    || snapshot.currentMarket
    || snapshot.activatedBlock !== 0
  ) {
    throw new Error(
      "DEPLOYMENT_MANIFEST_STALE · onchain market state changed; update and review the sole manifest before release.",
    );
  }
  return snapshot;
}

async function contractCode(publicClient, address, label) {
  const code = await publicClient.getBytecode({ address });
  if (!code || code === "0x") throw new Error(`${label} has no contract code.`);
  return code;
}

export async function readAndValidateRegistry(manifest, publicClient = client) {
  await contractCode(publicClient, manifest.registry, "Registry");
  const [
    operatorAuthorized,
    launchOperator,
    projectAuthority,
    guardian,
    implementationAddress,
    eligibilityCheckerAddress,
    stockAdapterAddress,
    ponsAdapterFactoryAddress,
    maxAmountIn,
    currentMarketRaw,
    currentOfficialTokenRaw,
    activatedBlockRaw,
    marketReady,
  ] = await Promise.all([
    publicClient.readContract({ address: manifest.registry, abi: registryAbi, functionName: "operatorAuthorized" }),
    publicClient.readContract({ address: manifest.registry, abi: registryAbi, functionName: "launchOperator" }),
    publicClient.readContract({ address: manifest.registry, abi: registryAbi, functionName: "projectAuthority" }),
    publicClient.readContract({ address: manifest.registry, abi: registryAbi, functionName: "guardian" }),
    publicClient.readContract({ address: manifest.registry, abi: registryAbi, functionName: "implementation" }),
    publicClient.readContract({ address: manifest.registry, abi: registryAbi, functionName: "eligibilityChecker" }),
    publicClient.readContract({ address: manifest.registry, abi: registryAbi, functionName: "stockAdapter" }),
    publicClient.readContract({ address: manifest.registry, abi: registryAbi, functionName: "ponsAdapterFactory" }),
    publicClient.readContract({ address: manifest.registry, abi: registryAbi, functionName: "maxAmountIn" }),
    publicClient.readContract({ address: manifest.registry, abi: registryAbi, functionName: "currentMarket" }),
    publicClient.readContract({ address: manifest.registry, abi: registryAbi, functionName: "currentOfficialToken" }),
    publicClient.readContract({ address: manifest.registry, abi: registryAbi, functionName: "currentActivatedBlock" }),
    publicClient.readContract({ address: manifest.registry, abi: registryAbi, functionName: "marketReady" }),
  ]);

  const implementationCode = await contractCode(publicClient, implementationAddress, "Gateway implementation");
  await Promise.all([
    contractCode(publicClient, eligibilityCheckerAddress, "Eligibility checker"),
    contractCode(publicClient, stockAdapterAddress, "QQQ adapter"),
    contractCode(publicClient, ponsAdapterFactoryAddress, "Pons adapter factory"),
  ]);
  const [
    implementationInitialized,
    implementationPaused,
    eligibilityAuthority,
    policyAdmin,
    eligibilityPolicyHash,
  ] = await Promise.all([
    publicClient.readContract({ address: implementationAddress, abi: implementationAbi, functionName: "initialized" }),
    publicClient.readContract({ address: implementationAddress, abi: implementationAbi, functionName: "paused" }),
    publicClient.readContract({ address: eligibilityCheckerAddress, abi: checkerAbi, functionName: "eligibilityAuthority" }),
    publicClient.readContract({ address: eligibilityCheckerAddress, abi: checkerAbi, functionName: "policyAdmin" }),
    publicClient.readContract({ address: eligibilityCheckerAddress, abi: checkerAbi, functionName: "policyHash" }),
  ]);

  const snapshot = {
    registryAddress: manifest.registry,
    launchOperator: getAddress(launchOperator),
    projectAuthority: getAddress(projectAuthority),
    guardian: getAddress(guardian),
    implementationAddress: getAddress(implementationAddress),
    implementationCodeHash: keccak256(implementationCode),
    implementationInitialized,
    implementationPaused,
    eligibilityCheckerAddress: getAddress(eligibilityCheckerAddress),
    eligibilityAuthority: getAddress(eligibilityAuthority),
    eligibilityPolicyHash: eligibilityPolicyHash.toLowerCase(),
    policyAdmin: getAddress(policyAdmin),
    stockAdapterAddress: getAddress(stockAdapterAddress),
    ponsAdapterFactoryAddress: getAddress(ponsAdapterFactoryAddress),
    maxAmountIn,
    operatorAuthorized,
    currentMarket: same(currentMarketRaw, zeroAddress) ? null : getAddress(currentMarketRaw),
    currentOfficialToken: same(currentOfficialTokenRaw, zeroAddress) ? null : getAddress(currentOfficialTokenRaw),
    activatedBlock: Number(activatedBlockRaw),
    marketReady,
  };
  return assertRegistrySnapshotMatchesManifest(snapshot, manifest);
}

export function vercelRuntimeValues(snapshot) {
  return Object.freeze({
    REGISTRY_ADDRESS: snapshot.registryAddress,
    PROJECT_AUTHORITY_ADDRESS: snapshot.projectAuthority,
    GATEWAY_IMPLEMENTATION_ADDRESS: snapshot.implementationAddress,
    GATEWAY_IMPLEMENTATION_CODE_HASH: snapshot.implementationCodeHash,
    ELIGIBILITY_CHECKER_ADDRESS: snapshot.eligibilityCheckerAddress,
    ELIGIBILITY_POLICY_HASH: snapshot.eligibilityPolicyHash,
    ELIGIBILITY_PROVIDER_MODE: "external",
    ALLOW_BOUNDED_STATS_FALLBACK: "false",
  });
}

export function vercelRuntimeSyncCommands(snapshot) {
  const remove = LEGACY_VERCEL_RUNTIME_KEYS.map((name) => Object.freeze({
    action: "remove",
    name,
    args: ["vercel", "env", "rm", name, "production", "--yes"],
  }));
  const add = Object.entries(vercelRuntimeValues(snapshot)).map(([name, value]) => Object.freeze({
    action: "add",
    name,
    value,
    args: [
      "vercel",
      "env",
      "add",
      name,
      "production",
      "--value",
      value,
      "--force",
      "--yes",
    ],
  }));
  return Object.freeze([...remove, ...add]);
}

async function removeLegacyVercelRuntime(command) {
  const result = await runCapture("npx", command.args);
  if (result.code === 0) return;
  const output = `${result.stdout}\n${result.stderr}`;
  if (/not found|does not exist|no environment variable|could not find/i.test(output)) return;
  throw new Error(`Failed to remove stale Vercel Production variable ${command.name}.`);
}

async function syncVercelRuntime(snapshot) {
  const commands = vercelRuntimeSyncCommands(snapshot);
  console.log("\nRemoving legacy direct-address Vercel Production bindings:");
  for (const command of commands.filter(({ action }) => action === "remove")) {
    console.log(`  REMOVE ${command.name}`);
    await removeLegacyVercelRuntime(command);
  }
  console.log("Synchronizing pinned V2 bindings and non-secret fail-closed policy:");
  for (const command of commands.filter(({ action }) => action === "add")) {
    console.log(`  ADD ${command.name}`);
    await run("npx", command.args);
  }
}

export function vercelCandidateDeployCommand() {
  return Object.freeze({
    command: "npx",
    args: Object.freeze(["vercel", "deploy", "--prod", "--skip-domain", "--yes"]),
  });
}

function requireCandidateDeploymentUrl(value) {
  const raw = String(value || "").replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, " ");
  const matches = raw.match(/https:\/\/[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?\.vercel\.app(?:\/[^\s]*)?/g) || [];
  const origins = new Set();
  for (const match of matches) {
    let candidate;
    try {
      candidate = new URL(match);
    } catch {
      continue;
    }
    if (
      candidate.protocol === "https:"
      && candidate.hostname.endsWith(".vercel.app")
      && !candidate.username
      && !candidate.password
      && !candidate.search
      && !candidate.hash
    ) {
      origins.add(candidate.origin);
    }
  }
  if (origins.size === 0) {
    throw new Error("CANDIDATE_DEPLOY_INVALID · Vercel did not return a deployment URL.");
  }
  if (origins.size !== 1) {
    throw new Error("CANDIDATE_DEPLOY_INVALID · Vercel returned multiple deployment URLs.");
  }
  return [...origins][0];
}

export function vercelPromoteCommand(candidateUrl) {
  const url = requireCandidateDeploymentUrl(candidateUrl);
  return Object.freeze({
    command: "npx",
    args: Object.freeze(["vercel", "promote", url, "--yes"]),
  });
}

export async function deployProductionCandidateAtCommit(expectedCodeCommit, {
  codeCommitLoader = readReleaseCodeCommit,
  runCaptureImpl = runCapture,
} = {}) {
  const codeCommit = await assertReleaseCommitUnchanged(expectedCodeCommit, { codeCommitLoader });
  const command = vercelCandidateDeployCommand();
  const result = await runCaptureImpl(command.command, [...command.args]);
  if (result.code !== 0) {
    throw new Error("CANDIDATE_DEPLOY_FAILED · staged Production deployment failed without changing aliases.");
  }
  return Object.freeze({
    codeCommit,
    candidateUrl: requireCandidateDeploymentUrl(`${result.stdout}\n${result.stderr}`),
  });
}

export async function promoteProductionCandidateAtCommit(candidateUrl, expectedCodeCommit, {
  codeCommitLoader = readReleaseCodeCommit,
  runImpl = run,
} = {}) {
  const codeCommit = await assertReleaseCommitUnchanged(expectedCodeCommit, { codeCommitLoader });
  const command = vercelPromoteCommand(candidateUrl);
  await runImpl(command.command, [...command.args]);
  return Object.freeze({ codeCommit, candidateUrl: requireCandidateDeploymentUrl(candidateUrl) });
}

export function assertInactivePrepareState(manifest, snapshot) {
  if (
    manifest?.tradingActive !== false
    || manifest?.currentOfficialToken !== null
    || manifest?.currentMarket !== null
    || manifest?.currentActivatedBlock !== 0
    || snapshot?.marketReady !== false
    || snapshot?.currentOfficialToken !== null
    || snapshot?.currentMarket !== null
    || snapshot?.activatedBlock !== 0
  ) {
    throw new Error(
      "PREPARE_ACTIVE_MARKET_FORBIDDEN · --prepare may deploy only an explicitly inactive manifest and Registry snapshot.",
    );
  }
  return true;
}

export async function prepareInactiveProductionSite({
  manifest,
  snapshot,
  codeCommit,
  codeCommitLoader = readReleaseCodeCommit,
  syncImpl = syncVercelRuntime,
  candidateDeployImpl = deployProductionCandidateAtCommit,
  promoteImpl = promoteProductionCandidateAtCommit,
}) {
  assertInactivePrepareState(manifest, snapshot);
  await syncImpl(snapshot);
  const candidate = await candidateDeployImpl(codeCommit, { codeCommitLoader });
  await promoteImpl(candidate.candidateUrl, codeCommit, { codeCommitLoader });
  return Object.freeze({
    status: "PREPARED",
    codeCommit: requireCommit(codeCommit),
    candidateUrl: candidate.candidateUrl,
  });
}

async function preflight(ca, snapshot, manifest, publicClient = client) {
  const chainId = await publicClient.getChainId();
  if (chainId !== manifest.chainId) throw new Error(`RPC returned unexpected chain ${chainId}.`);
  await contractCode(publicClient, ca, "Official CA");
  if (!snapshot.operatorAuthorized) throw new Error("Launch operator is not authorized.");
  if (snapshot.currentMarket) {
    if (same(snapshot.currentOfficialToken, ca) && snapshot.marketReady) {
      return { alreadyLive: true };
    }
    throw new Error(`Registry already has another active CA: ${snapshot.currentOfficialToken}`);
  }

  const launched = await publicClient.readContract({
    address: PONS_FACTORY,
    abi: ponsFactoryAbi,
    functionName: "getLaunchedToken",
    args: [ca],
  });
  if (!launched.exists || !same(launched.token, ca)) {
    throw new Error("Pons Factory does not recognize this CA as an official launched token.");
  }
  if (!same(launched.pairedToken, WETH)) {
    throw new Error(`Pons paired token is not canonical WETH: ${launched.pairedToken}`);
  }
  if (Number(launched.poolFee) !== PONS_POOL_FEE) {
    throw new Error(`Pons pool fee is ${launched.poolFee}, expected ${PONS_POOL_FEE}.`);
  }

  const [canonicalPool, tokenPool] = await Promise.all([
    publicClient.readContract({
      address: V3_FACTORY,
      abi: v3FactoryAbi,
      functionName: "getPool",
      args: [WETH, ca, PONS_POOL_FEE],
    }),
    publicClient.readContract({ address: ca, abi: tokenAbi, functionName: "liquidityPool" }),
  ]);
  if (same(canonicalPool, zeroAddress)) throw new Error("Canonical Pons liquidity pool has not been created yet.");
  if (!same(canonicalPool, tokenPool)) {
    throw new Error(`Token pool ${tokenPool} does not match canonical pool ${canonicalPool}.`);
  }
  await contractCode(publicClient, canonicalPool, "Canonical Pons pool");
  await publicClient.simulateContract({
    address: snapshot.registryAddress,
    abi: registryAbi,
    functionName: "activatePonsMarket",
    args: [ca],
    account: manifest.launchOperator,
  });
  return { alreadyLive: false, canonicalPool };
}

async function requestJson(url, options = {}, fetchImpl = fetch) {
  let response;
  try {
    response = await fetchImpl(url, {
      ...options,
      headers: {
        accept: "application/json",
        ...(options.body ? { "content-type": "application/json" } : {}),
        ...(options.headers || {}),
      },
      signal: options.signal || AbortSignal.timeout(20_000),
    });
  } catch (error) {
    throw new Error(`Production API request failed: ${error.message}`);
  }
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`Production API returned invalid JSON (HTTP ${response.status}).`);
  }
  if (!response.ok) {
    const code = payload?.error?.code || payload?.reason || "HTTP_ERROR";
    throw new Error(`Production API rejected the gate (${response.status} ${code}).`);
  }
  return payload;
}

export function assertRuntimeReady(runtime, { ca, snapshot, manifest }) {
  if (runtime?.schemaVersion !== 1) {
    throw new Error("RUNTIME_SCHEMA_MISMATCH · schemaVersion must be 1.");
  }
  const checkEntries = Object.entries(runtime?.checks || {});
  const missingChecks = REQUIRED_RUNTIME_CHECKS.filter((name) => !(name in (runtime?.checks || {})));
  const failedChecks = checkEntries
    .filter(([, passed]) => passed !== true)
    .map(([name]) => name);
  for (const name of missingChecks) if (!failedChecks.includes(name)) failedChecks.push(name);
  const stockRegistry = runtime?.operations?.stockAssetRegistry;
  const releaseManifest = runtime?.releaseManifest;
  const operationsReady = runtime?.operations?.environment === "production"
    && runtime.operations.eligibilityProviderMode === "external"
    && runtime.operations.eligibilityExternalRequired === true
    && runtime.operations.statsIndexer?.configured === true
    && runtime.operations.statsIndexer?.healthy === true
    && runtime.operations.statsIndexer?.boundedFallbackEnabled === false
    && runtime.operations.distributedRateLimitHealthy === true
    && runtime.operations.monitoringHealthy === true
    && runtime.operations.independentAuditVerified === true
    && stockRegistry?.verified === true
    && stockRegistry.tokenSymbol === "QQQ"
    && stockRegistry.status === "ASSET_STATUS_ACTIVE"
    && stockRegistry.marketWhole === "TRADING_STATUS_TRADABLE"
    && stockRegistry.marketFractional === "TRADING_STATUS_TRADABLE";
  const releaseManifestReady = releaseManifest?.required === true
    && releaseManifest.manifestId === manifest.manifestId
    && releaseManifest.tradingActive === true
    && releaseManifest.bound === true;
  if (
    runtime?.ready !== true
    || runtime?.status !== "READY"
    || missingChecks.length > 0
    || failedChecks.length > 0
    || !operationsReady
    || !releaseManifestReady
  ) {
    throw new Error(
      `RUNTIME_NOT_READY · status ${runtime?.status || "UNKNOWN"}; failed checks: ${failedChecks.join(", ") || (!releaseManifestReady ? "releaseManifest" : !operationsReady ? "productionOperations" : "unknown")}.`,
    );
  }
  const confirmations = runtime?.limits?.confirmations;
  if (!Number.isSafeInteger(confirmations) || confirmations < 1 || confirmations > 100) {
    throw new Error("RUNTIME_LIMITS_INVALID · confirmations must be an integer from 1 to 100.");
  }
  const now = Date.now();
  const checkedAt = Date.parse(runtime.checkedAt || "");
  const expiresAt = Date.parse(runtime.expiresAt || "");
  const stockCheckedAt = Date.parse(stockRegistry.checkedAt || "");
  if (
    !Number.isFinite(checkedAt)
    || !Number.isFinite(expiresAt)
    || checkedAt > now + OPERATOR_PROOF_FUTURE_SKEW_SECONDS * 1_000
    || now - checkedAt > MAX_RUNTIME_AGE_MS
    || expiresAt <= now
    || expiresAt <= checkedAt
    || expiresAt - checkedAt > MAX_RUNTIME_VALIDITY_MS
    || !Number.isFinite(stockCheckedAt)
    || stockCheckedAt > now + OPERATOR_PROOF_FUTURE_SKEW_SECONDS * 1_000
    || now - stockCheckedAt > MAX_RUNTIME_AGE_MS
  ) {
    throw new Error("RUNTIME_STALE · runtime or Stock Asset Registry proof is outside the freshness window.");
  }
  const bindings = [
    ["chain", runtime.chainId, manifest.chainId, (a, b) => a === b],
    ["protocol version", runtime.protocolVersion, manifest.protocolVersion, (a, b) => a === b],
    ["Registry", runtime.registryAddress, snapshot.registryAddress, same],
    ["factory alias", runtime.factoryAddress, snapshot.registryAddress, same],
    ["project authority", runtime.projectAuthorityAddress, snapshot.projectAuthority, same],
    ["official CA", runtime.officialTokenAddress, ca, same],
    ["Gateway", runtime.gatewayAddress, snapshot.currentMarket, same],
    ["implementation", runtime.implementationAddress, snapshot.implementationAddress, same],
    ["implementation code hash", runtime.implementationCodeHash, snapshot.implementationCodeHash,
      (a, b) => String(a || "").toLowerCase() === String(b || "").toLowerCase()],
    ["eligibility checker", runtime.eligibilityCheckerAddress, snapshot.eligibilityCheckerAddress, same],
    ["eligibility signer", runtime.eligibilitySignerAddress, snapshot.eligibilityAuthority, same],
    ["eligibility policy", runtime.policyHash, snapshot.eligibilityPolicyHash,
      (a, b) => String(a || "").toLowerCase() === String(b || "").toLowerCase()],
    ["stock adapter", runtime.stockAdapterAddress, snapshot.stockAdapterAddress, same],
    ["canonical Stock Token", runtime.stockTokenAddress, CANONICAL_QQQ, same],
    ["canonical input token", runtime.inputTokenAddress, WETH, same],
    ["activation block", runtime.activatedBlock, snapshot.activatedBlock, (a, b) => a === b],
  ];
  for (const [label, actual, expected, compare] of bindings) {
    if (!compare(actual, expected)) {
      throw new Error(`RUNTIME_BINDING_MISMATCH · ${label} is ${actual}; expected ${expected}.`);
    }
  }
  if (
    !/^0x[a-fA-F0-9]{64}$/.test(runtime.gatewayCodeHash || "")
    || /^0x0{64}$/i.test(runtime.gatewayCodeHash)
    || runtime.marketRegistered !== true
    || runtime.gatewayInitializedOnchain !== true
    || runtime.gatewayPaused !== false
    || runtime.explicitFeeBps !== 0
  ) {
    throw new Error("RUNTIME_BINDING_MISMATCH · Gateway state or code proof is invalid.");
  }
  return runtime;
}

function assertEligibilityReady(eligibility, probeWallet) {
  if (eligibility?.eligible !== true || !eligibility.proof?.token) {
    throw new Error(`ELIGIBILITY_NOT_READY · ${eligibility?.reason || "no signed provider proof"}.`);
  }
  if (!same(eligibility.proof.wallet, probeWallet)) {
    throw new Error("ELIGIBILITY_BINDING_MISMATCH · proof wallet differs from the probe wallet.");
  }
  const expiry = Date.parse(eligibility.expiresAt || "");
  if (!Number.isFinite(expiry) || expiry <= Date.now()) {
    throw new Error("ELIGIBILITY_STALE · eligibility proof is expired.");
  }
  return eligibility;
}

function assertQuoteReady(quote, {
  ca,
  snapshot,
  manifest,
  runtime,
  probeWallet,
  amountInWei,
}) {
  if (quote?.schemaVersion !== 1) throw new Error("QUOTE_INVALID · schemaVersion is not 1.");
  if (!same(quote.transaction?.to, snapshot.currentMarket)) {
    throw new Error("QUOTE_BINDING_MISMATCH · transaction target is not the canonical Gateway.");
  }
  if (quote.transaction?.chainId !== manifest.chainId) {
    throw new Error("QUOTE_BINDING_MISMATCH · transaction chain is not Robinhood Chain.");
  }
  if (BigInt(quote.amountInWei || 0) !== amountInWei || BigInt(quote.transaction?.value || 0) !== amountInWei) {
    throw new Error("QUOTE_BINDING_MISMATCH · quote value differs from the requested probe amount.");
  }
  if (
    BigInt(quote.minProjectOut || 0) <= 0n
    || BigInt(quote.minStockOut || 0) <= 0n
    || BigInt(quote.projectAmountOut || 0) < BigInt(quote.minProjectOut || 0)
    || BigInt(quote.stockAmountOut || 0) < BigInt(quote.minStockOut || 0)
  ) {
    throw new Error("QUOTE_INVALID · both settlement legs must have positive, simulated output.");
  }
  if (quote.quoteSource?.type !== "ONCHAIN_QUOTER_V2_AND_GATEWAY_ETH_CALL") {
    throw new Error("QUOTE_INVALID · quote does not attest onchain pricing plus Gateway eth_call.");
  }
  if (!quote.transaction?.data || !/^0x[a-fA-F0-9]+$/.test(quote.transaction.data)) {
    throw new Error("QUOTE_INVALID · transaction calldata is missing.");
  }
  if (!quote.eligibilityProof?.signature || !quote.eligibilityProof?.providerDecision) {
    throw new Error("QUOTE_INVALID · signed eligibility proof is missing.");
  }
  let decoded;
  try {
    decoded = decodeFunctionData({ abi: gatewayAbi, data: quote.transaction.data });
  } catch {
    throw new Error("QUOTE_INVALID · transaction calldata is not buyNative.");
  }
  if (decoded.functionName !== "buyNative") {
    throw new Error("QUOTE_INVALID · transaction calldata is not buyNative.");
  }
  const [minProjectOut, minStockOut, recipient, deadline, eligibilityDeadline, signature] = decoded.args;
  if (
    minProjectOut !== BigInt(quote.minProjectOut)
    || minStockOut !== BigInt(quote.minStockOut)
    || !same(recipient, probeWallet)
    || signature.toLowerCase() !== String(quote.eligibilityProof.signature).toLowerCase()
  ) {
    throw new Error("QUOTE_CALLDATA_MISMATCH · recipient, minimum outputs or eligibility signature changed.");
  }
  const quoteDeadline = BigInt(Math.floor(Date.parse(quote.expiresAt || "") / 1_000));
  if (
    deadline !== quoteDeadline
    || eligibilityDeadline !== BigInt(quote.eligibilityProof.validUntil || 0)
    || eligibilityDeadline > deadline
  ) {
    throw new Error("QUOTE_CALLDATA_MISMATCH · quote or eligibility deadline changed.");
  }
  const typed = quote.typedPayload;
  if (
    typed?.primaryType !== "Eligibility"
    || typed.domain?.chainId !== manifest.chainId
    || !same(typed.domain?.verifyingContract, runtime.eligibilityCheckerAddress)
    || !same(typed.message?.market, snapshot.currentMarket)
    || !same(typed.message?.payer, probeWallet)
    || !same(typed.message?.recipient, probeWallet)
    || BigInt(typed.message?.validUntil || 0) !== eligibilityDeadline
    || String(typed.message?.policyHash || "").toLowerCase()
      !== String(runtime.policyHash || "").toLowerCase()
  ) {
    throw new Error("QUOTE_ELIGIBILITY_MISMATCH · typed proof is not bound to the runtime and probe wallet.");
  }
  if (
    !same(quote.eligibilityProof.checker, runtime.eligibilityCheckerAddress)
    || !same(quote.eligibilityProof.signer, runtime.eligibilitySignerAddress)
    || String(quote.eligibilityProof.policyHash || "").toLowerCase()
      !== String(runtime.policyHash || "").toLowerCase()
    || (quote.eligibilityProof.providerDecision.wallet
      && !same(quote.eligibilityProof.providerDecision.wallet, probeWallet))
  ) {
    throw new Error("QUOTE_ELIGIBILITY_MISMATCH · public proof fields differ from the verified runtime.");
  }
  if (
    quote.quoteSource.projectPath !== runtime.routes?.projectPath
    || quote.quoteSource.stockPath !== runtime.routes?.stockPath
    || BigInt(quote.quoteSource.simulatedAtBlock || 0) < BigInt(snapshot.activatedBlock)
  ) {
    throw new Error("QUOTE_ROUTE_MISMATCH · quote routes or simulation block differ from the verified runtime.");
  }
  const expiry = Date.parse(quote.expiresAt || "");
  if (!Number.isFinite(expiry) || expiry <= Date.now() + 5_000) {
    throw new Error("QUOTE_STALE · quote expires too soon for an independent simulation.");
  }
  return { ...quote, ca, probeWallet };
}

export async function verifyIndependentEthCall(quote, probeWallet, publicClient = client) {
  let result;
  try {
    result = await publicClient.call({
      account: probeWallet,
      to: quote.transaction.to,
      data: quote.transaction.data,
      value: BigInt(quote.transaction.value),
    });
  } catch {
    throw new Error("ETH_CALL_FAILED · the exact quoted 99/1 transaction reverted independently.");
  }
  if (!result?.data) throw new Error("ETH_CALL_FAILED · Gateway returned no result data.");
  let projectAmountOut;
  let stockAmountOut;
  try {
    [projectAmountOut, stockAmountOut] = decodeFunctionResult({
      abi: gatewayAbi,
      functionName: "buyNative",
      data: result.data,
    });
  } catch {
    throw new Error("ETH_CALL_FAILED · Gateway returned undecodable result data.");
  }
  if (
    projectAmountOut < BigInt(quote.minProjectOut)
    || stockAmountOut < BigInt(quote.minStockOut)
  ) {
    throw new Error("ETH_CALL_OUTPUT_MISMATCH · independent outputs are below signed minimums.");
  }
  return { projectAmountOut, stockAmountOut };
}

export function assertCanaryEvidence({
  transaction,
  receipt,
  event,
  callRecipient,
  latestBlock,
  gateway,
  probeWallet,
  activatedBlock,
  minimumConfirmations = DEFAULT_CANARY_CONFIRMATIONS,
  maximumConfirmations = DEFAULT_CANARY_MAX_CONFIRMATIONS,
  minimumAmountWei = DEFAULT_PROBE_AMOUNT_WEI,
  maximumAmountWei = DEFAULT_CANARY_MAX_AMOUNT_WEI,
}) {
  if (receipt?.status !== "success") throw new Error("CANARY_FAILED · transaction receipt is not successful.");
  if (!same(transaction?.to, gateway)) throw new Error("CANARY_BINDING_MISMATCH · transaction did not target the Gateway.");
  if (!same(transaction?.from, probeWallet)) throw new Error("CANARY_BINDING_MISMATCH · payer differs from the probe wallet.");
  if (
    !same(callRecipient, probeWallet)
    || !same(event?.payer, probeWallet)
    || !same(event?.recipient, probeWallet)
  ) {
    throw new Error("CANARY_BINDING_MISMATCH · SplitBuy payer/recipient differs from the probe wallet.");
  }
  if (
    BigInt(receipt.blockNumber) < BigInt(activatedBlock)
    || (transaction.blockNumber !== null
      && transaction.blockNumber !== undefined
      && BigInt(transaction.blockNumber) !== BigInt(receipt.blockNumber))
  ) {
    throw new Error("CANARY_BLOCK_MISMATCH · canary predates activation or has inconsistent inclusion data.");
  }
  const amountInWei = BigInt(transaction?.value || 0);
  if (
    amountInWei < BigInt(minimumAmountWei)
    || amountInWei > BigInt(maximumAmountWei)
    || BigInt(event?.grossAmountIn || 0) !== amountInWei
    || BigInt(event?.projectAmountIn || 0) <= 0n
    || BigInt(event?.stockAmountIn || 0) <= 0n
    || BigInt(event?.projectAmountOut || 0) <= 0n
    || BigInt(event?.stockAmountOut || 0) <= 0n
  ) {
    throw new Error("CANARY_OUTPUT_MISMATCH · canary amount or two-leg settlement is outside the release bounds.");
  }
  const confirmations = BigInt(latestBlock) - BigInt(receipt.blockNumber) + 1n;
  if (confirmations < BigInt(minimumConfirmations)) {
    throw new Error(`CANARY_UNCONFIRMED · ${confirmations} confirmations; require ${minimumConfirmations}.`);
  }
  if (confirmations > BigInt(maximumConfirmations)) {
    throw new Error(
      `CANARY_STALE · ${confirmations} confirmations; maximum age is ${maximumConfirmations} blocks.`,
    );
  }
  return {
    amountInWei: amountInWei.toString(),
    blockNumber: Number(receipt.blockNumber),
    confirmations: Number(confirmations),
  };
}

export async function verifyCanaryTransaction({
  transactionHash,
  gateway,
  probeWallet,
  activatedBlock,
  minimumConfirmations = DEFAULT_CANARY_CONFIRMATIONS,
  maximumConfirmations = DEFAULT_CANARY_MAX_CONFIRMATIONS,
  minimumAmountWei = DEFAULT_PROBE_AMOUNT_WEI,
  maximumAmountWei = DEFAULT_CANARY_MAX_AMOUNT_WEI,
  publicClient = client,
}) {
  const normalizedHash = requireHash(transactionHash, "Canary transaction hash");
  const [transaction, receipt, latestBlock] = await Promise.all([
    publicClient.getTransaction({ hash: normalizedHash }),
    publicClient.getTransactionReceipt({ hash: normalizedHash }),
    publicClient.getBlockNumber(),
  ]);
  const events = [];
  for (const log of receipt.logs || []) {
    if (!same(log.address, gateway)) continue;
    try {
      const decoded = decodeEventLog({
        abi: splitBuyEventAbi,
        data: log.data,
        topics: log.topics,
      });
      if (decoded.eventName === "SplitBuy") events.push(decoded.args);
    } catch {
      // Ignore unrelated Gateway logs.
    }
  }
  if (events.length !== 1) {
    throw new Error(`CANARY_EVENT_MISMATCH · expected one SplitBuy event, found ${events.length}.`);
  }
  let decodedCall;
  try {
    decodedCall = decodeFunctionData({ abi: gatewayAbi, data: transaction.input });
  } catch {
    throw new Error("CANARY_CALLDATA_MISMATCH · transaction input is not buyNative.");
  }
  if (decodedCall.functionName !== "buyNative") {
    throw new Error("CANARY_CALLDATA_MISMATCH · transaction input is not buyNative.");
  }
  return assertCanaryEvidence({
    transaction,
    receipt,
    event: events[0],
    callRecipient: decodedCall.args[2],
    latestBlock,
    gateway,
    probeWallet,
    activatedBlock,
    minimumConfirmations,
    maximumConfirmations,
    minimumAmountWei,
    maximumAmountWei,
  });
}

export async function runProductionGate({
  ca,
  snapshot,
  manifest,
  operatorControlProof,
  probeWallet,
  canaryTransactionHash,
  amountInWei = DEFAULT_PROBE_AMOUNT_WEI,
  minimumConfirmations = DEFAULT_CANARY_CONFIRMATIONS,
  maximumCanaryConfirmations = DEFAULT_CANARY_MAX_CONFIRMATIONS,
  maximumCanaryAmountWei = DEFAULT_CANARY_MAX_AMOUNT_WEI,
  siteUrl = SITE_URL,
  fetchImpl = fetch,
  publicClient = client,
  canaryVerifier = verifyCanaryTransaction,
  codeCommitLoader = readReleaseCodeCommit,
}) {
  const wallet = requireAddress(probeWallet, "Probe wallet");
  const canaryHash = requireHash(canaryTransactionHash, "Canary transaction hash");
  if (amountInWei <= 0n) throw new Error("Probe amount must be positive.");
  const auditedOperatorProof = await auditOperatorControlProof(manifest, operatorControlProof, {
    codeCommit: operatorControlProof?.codeCommit,
  });
  const operatorProofId = operatorProofIdentifier(auditedOperatorProof);
  if (!consumedOperatorProofs.has(operatorProofId)) {
    throw new Error(
      "OPERATOR_PROOF_NOT_CONSUMED · this launch process did not verify the fresh operator challenge.",
    );
  }
  if (usedOperatorProofsForGate.has(operatorProofId)) {
    throw new Error("OPERATOR_PROOF_REPLAYED · this proof already started a production gate in this process.");
  }
  const gateNowSeconds = Math.floor(Date.now() / 1_000);
  if (
    auditedOperatorProof.issuedAt > gateNowSeconds + OPERATOR_PROOF_FUTURE_SKEW_SECONDS
    || auditedOperatorProof.expiresAt <= gateNowSeconds
  ) {
    throw new Error("OPERATOR_PROOF_EXPIRED · operator control expired before the production gate started.");
  }
  await assertReleaseCommitUnchanged(auditedOperatorProof.codeCommit, { codeCommitLoader });
  usedOperatorProofsForGate.add(operatorProofId);

  const runtime = assertRuntimeReady(
    await requestJson(`${siteUrl}/api/runtime?gate=${Date.now()}`, {}, fetchImpl),
    { ca, snapshot, manifest },
  );
  console.log("PASS · [1/5] Production runtime is READY with exact manifest bindings.");

  const commonBody = {
    wallet,
    termsAccepted: true,
    notUSPerson: true,
  };
  const eligibility = assertEligibilityReady(
    await requestJson(`${siteUrl}/api/eligibility`, {
      method: "POST",
      body: JSON.stringify(commonBody),
    }, fetchImpl),
    wallet,
  );
  console.log("PASS · [2/5] Eligibility provider returned a live signed decision.");

  const quote = assertQuoteReady(
    await requestJson(`${siteUrl}/api/quote`, {
      method: "POST",
      body: JSON.stringify({
        ...commonBody,
        recipient: wallet,
        amountInWei: amountInWei.toString(),
        slippageBps: runtime.limits?.defaultSlippageBps,
      }),
    }, fetchImpl),
    { ca, snapshot, manifest, runtime, probeWallet: wallet, amountInWei },
  );
  console.log("PASS · [3/5] Quote has two positive legs and a signed transaction payload.");

  await verifyIndependentEthCall(quote, wallet, publicClient);
  console.log("PASS · [4/5] Independent eth_call succeeded for the exact quoted transaction.");

  const canary = await canaryVerifier({
    transactionHash: canaryHash,
    gateway: snapshot.currentMarket,
    probeWallet: wallet,
    activatedBlock: snapshot.activatedBlock,
    minimumConfirmations,
    maximumConfirmations: maximumCanaryConfirmations,
    minimumAmountWei: amountInWei,
    maximumAmountWei: maximumCanaryAmountWei,
    publicClient,
  });
  console.log(`PASS · [5/5] Mainnet canary settled both legs (${canary.confirmations} confirmations).`);
  completedOperatorProofsForGate.add(operatorProofId);

  return Object.freeze({
    status: "GO",
    checkedAt: new Date().toISOString(),
    chainId: manifest.chainId,
    manifestId: manifest.manifestId,
    protocolVersion: manifest.protocolVersion,
    manifestSha256: deploymentManifestDigest(manifest),
    registryAddress: snapshot.registryAddress,
    launchOperator: manifest.launchOperator,
    codeCommit: auditedOperatorProof.codeCommit,
    operatorControlProof: auditedOperatorProof,
    officialTokenAddress: ca,
    gatewayAddress: snapshot.currentMarket,
    gatewayCodeHash: runtime.gatewayCodeHash,
    implementationAddress: runtime.implementationAddress,
    implementationCodeHash: runtime.implementationCodeHash,
    projectAdapterAddress: runtime.projectAdapterAddress,
    stockAdapterAddress: runtime.stockAdapterAddress,
    stockTokenAddress: runtime.stockTokenAddress,
    explicitFeeBps: runtime.explicitFeeBps,
    activatedBlock: runtime.activatedBlock,
    runtimeCheckedAt: runtime.checkedAt,
    runtimeExpiresAt: runtime.expiresAt,
    runtimeChecks: runtime.checks,
    operations: runtime.operations,
    eligibilityExpiresAt: eligibility.expiresAt,
    quoteExpiresAt: quote.expiresAt,
    quoteSimulatedAtBlock: quote.quoteSource.simulatedAtBlock,
    canaryTransactionHash: canaryHash,
    canaryAmountInWei: canary.amountInWei,
    canaryBlockNumber: canary.blockNumber,
    canaryConfirmations: canary.confirmations,
  });
}

export async function assertOperatorProofCurrentForPromotion(manifest, operatorControlProof, {
  codeCommitLoader = readReleaseCodeCommit,
  nowSeconds = Math.floor(Date.now() / 1_000),
} = {}) {
  const audited = await auditOperatorControlProof(manifest, operatorControlProof, {
    codeCommit: operatorControlProof?.codeCommit,
  });
  const proofId = operatorProofIdentifier(audited);
  if (!completedOperatorProofsForGate.has(proofId)) {
    throw new Error("OPERATOR_PROOF_GATE_MISMATCH · proof did not complete this process's Production gate.");
  }
  if (
    audited.issuedAt > nowSeconds + OPERATOR_PROOF_FUTURE_SKEW_SECONDS
    || audited.expiresAt <= nowSeconds
  ) {
    throw new Error("OPERATOR_PROOF_EXPIRED · operator control expired before candidate promotion.");
  }
  await assertReleaseCommitUnchanged(audited.codeCommit, { codeCommitLoader });
  return audited;
}

export async function releaseProductionCandidate({
  manifest,
  operatorControlProof,
  gateArguments,
  codeCommitLoader = readReleaseCodeCommit,
  candidateDeployImpl = deployProductionCandidateAtCommit,
  gateImpl = runProductionGate,
  finalProofGuardImpl = assertOperatorProofCurrentForPromotion,
  promoteImpl = promoteProductionCandidateAtCommit,
}) {
  const candidate = await candidateDeployImpl(operatorControlProof?.codeCommit, { codeCommitLoader });
  console.log(`PASS · Production candidate staged without alias promotion: ${candidate.candidateUrl}`);
  const artifact = await gateImpl({
    ...(gateArguments || {}),
    manifest,
    operatorControlProof,
    siteUrl: candidate.candidateUrl,
    codeCommitLoader,
  });
  if (artifact?.status !== "GO") {
    throw new Error("RELEASE_GATE_NOT_GO · candidate gate did not return an explicit GO artifact.");
  }
  await finalProofGuardImpl(manifest, operatorControlProof, { codeCommitLoader });
  await promoteImpl(candidate.candidateUrl, operatorControlProof.codeCommit, { codeCommitLoader });
  return Object.freeze({
    ...artifact,
    candidateDeploymentUrl: candidate.candidateUrl,
    promotedAt: new Date().toISOString(),
  });
}

async function prepareProduction() {
  console.log("\nPREPARE MODE · PINNED DEPLOYMENT ONLY · NO CHAIN TRANSACTION\n");
  const codeCommit = await readReleaseCodeCommit();
  const manifest = await loadDeploymentManifest();
  const snapshot = await readAndValidateRegistry(manifest);
  console.log(`PASS · Sole deployment manifest: ${manifest.manifestId}`);
  console.log(`PASS · Registry: ${snapshot.registryAddress}`);
  console.log(`PASS · Launch operator: ${snapshot.launchOperator}`);
  console.log(`PASS · Clean release commit: ${codeCommit}`);
  const prepared = await prepareInactiveProductionSite({ manifest, snapshot, codeCommit });
  console.log(`PASS · Inactive candidate promoted from unchanged commit: ${prepared.candidateUrl}`);
  console.log("PREPARED · Public pre-launch deployment updated; market readiness was not asserted.");
}

async function launchOfficialCa(ca, {
  preflightOnly = false,
  probeWallet,
  canaryTransactionHash,
  signatureProvider,
  codeCommitLoader = readReleaseCodeCommit,
} = {}) {
  const manifest = await loadDeploymentManifest();
  const snapshot = await readAndValidateRegistry(manifest);
  const checked = await preflight(ca, snapshot, manifest);
  console.log(checked.alreadyLive
    ? "PASS · Active CA and Gateway match the reviewed deployment manifest."
    : "PASS · Official Pons token, canonical pool and activation eth_call verified.");
  if (preflightOnly) {
    console.log("PREFLIGHT PASS · NO TRANSACTION SENT · RELEASE REMAINS NO-GO.");
    return;
  }

  const operatorControlProof = await collectFreshOperatorProof(manifest, {
    signatureProvider,
    codeCommitLoader,
  });
  console.log("PASS · Launch operator control proof matches the pinned manifest.");
  if (!checked.alreadyLive || !manifest.tradingActive) {
    throw new Error(
      "MARKET_NOT_ACTIVATED · activate through the controlled signer, then update and review the sole deployment manifest from the confirmed receipt.",
    );
  }

  console.log("\nSynchronizing and staging the manifest-bound Production candidate.");
  await syncVercelRuntime(snapshot);
  const artifact = await releaseProductionCandidate({
    manifest,
    operatorControlProof,
    codeCommitLoader,
    gateArguments: {
      ca,
      snapshot,
      probeWallet,
      canaryTransactionHash,
    },
  });
  console.log("PASS · Candidate passed every gate and was promoted to the public Production alias.");
  console.log(`\nGO · ${JSON.stringify(artifact)}\n`);
  await run("/usr/bin/open", [`${SITE_URL}/?launch=${Date.now()}`]);
}

async function checkOnly({ signatureProvider, codeCommitLoader = readReleaseCodeCommit } = {}) {
  console.log("\nCHECK MODE · READ ONLY · PERSONAL_SIGN ONLY · NO TRANSACTION\n");
  const manifest = await loadDeploymentManifest();
  const chainId = await client.getChainId();
  if (chainId !== manifest.chainId) throw new Error(`RPC returned unexpected chain ${chainId}.`);
  const snapshot = await readAndValidateRegistry(manifest);
  const balance = await client.getBalance({ address: manifest.launchOperator });
  console.log(`PASS · Sole deployment manifest: ${manifest.manifestId}`);
  console.log(`PASS · Robinhood Chain RPC: ${chainId}`);
  console.log(`PASS · Registry: ${snapshot.registryAddress}`);
  console.log(`PASS · Manifest/onchain project authority: ${snapshot.projectAuthority}`);
  console.log(`PASS · Manifest/onchain launch operator: ${snapshot.launchOperator}`);
  console.log(`LAUNCH OPERATOR GAS: ${formatEther(balance)} ETH`);
  console.log(`MARKET: ${snapshot.marketReady ? snapshot.currentOfficialToken : "WAITING FOR OFFICIAL CA"}`);
  await collectFreshOperatorProof(manifest, {
    signatureProvider,
    codeCommitLoader,
  });
  console.log("GO FOR CONTROL · launch operator proof is valid; market release gates still run separately.");
}

function optionValue(arguments_, name, fallback = "") {
  const inline = arguments_.find((value) => value.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = arguments_.indexOf(name);
  return index >= 0 ? arguments_[index + 1] || "" : fallback;
}

function printHelp() {
  console.log(`
401KEK PRODUCTION RELEASE GATE

The sole deployment source is contracts/deployments/robinhood-mainnet.json.
This script never deploys a replacement Registry and never sends an activation or canary transaction.

Options:
  --prepare                    Stage/promote only an explicitly inactive pinned pre-launch site
  --check                      Read-only manifest/RPC/operator-control diagnostics
  --preflight-only CA          Validate a CA and activation eth_call without a wallet transaction
  --probe-wallet ADDRESS       Wallet used for eligibility, quote, eth_call and canary binding
  --canary-tx HASH             Confirmed small mainnet SplitBuy transaction to verify
  --help                       Show this help

For --check and full release, this process creates a random five-minute challenge
bound to the manifest, chain, Registry, operator and clean Git commit. Sign the
exact displayed personal_sign message and paste the signature when prompted.
`);
}

async function main() {
  console.log("\n401KEK · ROBINHOOD CHAIN PRODUCTION RELEASE GATE\n");
  const arguments_ = process.argv.slice(2);
  if (arguments_.includes("--help")) {
    printHelp();
    return;
  }
  if (arguments_.includes("--prepare")) {
    await prepareProduction();
    return;
  }

  const preflightOnly = arguments_.includes("--preflight-only");
  const valueOptions = new Set(["--probe-wallet", "--canary-tx"]);
  const consumedValues = new Set();
  for (let index = 0; index < arguments_.length; index += 1) {
    if (valueOptions.has(arguments_[index])) consumedValues.add(index + 1);
  }
  const unknownFlags = arguments_.filter((value) => value.startsWith("--")
    && value !== "--preflight-only"
    && value !== "--check"
    && !valueOptions.has(value)
    && ![...valueOptions].some((name) => value.startsWith(`${name}=`)));
  if (unknownFlags.length) throw new Error(`Unknown option: ${unknownFlags.join(", ")}`);

  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const signatureProvider = async () => terminal.question("Paste the fresh operator signature: ");
    if (arguments_.includes("--check")) {
      await checkOnly({ signatureProvider });
      return;
    }
    const caArgument = arguments_.find((value, index) => !value.startsWith("--") && !consumedValues.has(index));
    const raw = caArgument || await terminal.question("Paste the official Pons CA: ");
    const candidate = raw.trim().replace(/^['"]|['"]$/g, "");
    if (!isAddress(candidate)) throw new Error("CA must be a complete 0x address with 40 hex characters.");
    await launchOfficialCa(getAddress(candidate), {
      preflightOnly,
      probeWallet: optionValue(arguments_, "--probe-wallet", process.env.LAUNCH_PROBE_WALLET),
      canaryTransactionHash: optionValue(
        arguments_,
        "--canary-tx",
        process.env.CANARY_TRANSACTION_HASH,
      ),
      signatureProvider,
    });
  } finally {
    terminal.close();
  }
}

const isDirectRun = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch((error) => {
    console.error(`\nSTOPPED · ${error.message}\n`);
    process.exitCode = 1;
  });
}
