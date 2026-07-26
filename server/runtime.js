import {
  createPublicClient,
  getAddress,
  http,
  isAddressEqual,
  keccak256,
  zeroAddress,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  ADAPTER_ABI,
  CANONICAL_QQQ,
  CANONICAL_QUOTER,
  CANONICAL_SWAP_ROUTER,
  CANONICAL_USDG,
  CANONICAL_WETH,
  ELIGIBILITY_CHECKER_ABI,
  GATEWAY_ABI,
  REGISTRY_ABI,
  ROBINHOOD_CHAIN_ID,
} from "./constants.js";
import { hasStrongSecret } from "./config.js";

const runtimeCache = new Map();
const clientCache = new Map();

// These names are part of the public fail-closed contract with the browser.
const CHECK_NAMES = [
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
];

function baseChecks() {
  return Object.fromEntries(CHECK_NAMES.map((name) => [name, false]));
}

function same(left, right) {
  return Boolean(left && right && isAddressEqual(left, right));
}

function nonZero(address) {
  return Boolean(address && !same(address, zeroAddress));
}

export function analyzeV3Path(path) {
  if (!/^0x(?:[a-fA-F0-9]{2})+$/.test(path || "")) return null;
  const raw = path.slice(2);
  if (raw.length < 86 || (raw.length - 40) % 46 !== 0) return null;

  const tokens = [getAddress(`0x${raw.slice(0, 40)}`)];
  const fees = [];
  let offset = 40;
  while (offset < raw.length) {
    fees.push(Number.parseInt(raw.slice(offset, offset + 6), 16));
    tokens.push(getAddress(`0x${raw.slice(offset + 6, offset + 46)}`));
    offset += 46;
  }
  if (fees.some((fee) => !Number.isSafeInteger(fee) || fee <= 0 || fee > 1_000_000)) return null;
  return { tokens, fees, hash: keccak256(path) };
}

export function getPublicClient(config) {
  const key = `${config.rpcUrl}:${config.rpcTimeoutMs}`;
  if (!clientCache.has(key)) {
    clientCache.set(
      key,
      createPublicClient({
        chain: {
          id: ROBINHOOD_CHAIN_ID,
          name: "Robinhood Chain",
          nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
          rpcUrls: { default: { http: [config.rpcUrl] } },
        },
        transport: http(config.rpcUrl, {
          timeout: config.rpcTimeoutMs,
          retryCount: 1,
          retryDelay: 150,
        }),
      }),
    );
  }
  return clientCache.get(key);
}

function cacheKey(config) {
  return [
    config.rpcUrl,
    config.registryAddress,
    config.expectedAuthority,
    config.expectedImplementation,
    config.expectedImplementationCodeHash,
    config.stockTokenAddress,
    config.quoterAddress,
    config.expectedEligibilityChecker,
    config.expectedEligibilityPolicyHash,
  ].join(":");
}

async function safeRead(client, parameters) {
  if (!parameters.address) return null;
  try {
    return await client.readContract(parameters);
  } catch {
    return null;
  }
}

async function bytecode(client, address) {
  if (!address || same(address, zeroAddress)) return null;
  try {
    const code = await client.getBytecode({ address });
    return code && code !== "0x" ? code : null;
  } catch {
    return null;
  }
}

function publicLimits(config, onchainMaximum = null) {
  const maximum = onchainMaximum && onchainMaximum > 0n
    ? (config.maximumBuyWei < onchainMaximum ? config.maximumBuyWei : onchainMaximum)
    : config.maximumBuyWei;
  return {
    minimumBuyWei: config.minimumBuyWei.toString(),
    maximumBuyWei: maximum.toString(),
    defaultSlippageBps: config.defaultSlippageBps,
    maximumSlippageBps: config.maximumSlippageBps,
    quoteTtlSeconds: config.quoteTtlSeconds,
    confirmations: config.confirmations,
  };
}

function publicBase(config, checkedAt, expiresAt, checks) {
  return {
    schemaVersion: 1,
    ready: false,
    status: "NOT_CONFIGURED",
    chainId: config.chainId,
    registryAddress: config.registryAddress,
    factoryAddress: config.registryAddress,
    gatewayAddress: null,
    officialTokenAddress: null,
    stockTokenAddress: config.stockTokenAddress,
    inputTokenAddress: null,
    projectAdapterAddress: null,
    stockAdapterAddress: null,
    eligibilityCheckerAddress: null,
    eligibilitySignerAddress: null,
    policyHash: null,
    activatedBlock: 0,
    explicitFeeBps: null,
    limits: publicLimits(config),
    checks,
    checkedAt,
    expiresAt,
  };
}

function exactRoute(route, expectedTokens, expectedFees) {
  return Boolean(route)
    && route.tokens.length === expectedTokens.length
    && route.fees.length === expectedFees.length
    && route.tokens.every((token, index) => same(token, expectedTokens[index]))
    && route.fees.every((fee, index) => fee === expectedFees[index]);
}

function providerConfigured(config) {
  const decisionProvider = config.eligibilityProviderMode === "geo_attestation"
    || (config.eligibilityProviderMode === "external" && Boolean(config.eligibilityProviderUrl));
  return decisionProvider && hasStrongSecret(config.eligibilitySigningSecret);
}

export async function loadRuntime(config, { fresh = false } = {}) {
  const key = cacheKey(config);
  const cached = runtimeCache.get(key);
  if (!fresh && cached && cached.expiresAtMs > Date.now()) return cached.value;

  const now = Date.now();
  const checkedAt = new Date(now).toISOString();
  const expiresAtMs = now + config.runtimeCacheSeconds * 1_000;
  const expiresAt = new Date(expiresAtMs).toISOString();
  const checks = baseChecks();
  const base = publicBase(config, checkedAt, expiresAt, checks);

  if (
    !config.registryAddress
    || !config.expectedAuthority
    || !config.expectedImplementation
    || !/^0x[a-fA-F0-9]{64}$/.test(config.expectedImplementationCodeHash || "")
    || !config.stockTokenAddress
    || !config.quoterAddress
  ) {
    const value = { ...base, status: "NOT_CONFIGURED" };
    runtimeCache.set(key, { expiresAtMs, value });
    return value;
  }

  const client = getPublicClient(config);
  try {
    const [chainId, latestBlock, registryCode] = await Promise.all([
      client.getChainId(),
      client.getBlockNumber(),
      bytecode(client, config.registryAddress),
    ]);
    checks.rpcChain = chainId === config.chainId;

    const [
      protocolVersion,
      registrySelf,
      projectAuthority,
      implementation,
      gatewayAddress,
      officialTokenAddress,
      projectAdapterAddress,
      stockAdapterAddress,
      eligibilityCheckerAddress,
      activatedBlockRaw,
      registryMaximum,
      registryReady,
    ] = await Promise.all([
      safeRead(client, { address: config.registryAddress, abi: REGISTRY_ABI, functionName: "protocolVersion" }),
      safeRead(client, { address: config.registryAddress, abi: REGISTRY_ABI, functionName: "registry" }),
      safeRead(client, { address: config.registryAddress, abi: REGISTRY_ABI, functionName: "projectAuthority" }),
      safeRead(client, { address: config.registryAddress, abi: REGISTRY_ABI, functionName: "implementation" }),
      safeRead(client, { address: config.registryAddress, abi: REGISTRY_ABI, functionName: "currentMarket" }),
      safeRead(client, { address: config.registryAddress, abi: REGISTRY_ABI, functionName: "currentOfficialToken" }),
      safeRead(client, { address: config.registryAddress, abi: REGISTRY_ABI, functionName: "currentProjectAdapter" }),
      safeRead(client, { address: config.registryAddress, abi: REGISTRY_ABI, functionName: "currentStockAdapter" }),
      safeRead(client, { address: config.registryAddress, abi: REGISTRY_ABI, functionName: "eligibilityChecker" }),
      safeRead(client, { address: config.registryAddress, abi: REGISTRY_ABI, functionName: "currentActivatedBlock" }),
      safeRead(client, { address: config.registryAddress, abi: REGISTRY_ABI, functionName: "maxAmountIn" }),
      safeRead(client, { address: config.registryAddress, abi: REGISTRY_ABI, functionName: "marketReady" }),
    ]);

    checks.foundationCode = Boolean(registryCode)
      && Number(protocolVersion) === 2
      && same(registrySelf, config.registryAddress);
    checks.factoryAuthority = same(projectAuthority, config.expectedAuthority);

    const [implementationCode, implementationInitialized, implementationPaused] = await Promise.all([
      bytecode(client, implementation),
      safeRead(client, { address: implementation, abi: GATEWAY_ABI, functionName: "initialized" }),
      safeRead(client, { address: implementation, abi: GATEWAY_ABI, functionName: "paused" }),
    ]);
    checks.factoryImplementation = Boolean(implementationCode)
      && implementationInitialized === true
      && implementationPaused === true
      && (!config.expectedImplementation || same(implementation, config.expectedImplementation))
      && (!config.expectedImplementationCodeHash
        || keccak256(implementationCode) === config.expectedImplementationCodeHash);

    const activatedBlock = Number(activatedBlockRaw || 0n);
    const marketConfigured = nonZero(gatewayAddress)
      && nonZero(officialTokenAddress)
      && nonZero(projectAdapterAddress)
      && nonZero(stockAdapterAddress)
      && activatedBlock > 0;
    if (!marketConfigured) {
      const value = {
        ...base,
        status: "NOT_CONFIGURED",
        implementationAddress: implementation || null,
        implementationCodeHash: implementationCode ? keccak256(implementationCode) : null,
        checks,
      };
      runtimeCache.set(key, { expiresAtMs, value });
      return value;
    }

    const [registryMarket, gatewayCode, quoterCode] = await Promise.all([
      safeRead(client, {
        address: config.registryAddress,
        abi: REGISTRY_ABI,
        functionName: "isMarket",
        args: [gatewayAddress],
      }),
      bytecode(client, gatewayAddress),
      bytecode(client, config.quoterAddress),
    ]);
    checks.factoryMarket = registryMarket === true && registryReady === true;
    checks.gatewayCode = Boolean(gatewayCode);
    checks.quoterCode = Boolean(quoterCode) && same(config.quoterAddress, CANONICAL_QUOTER);
    checks.activatedBlock = Number.isSafeInteger(activatedBlock)
      && activatedBlock > 0
      && BigInt(activatedBlock) <= latestBlock;

    const [
      initialized,
      paused,
      inputToken,
      officialToken,
      stockToken,
      projectAdapter,
      stockAdapter,
      feeRecipient,
      explicitFeeBps,
      eligibilityChecker,
      guardian,
      gatewayMaximum,
    ] = await Promise.all([
      safeRead(client, { address: gatewayAddress, abi: GATEWAY_ABI, functionName: "initialized" }),
      safeRead(client, { address: gatewayAddress, abi: GATEWAY_ABI, functionName: "paused" }),
      safeRead(client, { address: gatewayAddress, abi: GATEWAY_ABI, functionName: "inputToken" }),
      safeRead(client, { address: gatewayAddress, abi: GATEWAY_ABI, functionName: "officialToken" }),
      safeRead(client, { address: gatewayAddress, abi: GATEWAY_ABI, functionName: "stockToken" }),
      safeRead(client, { address: gatewayAddress, abi: GATEWAY_ABI, functionName: "projectAdapter" }),
      safeRead(client, { address: gatewayAddress, abi: GATEWAY_ABI, functionName: "stockAdapter" }),
      safeRead(client, { address: gatewayAddress, abi: GATEWAY_ABI, functionName: "feeRecipient" }),
      safeRead(client, { address: gatewayAddress, abi: GATEWAY_ABI, functionName: "explicitFeeBps" }),
      safeRead(client, { address: gatewayAddress, abi: GATEWAY_ABI, functionName: "eligibilityChecker" }),
      safeRead(client, { address: gatewayAddress, abi: GATEWAY_ABI, functionName: "guardian" }),
      safeRead(client, { address: gatewayAddress, abi: GATEWAY_ABI, functionName: "maxAmountIn" }),
    ]);

    checks.gatewayInitialized = initialized === true && paused === false;
    checks.gatewayBindings = same(officialToken, officialTokenAddress)
      && same(stockToken, CANONICAL_QQQ)
      && same(stockToken, config.stockTokenAddress)
      && same(projectAdapter, projectAdapterAddress)
      && same(stockAdapter, stockAdapterAddress)
      && same(eligibilityChecker, eligibilityCheckerAddress)
      && same(guardian, config.registryAddress)
      && same(inputToken, CANONICAL_WETH)
      && Number(explicitFeeBps) === 0
      && same(feeRecipient, zeroAddress)
      && BigInt(gatewayMaximum || 0n) === BigInt(registryMaximum || 0n)
      && BigInt(gatewayMaximum || 0n) > 0n;

    const [projectCode, stockCode] = await Promise.all([
      bytecode(client, projectAdapter),
      bytecode(client, stockAdapter),
    ]);
    checks.adapterCode = Boolean(projectCode && stockCode);

    const [
      projectInput,
      projectOutput,
      projectQuoter,
      projectRouter,
      projectRegistry,
      projectPathRaw,
      stockInput,
      stockOutput,
      stockQuoter,
      stockRouter,
      stockRegistry,
      stockPathRaw,
    ] = await Promise.all([
      safeRead(client, { address: projectAdapter, abi: ADAPTER_ABI, functionName: "inputToken" }),
      safeRead(client, { address: projectAdapter, abi: ADAPTER_ABI, functionName: "outputToken" }),
      safeRead(client, { address: projectAdapter, abi: ADAPTER_ABI, functionName: "quoter" }),
      safeRead(client, { address: projectAdapter, abi: ADAPTER_ABI, functionName: "router" }),
      safeRead(client, { address: projectAdapter, abi: ADAPTER_ABI, functionName: "marketRegistry" }),
      safeRead(client, { address: projectAdapter, abi: ADAPTER_ABI, functionName: "path" }),
      safeRead(client, { address: stockAdapter, abi: ADAPTER_ABI, functionName: "inputToken" }),
      safeRead(client, { address: stockAdapter, abi: ADAPTER_ABI, functionName: "outputToken" }),
      safeRead(client, { address: stockAdapter, abi: ADAPTER_ABI, functionName: "quoter" }),
      safeRead(client, { address: stockAdapter, abi: ADAPTER_ABI, functionName: "router" }),
      safeRead(client, { address: stockAdapter, abi: ADAPTER_ABI, functionName: "marketRegistry" }),
      safeRead(client, { address: stockAdapter, abi: ADAPTER_ABI, functionName: "path" }),
    ]);
    checks.adapterBindings = same(projectInput, inputToken)
      && same(stockInput, inputToken)
      && same(projectOutput, officialToken)
      && same(stockOutput, stockToken)
      && same(projectRegistry, config.registryAddress)
      && same(stockRegistry, config.registryAddress)
      && same(projectRouter, CANONICAL_SWAP_ROUTER)
      && same(stockRouter, CANONICAL_SWAP_ROUTER)
      && same(projectQuoter, CANONICAL_QUOTER)
      && same(stockQuoter, CANONICAL_QUOTER);

    const projectPath = analyzeV3Path(projectPathRaw);
    const stockPath = analyzeV3Path(stockPathRaw);
    checks.quoteRoutes = exactRoute(projectPath, [CANONICAL_WETH, officialToken], [10_000])
      && exactRoute(stockPath, [CANONICAL_WETH, CANONICAL_USDG, CANONICAL_QQQ], [100, 3_000]);

    checks.eligibilityProvider = providerConfigured(config);
    const [checkerCode, checkerSigner, checkerPolicyHash, checkerAdmin] = await Promise.all([
      bytecode(client, eligibilityChecker),
      safeRead(client, {
        address: eligibilityChecker,
        abi: ELIGIBILITY_CHECKER_ABI,
        functionName: "eligibilityAuthority",
      }),
      safeRead(client, {
        address: eligibilityChecker,
        abi: ELIGIBILITY_CHECKER_ABI,
        functionName: "policyHash",
      }),
      safeRead(client, {
        address: eligibilityChecker,
        abi: ELIGIBILITY_CHECKER_ABI,
        functionName: "policyAdmin",
      }),
    ]);
    const configuredSignerAddress = config.eligibilitySignerPrivateKey
      ? privateKeyToAccount(config.eligibilitySignerPrivateKey).address
      : null;
    checks.eligibilityChecker = Boolean(checkerCode)
      && same(checkerAdmin, projectAuthority)
      && (!config.expectedEligibilityChecker || same(eligibilityChecker, config.expectedEligibilityChecker));
    checks.eligibilitySigner = Boolean(configuredSignerAddress) && same(checkerSigner, configuredSignerAddress);
    checks.policyHash = /^0x[a-fA-F0-9]{64}$/.test(checkerPolicyHash || "")
      && !/^0x0{64}$/i.test(checkerPolicyHash)
      && (!config.expectedEligibilityPolicyHash
        || checkerPolicyHash.toLowerCase() === config.expectedEligibilityPolicyHash);

    const ready = Object.values(checks).every(Boolean);
    const value = {
      ...base,
      ready,
      status: ready ? "READY" : "NOT_READY",
      registryAddress: config.registryAddress,
      factoryAddress: config.registryAddress,
      gatewayAddress,
      officialTokenAddress,
      stockTokenAddress: stockToken || config.stockTokenAddress,
      inputTokenAddress: inputToken || null,
      projectAdapterAddress: projectAdapter || null,
      stockAdapterAddress: stockAdapter || null,
      explicitFeeBps: explicitFeeBps === null ? null : Number(explicitFeeBps),
      activatedBlock,
      limits: publicLimits(config, BigInt(gatewayMaximum || 0n)),
      eligibilityCheckerAddress: eligibilityChecker || null,
      eligibilitySignerAddress: checkerSigner || null,
      policyHash: checkerPolicyHash || null,
      gatewayCodeHash: gatewayCode ? keccak256(gatewayCode) : null,
      implementationAddress: implementation || null,
      implementationCodeHash: implementationCode ? keccak256(implementationCode) : null,
      routes: {
        projectPath: projectPathRaw || null,
        stockPath: stockPathRaw || null,
      },
      checks,
    };
    runtimeCache.set(key, { expiresAtMs, value });
    return value;
  } catch {
    const value = { ...base, status: "RPC_UNAVAILABLE" };
    runtimeCache.set(key, { expiresAtMs, value });
    return value;
  }
}

export function __resetRuntimeCacheForTests() {
  runtimeCache.clear();
  clientCache.clear();
}
