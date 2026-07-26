import assert from "node:assert/strict";
import { createHmac, createHash } from "node:crypto";
import test from "node:test";
import {
  decodeFunctionData,
  encodeFunctionResult,
  keccak256,
  recoverTypedDataAddress,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import eligibilityHandler from "../api/eligibility.js";
import holderStockHandler from "../api/holder-stock.js";
import membersHandler from "../api/members.js";
import runtimeHandler from "../api/runtime.js";
import { checkStockAssetRegistry } from "../server/asset-registry.js";
import {
  CANONICAL_QQQ,
  CANONICAL_QUOTER,
  CANONICAL_SWAP_ROUTER,
  CANONICAL_USDG,
  CANONICAL_USDG_QQQ_POOL,
  CANONICAL_WETH,
  GATEWAY_ABI,
  QUOTER_V2_ABI,
} from "../server/constants.js";
import { getServerConfig } from "../server/config.js";
import {
  __resetEligibilityCacheForTests,
  decideEligibility,
  verifyProviderProof,
} from "../server/eligibility.js";
import {
  __resetRateLimitsForTests,
  ApiError,
  createApiHandler,
} from "../server/http.js";
import {
  __resetOperationalCachesForTests,
  checkOperationalReadiness,
  consumeDistributedRateLimit,
} from "../server/operations.js";
import {
  applySlippage,
  calculateSplit,
  createQuote,
} from "../server/quote.js";
import {
  PRODUCTION_RELEASE_MANIFEST,
  isValidProductionReleaseManifest,
  releaseManifestSnapshotMatches,
} from "../server/release-manifest.js";
import { analyzeV3Path, loadRuntime } from "../server/runtime.js";
import {
  __resetStatsCacheForTests,
  loadHolderCount,
  loadHolderStockProof,
  loadMemberCount,
} from "../server/stats.js";

const ADDRESSES = {
  wallet: "0x1111111111111111111111111111111111111111",
  quoter: "0x2222222222222222222222222222222222222222",
  official: "0x3333333333333333333333333333333333333333",
  stock: "0x4444444444444444444444444444444444444444",
  checker: "0x5555555555555555555555555555555555555555",
  gateway: "0x6666666666666666666666666666666666666666",
  input: "0x7777777777777777777777777777777777777777",
  registry: "0x9999999999999999999999999999999999999999",
  implementation: "0x8888888888888888888888888888888888888888",
  authority: "0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa",
  stockAdapter: "0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB",
  projectAdapter: "0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC",
};
const TEST_PRIVATE_KEY =
  "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const POLICY_HASH = `0x${"ab".repeat(32)}`;
const IMPLEMENTATION_CODE_HASH = `0x${"12".repeat(32)}`;

function activeReleaseManifest(overrides = {}) {
  return {
    ...PRODUCTION_RELEASE_MANIFEST,
    tradingActive: true,
    currentOfficialToken: ADDRESSES.official,
    currentMarket: ADDRESSES.gateway,
    currentActivatedBlock: 100,
    registry: ADDRESSES.registry,
    projectAuthority: ADDRESSES.authority,
    gatewayImplementation: ADDRESSES.implementation,
    gatewayImplementationRuntimeCodeHash: IMPLEMENTATION_CODE_HASH,
    eligibilityChecker: ADDRESSES.checker,
    eligibilityAuthority: privateKeyToAccount(TEST_PRIVATE_KEY).address,
    eligibilityPolicyHash: POLICY_HASH,
    stockAdapter: ADDRESSES.stockAdapter,
    ...overrides,
  };
}

function productionReleaseConfig(manifest, overrides = {}) {
  return {
    ...getServerConfig({
      VERCEL_ENV: "production",
      REGISTRY_ADDRESS: manifest.registry,
      PROJECT_AUTHORITY_ADDRESS: manifest.projectAuthority,
      GATEWAY_IMPLEMENTATION_ADDRESS: manifest.gatewayImplementation,
      GATEWAY_IMPLEMENTATION_CODE_HASH: manifest.gatewayImplementationRuntimeCodeHash,
      ELIGIBILITY_CHECKER_ADDRESS: manifest.eligibilityChecker,
      ELIGIBILITY_POLICY_HASH: manifest.eligibilityPolicyHash,
      OFFICIAL_TOKEN_ADDRESS: manifest.currentOfficialToken,
      GATEWAY_ADDRESS: manifest.currentMarket,
      GATEWAY_ACTIVATED_BLOCK: String(manifest.currentActivatedBlock),
      STOCK_TOKEN_ADDRESS: ADDRESSES.stock,
      CHAIN_QUOTER_ADDRESS: ADDRESSES.quoter,
      ELIGIBILITY_SIGNER_PRIVATE_KEY: TEST_PRIVATE_KEY,
      LOG_CONFIRMATIONS: "12",
    }),
    ...overrides,
  };
}

function signedJsonResponse(payload, secret, {
  timestampHeader,
  signatureHeader,
  status = 200,
} = {}) {
  const raw = JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1_000));
  const signature = createHmac("sha256", secret).update(`${timestamp}.${raw}`).digest("hex");
  return new Response(raw, {
    status,
    headers: {
      "content-type": "application/json",
      [timestampHeader]: timestamp,
      [signatureHeader]: `sha256=${signature}`,
    },
  });
}

function v3Path(tokenIn, fee, tokenOut) {
  return `${tokenIn.toLowerCase()}${fee.toString(16).padStart(6, "0")}${tokenOut.slice(2).toLowerCase()}`;
}

function releaseRuntimeClient(manifest, overrides = {}) {
  const implementationBytecode = "0x6001600055";
  const signer = privateKeyToAccount(TEST_PRIVATE_KEY);
  const state = {
    chainId: manifest.chainId,
    protocolVersion: manifest.protocolVersion,
    registryAddress: manifest.registry,
    registrySelf: manifest.registry,
    projectAuthority: manifest.projectAuthority,
    implementation: manifest.gatewayImplementation,
    implementationBytecode,
    gateway: ADDRESSES.gateway,
    officialToken: ADDRESSES.official,
    projectAdapter: ADDRESSES.projectAdapter,
    stockAdapter: manifest.stockAdapter,
    checker: manifest.eligibilityChecker,
    eligibilityAuthority: manifest.eligibilityAuthority,
    activatedBlock: 100,
    marketReady: true,
    latestBlock: 1_000n,
    policyHash: manifest.eligibilityPolicyHash,
    maxAmountInWei: manifest.maxAmountInWei,
    ...overrides,
  };
  const projectPath = v3Path(CANONICAL_WETH, 10_000, state.officialToken);
  const stockPath = `${v3Path(CANONICAL_WETH, 100, CANONICAL_USDG)}${(3_000)
    .toString(16)
    .padStart(6, "0")}${CANONICAL_QQQ.slice(2).toLowerCase()}`;
  const same = (left, right) => String(left).toLowerCase() === String(right).toLowerCase();

  return {
    implementationBytecode,
    client: {
      getChainId: async () => state.chainId,
      getBlockNumber: async () => state.latestBlock,
      getBytecode: async ({ address }) => (
        same(address, state.implementation) ? state.implementationBytecode : "0x6000"
      ),
      readContract: async ({ address, functionName }) => {
        if (same(address, state.registryAddress)) {
          const registryValues = {
            protocolVersion: state.protocolVersion,
            registry: state.registrySelf,
            projectAuthority: state.projectAuthority,
            implementation: state.implementation,
            currentMarket: state.gateway,
            currentOfficialToken: state.officialToken,
            currentProjectAdapter: state.projectAdapter,
            currentStockAdapter: state.stockAdapter,
            eligibilityChecker: state.checker,
            currentActivatedBlock: BigInt(state.activatedBlock),
            maxAmountIn: BigInt(state.maxAmountInWei),
            marketReady: state.marketReady,
            isMarket: true,
          };
          if (functionName in registryValues) return registryValues[functionName];
        }
        if (same(address, state.implementation)) {
          if (functionName === "initialized") return true;
          if (functionName === "paused") return true;
        }
        if (same(address, state.gateway)) {
          const gatewayValues = {
            initialized: true,
            paused: false,
            inputToken: CANONICAL_WETH,
            officialToken: state.officialToken,
            stockToken: CANONICAL_QQQ,
            projectAdapter: state.projectAdapter,
            stockAdapter: state.stockAdapter,
            feeRecipient: "0x0000000000000000000000000000000000000000",
            explicitFeeBps: 0,
            eligibilityChecker: state.checker,
            guardian: state.registryAddress,
            maxAmountIn: BigInt(state.maxAmountInWei),
          };
          if (functionName in gatewayValues) return gatewayValues[functionName];
        }
        if (same(address, state.projectAdapter) || same(address, state.stockAdapter)) {
          const stock = same(address, state.stockAdapter);
          const adapterValues = {
            inputToken: CANONICAL_WETH,
            outputToken: stock ? CANONICAL_QQQ : state.officialToken,
            quoter: CANONICAL_QUOTER,
            router: CANONICAL_SWAP_ROUTER,
            marketRegistry: state.registryAddress,
            path: stock ? stockPath : projectPath,
          };
          if (functionName in adapterValues) return adapterValues[functionName];
        }
        if (same(address, state.checker)) {
          const checkerValues = {
            eligibilityAuthority: state.eligibilityAuthority,
            policyHash: state.policyHash,
            policyAdmin: state.projectAuthority,
          };
          if (functionName in checkerValues) return checkerValues[functionName];
        }
        throw new Error(`Unexpected read ${functionName} at ${address}`);
      },
    },
  };
}

function readyOperations() {
  return {
    checks: {
      eligibilityProvider: true,
      statsIndexer: true,
      distributedRateLimit: true,
      monitoring: true,
      independentAudit: true,
      stockAssetRegistry: true,
    },
    publicValue: {},
  };
}

function proofRuntime(overrides = {}) {
  return {
    registryAddress: ADDRESSES.registry,
    officialTokenAddress: ADDRESSES.official,
    gatewayAddress: ADDRESSES.gateway,
    stockTokenAddress: CANONICAL_QQQ,
    activatedBlock: 100,
    marketRegistered: true,
    gatewayInitializedOnchain: true,
    gatewayPaused: false,
    checks: Object.fromEntries([
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
      "activatedBlock",
    ].map((name) => [name, true])),
    ...overrides,
  };
}

function indexedSnapshot(overrides = {}) {
  return {
    schemaVersion: 1,
    chainId: 4663,
    gatewayAddress: ADDRESSES.gateway,
    officialTokenAddress: ADDRESSES.official,
    stockTokenAddress: CANONICAL_QQQ,
    activatedBlock: "100",
    asOfBlock: "500000",
    confirmations: 12,
    checkedAt: new Date().toISOString(),
    members: {
      memberCount: 2,
      buyCount: 3,
      scope: "ALL_CANONICAL_GATEWAY_EPOCHS",
      recipient: ADDRESSES.wallet,
      memberNumber: 1,
    },
    holderStock: {
      status: "ready",
      selfBuyCount: 1,
      uniqueBuyerCount: 1,
      usdgSpentRaw: "725450000",
      usdgSpent: "725.45",
      usdgDecimals: 6,
      qqqAmountOutRaw: "1000000000000000000",
      qqqAmount: "1",
      qqqDecimals: 18,
      approximateUsdValue: "725.45",
      settlementTokenAddress: CANONICAL_USDG,
      settlementPoolAddress: CANONICAL_USDG_QQQ_POOL,
      source: "CONFIRMED_SELF_SPLITBUY_USDG_QQQ_SWAPS",
      scope: "CURRENT_CANONICAL_GATEWAY_SINCE_ACTIVATION",
      valuationBasis: "USDG_NOMINAL_DOLLAR",
      qualification: "PAYER_EQUALS_RECIPIENT_AND_ALL_SPLIT_AMOUNTS_POSITIVE",
    },
    ...overrides,
  };
}

function mockResponse() {
  return {
    headers: {},
    statusCode: 0,
    body: "",
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    end(body = "") {
      this.body = body;
    },
  };
}

test("Uniswap V3 paths and fee-first split are deterministic", () => {
  const path = v3Path(ADDRESSES.input, 500, ADDRESSES.official);
  const analyzed = analyzeV3Path(path);
  assert.deepEqual(analyzed.tokens.map((token) => token.toLowerCase()), [
    ADDRESSES.input,
    ADDRESSES.official,
  ]);
  assert.deepEqual(analyzed.fees, [500]);

  const split = calculateSplit(10_000n, 100);
  assert.deepEqual(split, {
    fee: 100n,
    net: 9_900n,
    projectAmountIn: 9_801n,
    stockAmountIn: 99n,
  });
  assert.equal(applySlippage(10_000n, 200), 9_800n);
});

test("eligibility is fail-closed for blocked or unknown countries", async () => {
  __resetEligibilityCacheForTests();
  const config = getServerConfig({
    ELIGIBILITY_PROVIDER_URL: "https://provider.example/check",
    ELIGIBILITY_SIGNING_SECRET: "s".repeat(40),
  });
  let providerCalls = 0;
  const fetchImpl = async () => {
    providerCalls += 1;
    return new Response(JSON.stringify({ eligible: true }), { status: 200 });
  };
  const blocked = await decideEligibility(config, {
    wallet: ADDRESSES.wallet,
    countryCode: "US",
    termsAccepted: true,
    notUSPerson: true,
    fetchImpl,
  });
  assert.equal(blocked.eligible, false);
  assert.equal(blocked.reason, "JURISDICTION_BLOCKED");

  const unknown = await decideEligibility(config, {
    wallet: ADDRESSES.wallet,
    countryCode: null,
    termsAccepted: true,
    notUSPerson: true,
    fetchImpl,
  });
  assert.equal(unknown.eligible, false);
  assert.equal(unknown.reason, "COUNTRY_UNKNOWN");
  assert.equal(providerCalls, 0);
});

test("positive provider decisions are signed, cached, and verifiable", async () => {
  __resetEligibilityCacheForTests();
  const config = getServerConfig({
    ELIGIBILITY_PROVIDER_URL: "https://provider.example/check",
    ELIGIBILITY_SIGNING_SECRET: "p".repeat(40),
    ELIGIBILITY_PROVIDER_REQUEST_SECRET: "r".repeat(40),
  });
  let providerCalls = 0;
  const fetchImpl = async () => {
    providerCalls += 1;
    return signedJsonResponse({
      schemaVersion: 1,
      eligible: true,
      reason: "PROVIDER_ELIGIBLE",
      decisionId: "decision-1",
      provider: "independent-provider",
      wallet: ADDRESSES.wallet,
      chainId: 4663,
      stockTokenAddress: CANONICAL_QQQ,
      countryCode: "SG",
      expiresAt: new Date(Date.now() + 120_000).toISOString(),
    }, config.eligibilityProviderRequestSecret, {
      timestampHeader: "x-degen-provider-timestamp",
      signatureHeader: "x-degen-provider-signature",
    });
  };
  const input = {
    wallet: ADDRESSES.wallet,
    countryCode: "SG",
    termsAccepted: true,
    notUSPerson: true,
    fetchImpl,
  };
  const first = await decideEligibility(config, input);
  const second = await decideEligibility(config, input);
  assert.equal(first.eligible, true);
  assert.equal(second.proof.token, first.proof.token);
  assert.equal(providerCalls, 1);
  const payload = verifyProviderProof(config, first.proof.token, ADDRESSES.wallet);
  assert.equal(payload.decisionId, "decision-1");
});

test("external provider responses require a fresh HMAC and future expiry", async () => {
  __resetEligibilityCacheForTests();
  const config = getServerConfig({
    ELIGIBILITY_PROVIDER_MODE: "external",
    ELIGIBILITY_PROVIDER_URL: "https://provider.example/check",
    ELIGIBILITY_PROVIDER_API_KEY: "provider-api-key-value",
    ELIGIBILITY_PROVIDER_REQUEST_SECRET: "r".repeat(40),
    ELIGIBILITY_SIGNING_SECRET: "s".repeat(40),
  });
  const input = {
    wallet: ADDRESSES.wallet,
    countryCode: "SG",
    termsAccepted: true,
    notUSPerson: true,
  };
  await assert.rejects(
    decideEligibility(config, {
      ...input,
      fetchImpl: async () => new Response(JSON.stringify({
        eligible: true,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }), { status: 200 }),
    }),
    (error) => error instanceof ApiError && error.code === "ELIGIBILITY_PROVIDER_UNTRUSTED",
  );
  await assert.rejects(
    decideEligibility(config, {
      ...input,
      fetchImpl: async () => signedJsonResponse({
        schemaVersion: 1,
        eligible: true,
        reason: "PROVIDER_ELIGIBLE",
        decisionId: "expired-decision",
        provider: "independent-provider",
        wallet: ADDRESSES.wallet,
        chainId: 4663,
        stockTokenAddress: CANONICAL_QQQ,
        countryCode: "SG",
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
      }, config.eligibilityProviderRequestSecret, {
        timestampHeader: "x-degen-provider-timestamp",
        signatureHeader: "x-degen-provider-signature",
      }),
    }),
    (error) => error instanceof ApiError && error.code === "ELIGIBILITY_PROVIDER_INVALID",
  );

  await assert.rejects(
    decideEligibility(config, {
      ...input,
      fetchImpl: async () => signedJsonResponse({
        schemaVersion: 1,
        eligible: true,
        reason: "PROVIDER_ELIGIBLE",
        decisionId: "wrong-wallet-decision",
        provider: "independent-provider",
        wallet: ADDRESSES.official,
        chainId: 4663,
        stockTokenAddress: CANONICAL_QQQ,
        countryCode: "SG",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }, config.eligibilityProviderRequestSecret, {
        timestampHeader: "x-degen-provider-timestamp",
        signatureHeader: "x-degen-provider-signature",
      }),
    }),
    (error) => error instanceof ApiError && error.code === "ELIGIBILITY_PROVIDER_BINDING_MISMATCH",
  );
});

test("operational readiness verifies index health and the audit report digest", async () => {
  __resetOperationalCachesForTests();
  const auditBytes = Buffer.from("%PDF-1.7\nindependent audit fixture\n%%EOF\n");
  const indexerSecret = "i".repeat(40);
  const rateSecret = "l".repeat(40);
  const monitorSecret = "m".repeat(40);
  const config = getServerConfig({
    VERCEL_ENV: "production",
    ELIGIBILITY_PROVIDER_MODE: "external",
    ELIGIBILITY_PROVIDER_URL: "https://provider.example/check",
    ELIGIBILITY_PROVIDER_API_KEY: "provider-api-key-value",
    ELIGIBILITY_PROVIDER_REQUEST_SECRET: "e".repeat(40),
    ELIGIBILITY_SIGNING_SECRET: "s".repeat(40),
    STATS_INDEXER_URL: "https://indexer.example/",
    STATS_INDEXER_API_KEY: "indexer-api-key-value",
    STATS_INDEXER_HMAC_SECRET: indexerSecret,
    RATE_LIMIT_PROVIDER_URL: "https://limits.example/consume",
    RATE_LIMIT_PROVIDER_TOKEN: "rate-limit-token-value",
    RATE_LIMIT_PROVIDER_HMAC_SECRET: rateSecret,
    MONITORING_WEBHOOK_URL: "https://monitor.example/events",
    MONITORING_WEBHOOK_TOKEN: "monitor-token-value",
    MONITORING_WEBHOOK_HMAC_SECRET: monitorSecret,
    INDEPENDENT_AUDIT_REPORT_URL: "https://auditor.example/report.pdf",
    INDEPENDENT_AUDIT_SHA256: createHash("sha256").update(auditBytes).digest("hex"),
    INDEPENDENT_AUDIT_FIRM: "Independent Security Lab",
    INDEPENDENT_AUDIT_COMPLETED_AT: "2026-07-01T00:00:00.000Z",
  });
  let healthCalls = 0;
  const fetchImpl = async (url, options) => {
    healthCalls += 1;
    assert.equal(options.redirect, "error");
    const target = String(url);
    if (target.includes("healthz")) {
      return signedJsonResponse({
        schemaVersion: 1,
        ok: true,
        chainId: 4663,
        indexedThroughBlock: "12345",
      }, indexerSecret, {
        timestampHeader: "x-degen-indexer-timestamp",
        signatureHeader: "x-degen-indexer-signature",
      });
    }
    if (target.includes("limits.example")) {
      const { requestId } = JSON.parse(options.body);
      return signedJsonResponse({ schemaVersion: 1, ok: true, requestId }, rateSecret, {
        timestampHeader: "x-degen-service-timestamp",
        signatureHeader: "x-degen-service-signature",
      });
    }
    if (target.includes("monitor.example")) {
      const { requestId } = JSON.parse(options.body);
      return signedJsonResponse({ schemaVersion: 1, ok: true, requestId }, monitorSecret, {
        timestampHeader: "x-degen-service-timestamp",
        signatureHeader: "x-degen-service-signature",
      });
    }
    if (target.includes("api.robinhood.com/rhj/assets")) {
      return new Response(JSON.stringify({ assets: [{
        tokenSymbol: "QQQ",
        status: "ASSET_STATUS_ACTIVE",
        deployments: [{ chainId: 4663, contractAddress: CANONICAL_QQQ }],
        tradingCapabilities: {
          market: {
            whole: "TRADING_STATUS_TRADABLE",
            fractional: "TRADING_STATUS_TRADABLE",
          },
        },
      }] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(auditBytes, {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-length": String(auditBytes.length),
      },
    });
  };
  const result = await checkOperationalReadiness(config, {
    fetchImpl,
  });
  assert.deepEqual(result.checks, {
    eligibilityProvider: true,
    statsIndexer: true,
    distributedRateLimit: true,
    monitoring: true,
    independentAudit: true,
    stockAssetRegistry: true,
  });
  assert.equal(healthCalls, 5);
  const cached = await checkOperationalReadiness(config, { fetchImpl });
  assert.equal(cached, result);
  assert.equal(healthCalls, 5);
});

test("official Stock registry requires one active, market-tradable canonical QQQ deployment", async () => {
  const config = getServerConfig({ VERCEL_ENV: "production" });
  const checked = await checkStockAssetRegistry(config, {
    fetchImpl: async (_url, options) => {
      assert.equal(options.redirect, "error");
      return new Response(JSON.stringify({ assets: [{
        tokenSymbol: "QQQ",
        status: "ASSET_STATUS_ACTIVE",
        deployments: [{ chainId: 4663, contractAddress: CANONICAL_QQQ }],
        tradingCapabilities: {
          market: {
            whole: "TRADING_STATUS_TRADABLE",
            fractional: "TRADING_STATUS_TRADABLE",
          },
        },
      }] }), { status: 200 });
    },
  });
  assert.equal(checked.verified, true);

  const suspended = await checkStockAssetRegistry(config, {
    fetchImpl: async () => new Response(JSON.stringify({ assets: [{
      tokenSymbol: "QQQ",
      status: "ASSET_STATUS_ACTIVE",
      deployments: [{ chainId: 4663, contractAddress: CANONICAL_QQQ }],
      tradingCapabilities: {
        market: {
          whole: "TRADING_STATUS_TRADABLE",
          fractional: "TRADING_STATUS_HALTED",
        },
      },
    }] }), { status: 200 }),
  });
  assert.equal(suspended.verified, false);
});

test("distributed rate limiting fails closed unless the signed decision is valid", async () => {
  const secret = "l".repeat(40);
  const config = getServerConfig({
    VERCEL_ENV: "production",
    RATE_LIMIT_PROVIDER_URL: "https://limits.example/consume",
    RATE_LIMIT_PROVIDER_TOKEN: "rate-limit-token-value",
    RATE_LIMIT_PROVIDER_HMAC_SECRET: secret,
  });
  const decision = await consumeDistributedRateLimit(config, {
    key: "quote:203.0.113.5",
    maximum: 15,
    windowMs: 60_000,
    fetchImpl: async (_url, options) => {
      assert.equal(options.redirect, "error");
      assert.doesNotMatch(options.body, /203\.0\.113\.5/);
      const { requestId } = JSON.parse(options.body);
      return signedJsonResponse({
        schemaVersion: 1,
        allowed: true,
        remaining: 14,
        resetAt: Date.now() + 60_000,
        requestId,
      }, secret, {
        timestampHeader: "x-degen-service-timestamp",
        signatureHeader: "x-degen-service-signature",
      });
    },
  });
  assert.equal(decision.allowed, true);
  assert.equal(decision.remaining, 14);
});

test("production release manifest blocks inactive snapshots and every active binding mismatch", () => {
  const activeManifest = activeReleaseManifest();
  const exactSnapshot = {
    chainId: activeManifest.chainId,
    protocolVersion: activeManifest.protocolVersion,
    registryAddress: activeManifest.registry,
    projectAuthorityAddress: activeManifest.projectAuthority,
    officialTokenAddress: activeManifest.currentOfficialToken,
    gatewayAddress: activeManifest.currentMarket,
    activatedBlock: activeManifest.currentActivatedBlock,
    implementationAddress: activeManifest.gatewayImplementation,
    implementationCodeHash: activeManifest.gatewayImplementationRuntimeCodeHash,
    eligibilityCheckerAddress: activeManifest.eligibilityChecker,
    eligibilityAuthorityAddress: activeManifest.eligibilityAuthority,
    policyHash: activeManifest.eligibilityPolicyHash,
    stockAdapterAddress: activeManifest.stockAdapter,
    maxAmountInWei: activeManifest.maxAmountInWei,
    marketReady: true,
  };

  assert.equal(
    releaseManifestSnapshotMatches({ ...exactSnapshot, marketReady: false }, PRODUCTION_RELEASE_MANIFEST),
    false,
    "an inactive manifest must block a merely discovered activation",
  );
  assert.equal(
    releaseManifestSnapshotMatches(exactSnapshot, PRODUCTION_RELEASE_MANIFEST),
    false,
    "an inactive manifest must also block a fully active onchain market",
  );
  assert.equal(releaseManifestSnapshotMatches(exactSnapshot, activeManifest), true);

  const mismatches = [
    ["chain", { chainId: 1 }],
    ["protocol", { protocolVersion: 1 }],
    ["Registry", { registryAddress: ADDRESSES.input }],
    ["CA", { officialTokenAddress: ADDRESSES.input }],
    ["Gateway", { gatewayAddress: ADDRESSES.input }],
    ["activation block", { activatedBlock: 101 }],
    ["implementation", { implementationAddress: ADDRESSES.input }],
    ["implementation code hash", { implementationCodeHash: `0x${"34".repeat(32)}` }],
    ["checker", { eligibilityCheckerAddress: ADDRESSES.input }],
    ["eligibility authority", { eligibilityAuthorityAddress: ADDRESSES.input }],
    ["policy", { policyHash: `0x${"56".repeat(32)}` }],
    ["Stock Adapter", { stockAdapterAddress: ADDRESSES.input }],
    ["maximum input", { maxAmountInWei: "999" }],
  ];
  for (const [label, mismatch] of mismatches) {
    assert.equal(
      releaseManifestSnapshotMatches({ ...exactSnapshot, ...mismatch }, activeManifest),
      false,
      `${label} mismatch must fail closed`,
    );
  }
});

test("production release manifest validates every reviewed control-plane field", () => {
  assert.equal(isValidProductionReleaseManifest(PRODUCTION_RELEASE_MANIFEST), true);
  const invalidFields = [
    ["deployer", null],
    ["launchOperator", null],
    ["guardian", null],
    ["eligibilityAuthority", null],
    ["ponsAdapterFactory", null],
    ["gatewayImplementationLocked", false],
    ["operatorAuthorized", false],
    ["registrySourceVerified", false],
    ["gatewayImplementationSourceVerified", false],
    ["eligibilityCheckerSourceVerified", false],
    ["stockAdapterSourceVerified", false],
    ["ponsAdapterFactorySourceVerified", false],
    ["maxAmountInWei", "999"],
  ];
  for (const [field, value] of invalidFields) {
    assert.equal(
      isValidProductionReleaseManifest({ ...PRODUCTION_RELEASE_MANIFEST, [field]: value }),
      false,
      `${field} must be part of the reviewed manifest schema`,
    );
  }
});

test("server runtime becomes READY only for an exact active manifest and onchain stack", async () => {
  const implementationBytecode = "0x6001600055";
  const activeManifest = activeReleaseManifest({
    gatewayImplementationRuntimeCodeHash: keccak256(implementationBytecode),
  });
  const activeConfig = {
    ...productionReleaseConfig(activeManifest),
    stockTokenAddress: CANONICAL_QQQ,
    quoterAddress: CANONICAL_QUOTER,
    runtimeCacheSeconds: 0,
  };
  const activeFixture = releaseRuntimeClient(activeManifest, { implementationBytecode });
  let activeOperationsCalls = 0;
  const active = await loadRuntime(activeConfig, {
    fresh: true,
    releaseManifest: activeManifest,
    clientFactory: () => activeFixture.client,
    operationsChecker: async () => {
      activeOperationsCalls += 1;
      return readyOperations();
    },
  });
  assert.equal(activeOperationsCalls, 1);
  assert.equal(active.checks.releaseManifest, true);
  assert.equal(active.releaseManifest.bound, true);
  assert.equal(active.ready, true);
  assert.equal(active.status, "READY");

  const staleEnv = await loadRuntime({ ...activeConfig, registryAddress: ADDRESSES.input }, {
    fresh: true,
    releaseManifest: activeManifest,
    clientFactory: () => activeFixture.client,
    operationsChecker: async () => readyOperations(),
  });
  assert.equal(staleEnv.registryAddress.toLowerCase(), activeManifest.registry.toLowerCase());
  assert.equal(staleEnv.checks.releaseManifest, false);
  assert.equal(staleEnv.ready, false, "an env-selected Registry cannot replace the manifest Registry");

  const rotatedSignerFixture = releaseRuntimeClient(activeManifest, {
    implementationBytecode,
    eligibilityAuthority: ADDRESSES.input,
  });
  const rotatedSigner = await loadRuntime(activeConfig, {
    fresh: true,
    releaseManifest: activeManifest,
    clientFactory: () => rotatedSignerFixture.client,
    operationsChecker: async () => readyOperations(),
  });
  assert.equal(rotatedSigner.checks.releaseManifest, false);
  assert.equal(rotatedSigner.ready, false, "a signer rotation requires a reviewed manifest update");

  const changedMaximumFixture = releaseRuntimeClient(activeManifest, {
    implementationBytecode,
    maxAmountInWei: "999",
  });
  const changedMaximum = await loadRuntime(activeConfig, {
    fresh: true,
    releaseManifest: activeManifest,
    clientFactory: () => changedMaximumFixture.client,
    operationsChecker: async () => readyOperations(),
  });
  assert.equal(changedMaximum.checks.releaseManifest, false);
  assert.equal(changedMaximum.ready, false, "an onchain maximum change requires a reviewed manifest update");

  const inactiveManifest = {
    ...activeManifest,
    tradingActive: false,
    currentOfficialToken: null,
    currentMarket: null,
    currentActivatedBlock: 0,
  };
  const inactiveConfig = {
    ...productionReleaseConfig(inactiveManifest),
    stockTokenAddress: CANONICAL_QQQ,
    quoterAddress: CANONICAL_QUOTER,
    runtimeCacheSeconds: 0,
  };
  let inactiveOperationsCalls = 0;
  for (const marketReady of [false, true]) {
    const fixture = releaseRuntimeClient(inactiveManifest, {
      implementationBytecode,
      marketReady,
    });
    const blocked = await loadRuntime(inactiveConfig, {
      fresh: true,
      releaseManifest: inactiveManifest,
      clientFactory: () => fixture.client,
      operationsChecker: async () => {
        inactiveOperationsCalls += 1;
        return readyOperations();
      },
    });
    assert.equal(blocked.checks.releaseManifest, false);
    assert.equal(blocked.releaseManifest.tradingActive, false);
    assert.equal(blocked.releaseManifest.bound, false);
    assert.equal(blocked.ready, false);
    assert.equal(blocked.status, "NOT_READY");
  }
  assert.equal(inactiveOperationsCalls, 0, "an inactive manifest must not probe external operations");
});

test("production runtime publicly reports the checked-in inactive manifest gate", async () => {
  const config = {
    ...getServerConfig({ VERCEL_ENV: "production" }),
    stockTokenAddress: null,
  };
  const runtime = await loadRuntime(config, {
    fresh: true,
    operationsChecker: async () => ({ checks: {}, publicValue: {} }),
    clientFactory: () => {
      throw new Error("inactive manifest preflight must fail before RPC");
    },
  });
  assert.equal(runtime.ready, false);
  assert.equal(runtime.checks.releaseManifest, false);
  assert.deepEqual(runtime.releaseManifest, {
    required: true,
    manifestId: "robinhood-mainnet-production-v2",
    tradingActive: false,
    bound: false,
  });
});

test("production quote cannot be unlocked by a forged ready runtime while the manifest is inactive", async () => {
  let runtimeCalls = 0;
  let eligibilityCalls = 0;
  await assert.rejects(
    createQuote(getServerConfig({ VERCEL_ENV: "production" }), {
      wallet: ADDRESSES.wallet,
      recipient: ADDRESSES.wallet,
      amountInWei: 10_000_000_000_000_000n,
      slippageBps: 200,
      termsAccepted: true,
      notUSPerson: true,
      countryCode: "SG",
      runtimeLoader: async () => {
        runtimeCalls += 1;
        return { ready: true, checks: { releaseManifest: true } };
      },
      eligibilityDecider: async () => {
        eligibilityCalls += 1;
        return { eligible: true };
      },
    }),
    (error) => error instanceof ApiError
      && error.status === 503
      && error.code === "RELEASE_MANIFEST_INACTIVE",
  );
  assert.equal(runtimeCalls, 0);
  assert.equal(eligibilityCalls, 0);
});

test("production quote rechecks manifest signer and maximum bindings before eligibility", async () => {
  const releaseManifest = activeReleaseManifest();
  const config = productionReleaseConfig(releaseManifest);
  const boundRuntime = {
    ready: true,
    status: "READY",
    checks: { releaseManifest: true, factoryMarket: true },
    releaseManifest: {
      required: true,
      manifestId: releaseManifest.manifestId,
      tradingActive: true,
      bound: true,
    },
    chainId: releaseManifest.chainId,
    protocolVersion: releaseManifest.protocolVersion,
    registryAddress: releaseManifest.registry,
    projectAuthorityAddress: releaseManifest.projectAuthority,
    officialTokenAddress: releaseManifest.currentOfficialToken,
    gatewayAddress: releaseManifest.currentMarket,
    activatedBlock: releaseManifest.currentActivatedBlock,
    implementationAddress: releaseManifest.gatewayImplementation,
    implementationCodeHash: releaseManifest.gatewayImplementationRuntimeCodeHash,
    eligibilityCheckerAddress: releaseManifest.eligibilityChecker,
    eligibilitySignerAddress: releaseManifest.eligibilityAuthority,
    policyHash: releaseManifest.eligibilityPolicyHash,
    stockAdapterAddress: releaseManifest.stockAdapter,
    onchainMaximumBuyWei: releaseManifest.maxAmountInWei,
  };
  const mismatches = [
    { eligibilitySignerAddress: ADDRESSES.input },
    { onchainMaximumBuyWei: "999" },
  ];
  for (const mismatch of mismatches) {
    let eligibilityCalls = 0;
    await assert.rejects(
      createQuote(config, {
        wallet: ADDRESSES.wallet,
        recipient: ADDRESSES.wallet,
        amountInWei: 10_000_000_000_000_000n,
        slippageBps: 200,
        termsAccepted: true,
        notUSPerson: true,
        countryCode: "SG",
        runtimeLoader: async () => ({ ...boundRuntime, ...mismatch }),
        eligibilityDecider: async () => {
          eligibilityCalls += 1;
          return { eligible: true };
        },
        releaseManifest,
      }),
      (error) => error instanceof ApiError
        && error.status === 503
        && error.code === "MARKET_NOT_READY"
        && error.details.failedChecks.includes("releaseManifest"),
    );
    assert.equal(eligibilityCalls, 0);
  }
});

test("Production confirmation depth cannot be configured to zero", () => {
  assert.equal(getServerConfig({ VERCEL_ENV: "production", LOG_CONFIRMATIONS: "0" }).confirmations, 12);
  assert.equal(getServerConfig({ LOG_CONFIRMATIONS: "0" }).confirmations, 0);
});

test("quote uses onchain Quoter outputs, signed eligibility, and full Gateway simulation", async () => {
  const signer = privateKeyToAccount(TEST_PRIVATE_KEY);
  const releaseManifest = activeReleaseManifest();
  const config = {
    ...productionReleaseConfig(releaseManifest),
    officialTokenAddress: ADDRESSES.official,
    stockTokenAddress: ADDRESSES.stock,
    gatewayAddress: ADDRESSES.gateway,
    quoterAddress: ADDRESSES.quoter,
    projectQuotePath: v3Path(ADDRESSES.input, 500, ADDRESSES.official),
    stockQuotePath: v3Path(ADDRESSES.input, 3_000, ADDRESSES.stock),
    eligibilitySignerPrivateKey: TEST_PRIVATE_KEY,
    quoteTtlSeconds: 45,
  };
  const checks = Object.fromEntries([
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
  ].map((name) => [name, true]));
  const runtime = {
    ready: true,
    status: "READY",
    checks,
    releaseManifest: {
      required: true,
      manifestId: releaseManifest.manifestId,
      tradingActive: true,
      bound: true,
    },
    chainId: releaseManifest.chainId,
    protocolVersion: releaseManifest.protocolVersion,
    registryAddress: releaseManifest.registry,
    factoryAddress: releaseManifest.registry,
    projectAuthorityAddress: releaseManifest.projectAuthority,
    officialTokenAddress: releaseManifest.currentOfficialToken,
    gatewayAddress: ADDRESSES.gateway,
    activatedBlock: releaseManifest.currentActivatedBlock,
    implementationAddress: releaseManifest.gatewayImplementation,
    implementationCodeHash: releaseManifest.gatewayImplementationRuntimeCodeHash,
    stockAdapterAddress: releaseManifest.stockAdapter,
    onchainMaximumBuyWei: releaseManifest.maxAmountInWei,
    explicitFeeBps: 0,
    eligibilityCheckerAddress: ADDRESSES.checker,
    eligibilitySignerAddress: signer.address,
    policyHash: POLICY_HASH,
    routes: {
      projectPath: config.projectQuotePath,
      stockPath: config.stockQuotePath,
    },
  };
  let quoterCalls = 0;
  const mockClient = {
    async call({ to }) {
      if (to.toLowerCase() === ADDRESSES.quoter) {
        quoterCalls += 1;
        const output = quoterCalls === 1 ? 100_000n : 1_000n;
        return {
          data: encodeFunctionResult({
            abi: QUOTER_V2_ABI,
            functionName: "quoteExactInput",
            result: [output, [], [], 123n],
          }),
        };
      }
      assert.equal(to.toLowerCase(), ADDRESSES.gateway);
      return {
        data: encodeFunctionResult({
          abi: GATEWAY_ABI,
          functionName: "buyNative",
          result: [99_000n, 990n],
        }),
      };
    },
    async getBlock() {
      return { number: 123n, timestamp: BigInt(Math.floor(Date.now() / 1_000)) };
    },
  };
  const quote = await createQuote(config, {
    wallet: ADDRESSES.wallet,
    recipient: ADDRESSES.wallet,
    amountInWei: 10_000_000_000_000_000n,
    slippageBps: 200,
    termsAccepted: true,
    notUSPerson: true,
    countryCode: "SG",
    runtimeLoader: async () => runtime,
    clientFactory: () => mockClient,
    eligibilityDecider: async () => ({
      eligible: true,
      reason: "ELIGIBLE",
      countryCode: "SG",
      checkedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 120_000).toISOString(),
      proof: { token: "provider-proof" },
    }),
    releaseManifest,
  });

  assert.equal(quote.schemaVersion, 1);
  assert.equal(quote.minProjectOut, "98000");
  assert.equal(quote.minStockOut, "980");
  assert.equal(quote.projectAmountOut, "99000");
  assert.equal(quote.stockAmountOut, "990");
  assert.equal(quote.transaction.to.toLowerCase(), ADDRESSES.gateway);
  assert.equal(quote.transaction.chainId, 4663);

  const decoded = decodeFunctionData({ abi: GATEWAY_ABI, data: quote.transaction.data });
  assert.equal(decoded.functionName, "buyNative");
  assert.equal(decoded.args[2].toLowerCase(), ADDRESSES.wallet);
  assert.equal(decoded.args[0], 98_000n);
  assert.equal(decoded.args[1], 980n);
  assert.equal(decoded.args.length, 6);

  const recovered = await recoverTypedDataAddress({
    ...quote.typedPayload,
    message: {
      ...quote.typedPayload.message,
      validUntil: BigInt(quote.typedPayload.message.validUntil),
    },
    signature: quote.eligibilityProof.signature,
  });
  assert.equal(recovered.toLowerCase(), signer.address.toLowerCase());
});

test("holder stats need only the canonical token binding and reject invented counts", async () => {
  __resetStatsCacheForTests();
  const config = {
    ...getServerConfig({}),
    officialTokenAddress: null,
    statsCacheSeconds: 0,
  };
  const valid = await loadHolderCount(config, {
    runtimeLoader: async () => ({
      ready: false,
      officialTokenAddress: ADDRESSES.official,
    }),
    fetchImpl: async () =>
      new Response(JSON.stringify({ holders_count: 42 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  });
  assert.equal(valid.holderCount, 42);
  await assert.rejects(
    loadHolderCount(config, {
      runtimeLoader: async () => ({
        ready: true,
        officialTokenAddress: ADDRESSES.official,
      }),
      fetchImpl: async () =>
        new Response(JSON.stringify({ holders_count: "fake" }), { status: 200 }),
    }),
    /invalid count/i,
  );
  await assert.rejects(
    loadHolderCount(config, {
      runtimeLoader: async () => ({
        ready: false,
        officialTokenAddress: ADDRESSES.official,
      }),
      fetchImpl: async () => new Response("x".repeat(65_537), { status: 200 }),
    }),
    (error) => error instanceof ApiError
      && error.status === 503
      && error.code === "HOLDER_SOURCE_INVALID",
  );
});

test("holder stats fail closed when neither runtime nor config has an official token", async () => {
  __resetStatsCacheForTests();
  const config = {
    ...getServerConfig({}),
    officialTokenAddress: null,
    statsCacheSeconds: 0,
  };
  await assert.rejects(
    loadHolderCount(config, {
      runtimeLoader: async () => ({ ready: false, officialTokenAddress: null }),
      fetchImpl: async () => {
        throw new Error("must not fetch without a canonical token");
      },
    }),
    (error) => error instanceof ApiError
      && error.status === 503
      && error.code === "OFFICIAL_TOKEN_NOT_CONFIGURED",
  );
});

test("signed durable indexer serves public stats while trading runtime is not ready", async () => {
  __resetStatsCacheForTests();
  const secret = "i".repeat(40);
  const config = {
    ...getServerConfig({
      VERCEL_ENV: "production",
      LOG_CONFIRMATIONS: "12",
      STATS_CACHE_SECONDS: "0",
      STATS_INDEXER_URL: "https://indexer.example/",
      STATS_INDEXER_API_KEY: "indexer-api-key-value",
      STATS_INDEXER_HMAC_SECRET: secret,
    }),
    officialTokenAddress: ADDRESSES.official,
    gatewayAddress: ADDRESSES.gateway,
    registryAddress: ADDRESSES.registry,
    activatedBlock: 100,
  };
  const fetchImpl = async (_url, options) => {
    assert.equal(options.redirect, "error");
    assert.match(options.headers["x-degen-request-signature"], /^sha256=[a-f0-9]{64}$/);
    return signedJsonResponse(indexedSnapshot(), secret, {
      timestampHeader: "x-degen-indexer-timestamp",
      signatureHeader: "x-degen-indexer-signature",
    });
  };

  const member = await loadMemberCount(config, {
    recipient: ADDRESSES.wallet,
    runtimeLoader: async () => proofRuntime({ ready: false, status: "NOT_READY" }),
    fetchImpl,
  });
  assert.equal(member.memberNumber, 1);
  assert.equal(member.memberCount, 2);
  assert.equal(member.dataPlane, "SIGNED_DURABLE_INDEXER");

  const proof = await loadHolderStockProof(config, {
    runtimeLoader: async () => proofRuntime({ ready: false, status: "NOT_READY" }),
    clientFactory: () => {
      throw new Error("durable snapshots must not perform a bounded RPC scan");
    },
    fetchImpl,
  });
  assert.equal(proof.approximateUsdValue, "725.45");
  assert.equal(proof.dataPlane, "SIGNED_DURABLE_INDEXER");
});

test("production stats use Registry runtime bindings and treat stale env values as mismatches", async () => {
  const baseConfig = {
    ...getServerConfig({ VERCEL_ENV: "production", STATS_CACHE_SECONDS: "0" }),
    officialTokenAddress: ADDRESSES.official,
    gatewayAddress: ADDRESSES.gateway,
    registryAddress: ADDRESSES.registry,
    activatedBlock: 100,
  };
  const cases = [
    {
      name: "official token",
      config: { officialTokenAddress: ADDRESSES.input },
      code: "OFFICIAL_TOKEN_MISMATCH",
    },
    {
      name: "Gateway",
      config: { gatewayAddress: ADDRESSES.input },
      code: "GATEWAY_MISMATCH",
    },
    {
      name: "activation block",
      config: { activatedBlock: 101 },
      code: "ACTIVATION_BLOCK_MISMATCH",
    },
  ];

  for (const fixture of cases) {
    __resetStatsCacheForTests();
    let runtimeCalls = 0;
    await assert.rejects(
      loadMemberCount({ ...baseConfig, ...fixture.config }, {
        runtimeLoader: async () => {
          runtimeCalls += 1;
          return proofRuntime({ ready: false, status: "NOT_READY" });
        },
        clientFactory: () => {
          throw new Error("production must not scan after a stale env mismatch");
        },
      }),
      (error) => error instanceof ApiError
        && error.status === 503
        && error.code === fixture.code,
      fixture.name,
    );
    assert.equal(runtimeCalls, 1, `${fixture.name} must be checked against Registry runtime`);
  }
});

test("production holder stats do not fall back to a configured CA when Registry runtime is unavailable", async () => {
  __resetStatsCacheForTests();
  const config = {
    ...getServerConfig({ VERCEL_ENV: "production", STATS_CACHE_SECONDS: "0" }),
    officialTokenAddress: ADDRESSES.official,
    gatewayAddress: ADDRESSES.gateway,
    registryAddress: ADDRESSES.registry,
    activatedBlock: 100,
  };
  let holderSourceCalls = 0;
  await assert.rejects(
    loadHolderCount(config, {
      runtimeLoader: async () => {
        throw new Error("RPC offline");
      },
      fetchImpl: async () => {
        holderSourceCalls += 1;
        throw new Error("must not fetch a holder count without Registry runtime");
      },
    }),
    (error) => error instanceof ApiError
      && error.status === 503
      && error.code === "STATS_RUNTIME_UNAVAILABLE",
  );
  assert.equal(holderSourceCalls, 0);
});

test("production stats fail closed when current Registry market bindings are absent", async () => {
  const config = {
    ...getServerConfig({ VERCEL_ENV: "production", STATS_CACHE_SECONDS: "0" }),
    officialTokenAddress: ADDRESSES.official,
    gatewayAddress: ADDRESSES.gateway,
    registryAddress: ADDRESSES.registry,
    activatedBlock: 100,
  };
  const cases = [
    { name: "official token", runtime: { officialTokenAddress: null } },
    { name: "Gateway", runtime: { gatewayAddress: null } },
    { name: "activation block", runtime: { activatedBlock: 0 } },
    { name: "registered market", runtime: { marketRegistered: false } },
  ];

  for (const fixture of cases) {
    __resetStatsCacheForTests();
    await assert.rejects(
      loadMemberCount(config, {
        runtimeLoader: async () => proofRuntime({
          ready: false,
          status: "NOT_CONFIGURED",
          ...fixture.runtime,
        }),
        clientFactory: () => {
          throw new Error("production must not scan without current Registry bindings");
        },
      }),
      (error) => error instanceof ApiError
        && error.status === 503
        && error.code === "STATS_MARKET_NOT_CONFIGURED",
      fixture.name,
    );
  }
});

test("production index snapshots are bound to the market discovered from Registry runtime", async () => {
  __resetStatsCacheForTests();
  const secret = "i".repeat(40);
  const config = {
    ...getServerConfig({
      VERCEL_ENV: "production",
      STATS_CACHE_SECONDS: "0",
      STATS_INDEXER_URL: "https://indexer.example/",
      STATS_INDEXER_API_KEY: "indexer-api-key-value",
      STATS_INDEXER_HMAC_SECRET: secret,
    }),
    registryAddress: ADDRESSES.registry,
  };
  await assert.rejects(
    loadMemberCount(config, {
      runtimeLoader: async () => proofRuntime({ officialTokenAddress: ADDRESSES.input }),
      fetchImpl: async (url) => {
        assert.equal(new URL(url).searchParams.get("officialTokenAddress"), ADDRESSES.input);
        return signedJsonResponse(indexedSnapshot(), secret, {
          timestampHeader: "x-degen-indexer-timestamp",
          signatureHeader: "x-degen-indexer-signature",
        });
      },
    }),
    (error) => error instanceof ApiError
      && error.status === 503
      && error.code === "STATS_INDEXER_BINDING_MISMATCH",
  );
});

test("production cannot enable the bounded stats fallback", async () => {
  __resetStatsCacheForTests();
  const config = {
    ...getServerConfig({
      VERCEL_ENV: "production",
      ALLOW_BOUNDED_STATS_FALLBACK: "true",
    }),
    officialTokenAddress: ADDRESSES.official,
    gatewayAddress: ADDRESSES.gateway,
    registryAddress: ADDRESSES.registry,
    activatedBlock: 100,
  };
  assert.equal(config.allowBoundedStatsFallback, false);
  await assert.rejects(
    loadMemberCount(config, {
      runtimeLoader: async () => proofRuntime({ ready: false, status: "NOT_READY" }),
      clientFactory: () => {
        throw new Error("production must not enter the fallback scanner");
      },
    }),
    (error) => error instanceof ApiError && error.code === "STATS_INDEXER_REQUIRED",
  );
});

test("production service URLs reject local/private targets and embedded credentials", () => {
  const production = getServerConfig({
    VERCEL_ENV: "production",
    ROBINHOOD_RPC_URL: "https://rpc-override.example/",
    ELIGIBILITY_PROVIDER_URL: "https://127.0.0.1/check",
    STATS_INDEXER_URL: "https://10.0.0.8/",
    RATE_LIMIT_PROVIDER_URL: "https://user:pass@limits.example/consume",
    MONITORING_WEBHOOK_URL: "https://monitor.local/events",
  });
  assert.equal(production.eligibilityProviderUrl, null);
  assert.equal(production.statsIndexerUrl, null);
  assert.equal(production.rateLimitProviderUrl, null);
  assert.equal(production.monitoringWebhookUrl, null);
  assert.equal(production.rpcUrl, "https://rpc.mainnet.chain.robinhood.com");

  const development = getServerConfig({ STATS_INDEXER_URL: "http://localhost:8787" });
  assert.equal(development.statsIndexerUrl, "http://localhost:8787");
});

test("durable indexer rejects unsigned snapshots", async () => {
  __resetStatsCacheForTests();
  const config = {
    ...getServerConfig({
      VERCEL_ENV: "production",
      STATS_INDEXER_URL: "https://indexer.example/",
      STATS_INDEXER_API_KEY: "indexer-api-key-value",
      STATS_INDEXER_HMAC_SECRET: "i".repeat(40),
    }),
    officialTokenAddress: ADDRESSES.official,
    gatewayAddress: ADDRESSES.gateway,
    registryAddress: ADDRESSES.registry,
    activatedBlock: 100,
  };
  await assert.rejects(
    loadMemberCount(config, {
      runtimeLoader: async () => proofRuntime({ ready: false, status: "NOT_READY" }),
      fetchImpl: async () => new Response(JSON.stringify(indexedSnapshot()), { status: 200 }),
    }),
    (error) => error instanceof ApiError && error.code === "STATS_INDEXER_SIGNATURE_INVALID",
  );
});

test("holder Stock proof sums only confirmed self-buys matched to canonical USDG to QQQ swaps", async () => {
  __resetStatsCacheForTests();
  const selfBuyHash = `0x${"aa".repeat(32)}`;
  const delegatedBuyHash = `0x${"bb".repeat(32)}`;
  const incompleteBuyHash = `0x${"ee".repeat(32)}`;
  const config = {
    ...getServerConfig({
      LOG_CONFIRMATIONS: "12",
      STATS_CACHE_SECONDS: "0",
      MEMBER_LOG_CHUNK: "100",
      ALLOW_BOUNDED_STATS_FALLBACK: "true",
    }),
    officialTokenAddress: ADDRESSES.official,
    gatewayAddress: ADDRESSES.gateway,
    activatedBlock: 100,
  };
  const proof = await loadHolderStockProof(config, {
    runtimeLoader: async () => proofRuntime(),
    clientFactory: () => ({
      getBlockNumber: async () => 130n,
      getLogs: async ({ address, fromBlock, toBlock }) => {
        assert.equal(fromBlock, 100n);
        assert.equal(toBlock, 119n);
        if (address.toLowerCase() === ADDRESSES.gateway.toLowerCase()) {
          return [
            {
              blockNumber: 110n,
              transactionIndex: 0,
              logIndex: 1,
              transactionHash: selfBuyHash,
              args: {
                payer: ADDRESSES.wallet,
                recipient: ADDRESSES.wallet,
                projectAmountIn: 99n,
                stockAmountIn: 1n,
                projectAmountOut: 10n,
                stockAmountOut: 1_000_000_000_000_000_000n,
              },
            },
            {
              blockNumber: 111n,
              transactionIndex: 0,
              logIndex: 1,
              transactionHash: delegatedBuyHash,
              args: {
                payer: ADDRESSES.wallet,
                recipient: ADDRESSES.official,
                projectAmountIn: 99n,
                stockAmountIn: 1n,
                projectAmountOut: 10n,
                stockAmountOut: 2_000_000_000_000_000_000n,
              },
            },
            {
              blockNumber: 112n,
              transactionIndex: 0,
              logIndex: 1,
              transactionHash: incompleteBuyHash,
              args: {
                payer: ADDRESSES.wallet,
                recipient: ADDRESSES.wallet,
                projectAmountIn: 99n,
                stockAmountIn: 1n,
                projectAmountOut: 0n,
                stockAmountOut: 1n,
              },
            },
          ];
        }
        assert.equal(address.toLowerCase(), CANONICAL_USDG_QQQ_POOL.toLowerCase());
        return [
          {
            blockNumber: 110n,
            transactionIndex: 0,
            logIndex: 0,
            transactionHash: selfBuyHash,
            args: {
              sender: CANONICAL_SWAP_ROUTER,
              recipient: ADDRESSES.wallet,
              amount0: 725_450_000n,
              amount1: -1_000_000_000_000_000_000n,
            },
          },
        ];
      },
      readContract: async ({ address }) => {
        if (address.toLowerCase() === CANONICAL_USDG.toLowerCase()) return 6;
        assert.equal(address.toLowerCase(), CANONICAL_QQQ.toLowerCase());
        return 18;
      },
    }),
  });

  assert.equal(proof.status, "ready");
  assert.equal(proof.selfBuyCount, 1);
  assert.equal(proof.uniqueBuyerCount, 1);
  assert.equal(proof.usdgSpentRaw, "725450000");
  assert.equal(proof.usdgSpent, "725.45");
  assert.equal(proof.qqqAmount, "1");
  assert.equal(proof.approximateUsdValue, "725.45");
  assert.equal(proof.asOfBlock, "119");
  assert.equal(proof.officialTokenAddress.toLowerCase(), ADDRESSES.official);
  assert.equal(proof.source, "CONFIRMED_SELF_SPLITBUY_USDG_QQQ_SWAPS");
});

test("holder Stock proof rejects a zero-confirmation configuration before runtime access", async () => {
  __resetStatsCacheForTests();
  const config = {
    ...getServerConfig({ LOG_CONFIRMATIONS: "0", STATS_CACHE_SECONDS: "0" }),
    officialTokenAddress: ADDRESSES.official,
    gatewayAddress: ADDRESSES.gateway,
    activatedBlock: 100,
  };
  await assert.rejects(
    loadHolderStockProof(config, {
      runtimeLoader: async () => {
        throw new Error("zero-confirmation proof must not read runtime");
      },
    }),
    (error) => error instanceof ApiError
      && error.status === 503
      && error.code === "STOCK_PROOF_CONFIRMATIONS_INVALID",
  );
});

test("holder Stock proof stops before an unconfirmed activation block", async () => {
  __resetStatsCacheForTests();
  const pausedRuntime = proofRuntime();
  pausedRuntime.gatewayPaused = true;
  pausedRuntime.checks.gatewayInitialized = false;
  pausedRuntime.checks.factoryMarket = false;
  const config = {
    ...getServerConfig({
      LOG_CONFIRMATIONS: "12",
      STATS_CACHE_SECONDS: "0",
      ALLOW_BOUNDED_STATS_FALLBACK: "true",
    }),
    officialTokenAddress: ADDRESSES.official,
    gatewayAddress: ADDRESSES.gateway,
    activatedBlock: 100,
  };
  const proof = await loadHolderStockProof(config, {
    runtimeLoader: async () => pausedRuntime,
    clientFactory: () => ({
      getBlockNumber: async () => 110n,
      getLogs: async () => {
        throw new Error("unconfirmed activation range must not be scanned");
      },
    }),
  });

  assert.equal(proof.status, "activation_pending");
  assert.equal(proof.activatedBlock, "100");
  assert.equal(proof.asOfBlock, "99");
  assert.equal(proof.scope, "CURRENT_CANONICAL_GATEWAY_SINCE_ACTIVATION");
});

test("holder Stock proof consumes canonical swaps in transaction log order", async () => {
  __resetStatsCacheForTests();
  const transactionHash = `0x${"dd".repeat(32)}`;
  const config = {
    ...getServerConfig({
      LOG_CONFIRMATIONS: "12",
      STATS_CACHE_SECONDS: "0",
      MEMBER_LOG_CHUNK: "100",
      ALLOW_BOUNDED_STATS_FALLBACK: "true",
    }),
    officialTokenAddress: ADDRESSES.official,
    gatewayAddress: ADDRESSES.gateway,
    activatedBlock: 100,
  };
  const proof = await loadHolderStockProof(config, {
    runtimeLoader: async () => proofRuntime(),
    clientFactory: () => ({
      getBlockNumber: async () => 130n,
      getLogs: async ({ address }) => (
        address.toLowerCase() === ADDRESSES.gateway.toLowerCase()
          ? [
              {
                transactionHash,
                logIndex: 3,
                args: {
                  payer: ADDRESSES.wallet,
                  recipient: ADDRESSES.wallet,
                  projectAmountIn: 99n,
                  stockAmountIn: 1n,
                  projectAmountOut: 10n,
                  stockAmountOut: 5n,
                },
              },
              {
                transactionHash,
                logIndex: 1,
                args: {
                  payer: ADDRESSES.wallet,
                  recipient: ADDRESSES.wallet,
                  projectAmountIn: 99n,
                  stockAmountIn: 1n,
                  projectAmountOut: 10n,
                  stockAmountOut: 5n,
                },
              },
            ]
          : [
              {
                transactionHash,
                logIndex: 2,
                args: {
                  sender: CANONICAL_SWAP_ROUTER,
                  recipient: ADDRESSES.wallet,
                  amount0: 2_000_000n,
                  amount1: -5n,
                },
              },
              {
                transactionHash,
                logIndex: 0,
                args: {
                  sender: CANONICAL_SWAP_ROUTER,
                  recipient: ADDRESSES.wallet,
                  amount0: 1_000_000n,
                  amount1: -5n,
                },
              },
            ]
      ),
      readContract: async ({ address }) => (
        address.toLowerCase() === CANONICAL_USDG.toLowerCase() ? 6 : 18
      ),
    }),
  });

  assert.equal(proof.selfBuyCount, 2);
  assert.equal(proof.uniqueBuyerCount, 1);
  assert.equal(proof.usdgSpent, "3");
  assert.equal(proof.qqqAmountOutRaw, "10");
});

test("holder Stock proof fails closed on missing bindings or an unmatched QQQ settlement", async () => {
  __resetStatsCacheForTests();
  const unconfigured = {
    ...getServerConfig({ STATS_CACHE_SECONDS: "0" }),
    officialTokenAddress: null,
    gatewayAddress: null,
    activatedBlock: 0,
  };
  await assert.rejects(
    loadHolderStockProof(unconfigured, {
      runtimeLoader: async () => ({ status: "NOT_CONFIGURED" }),
    }),
    (error) => error instanceof ApiError
      && error.status === 503
      && error.code === "STOCK_PROOF_RUNTIME_UNVERIFIED",
  );

  const selfBuyHash = `0x${"cc".repeat(32)}`;
  const configured = {
    ...getServerConfig({
      LOG_CONFIRMATIONS: "12",
      STATS_CACHE_SECONDS: "0",
      MEMBER_LOG_CHUNK: "100",
      ALLOW_BOUNDED_STATS_FALLBACK: "true",
    }),
    officialTokenAddress: ADDRESSES.official,
    gatewayAddress: ADDRESSES.gateway,
    activatedBlock: 100,
  };
  await assert.rejects(
    loadHolderStockProof(configured, {
      runtimeLoader: async () => proofRuntime(),
      clientFactory: () => ({
        getBlockNumber: async () => 130n,
        getLogs: async ({ address }) => (
          address.toLowerCase() === ADDRESSES.gateway.toLowerCase()
            ? [{
                transactionHash: selfBuyHash,
                logIndex: 1,
                args: {
                  payer: ADDRESSES.wallet,
                  recipient: ADDRESSES.wallet,
                  projectAmountIn: 99n,
                  stockAmountIn: 1n,
                  projectAmountOut: 10n,
                  stockAmountOut: 10n,
                },
              }]
            : [{
                transactionHash: selfBuyHash,
                logIndex: 0,
                args: {
                  sender: ADDRESSES.official,
                  recipient: ADDRESSES.wallet,
                  amount0: 100n,
                  amount1: -10n,
                },
              }]
        ),
      }),
    }),
    (error) => error instanceof ApiError
      && error.status === 503
      && error.code === "STOCK_PROOF_SWAP_MISMATCH",
  );
});

test("member stats need only canonical Gateway bindings and assign first-seen member numbers", async () => {
  __resetStatsCacheForTests();
  const secondMember = "0x8888888888888888888888888888888888888888";
  const config = {
    ...getServerConfig({
      LOG_CONFIRMATIONS: "0",
      STATS_CACHE_SECONDS: "30",
      MEMBER_LOG_CHUNK: "100",
      ALLOW_BOUNDED_STATS_FALLBACK: "true",
    }),
    gatewayAddress: null,
    activatedBlock: 0,
  };
  let scans = 0;
  const options = {
    runtimeLoader: async () => ({
      ready: false,
      status: "NOT_READY",
      canonical: {
        gatewayAddress: ADDRESSES.gateway,
        activatedBlock: 100,
      },
    }),
    clientFactory: () => ({
      getBlockNumber: async () => 130n,
      getLogs: async () => {
        scans += 1;
        return [
          {
            blockNumber: 102n,
            transactionIndex: 0,
            logIndex: 0,
            args: { recipient: secondMember, stockAmountOut: 1n },
          },
          {
            blockNumber: 101n,
            transactionIndex: 1,
            logIndex: 0,
            args: { recipient: ADDRESSES.wallet, stockAmountOut: 1n },
          },
          {
            blockNumber: 103n,
            transactionIndex: 0,
            logIndex: 0,
            args: { recipient: ADDRESSES.wallet, stockAmountOut: 2n },
          },
        ];
      },
    }),
  };

  const second = await loadMemberCount(config, { ...options, recipient: secondMember });
  assert.equal(second.memberCount, 2);
  assert.equal(second.buyCount, 3);
  assert.equal(second.memberNumber, 2);
  assert.equal(second.recipient.toLowerCase(), secondMember);

  const first = await loadMemberCount(config, { ...options, recipient: ADDRESSES.wallet });
  assert.equal(first.memberNumber, 1);
  assert.equal(scans, 1, "recipient lookups should reuse the same canonical snapshot");

  const missing = await loadMemberCount(config, {
    ...options,
    recipient: ADDRESSES.official,
  });
  assert.equal(missing.memberNumber, null);
  assert.equal(missing.memberCount, 2);
  assert.equal(scans, 1);
});

test("member stats reject invalid recipients and missing canonical Gateway bindings", async () => {
  __resetStatsCacheForTests();
  const config = {
    ...getServerConfig({}),
    gatewayAddress: null,
    activatedBlock: 0,
    statsCacheSeconds: 0,
  };
  await assert.rejects(
    loadMemberCount(config, { recipient: "not-an-address" }),
    (error) => error instanceof ApiError
      && error.status === 400
      && error.code === "INVALID_RECIPIENT",
  );
  await assert.rejects(
    loadMemberCount(config, {
      runtimeLoader: async () => ({ ready: false }),
      clientFactory: () => {
        throw new Error("must not create a client without a canonical Gateway");
      },
    }),
    (error) => error instanceof ApiError
      && error.status === 503
      && error.code === "GATEWAY_NOT_CONFIGURED",
  );
});

test("members API validates recipient queries before scanning the index", async () => {
  __resetRateLimitsForTests();
  const response = mockResponse();
  await membersHandler({
    method: "GET",
    url: "/api/members?recipient=not-an-address",
    headers: {},
    socket: {},
  }, response);
  assert.equal(response.statusCode, 400);
  assert.equal(JSON.parse(response.body).error.code, "INVALID_RECIPIENT");
});

test("holder Stock API exposes a read-only calculation surface", async () => {
  __resetRateLimitsForTests();
  const response = mockResponse();
  await holderStockHandler({
    method: "POST",
    url: "/api/holder-stock",
    headers: {},
    socket: {},
  }, response);
  assert.equal(response.statusCode, 405);
  assert.equal(response.headers.allow, "GET");
  assert.equal(JSON.parse(response.body).error.code, "METHOD_NOT_ALLOWED");
});

test("Vercel handlers enforce trusted geography and expose fail-closed runtime", async () => {
  __resetRateLimitsForTests();
  const eligibilityResponse = mockResponse();
  await eligibilityHandler({
    method: "POST",
    headers: {
      origin: "https://degen-pension.vercel.app",
      "x-vercel-ip-country": "US",
      "x-forwarded-for": "203.0.113.1",
    },
    body: {
      wallet: ADDRESSES.wallet,
      termsAccepted: true,
      notUSPerson: true,
    },
  }, eligibilityResponse);
  assert.equal(eligibilityResponse.statusCode, 403);
  assert.equal(JSON.parse(eligibilityResponse.body).reason, "JURISDICTION_BLOCKED");

  const runtimeResponse = mockResponse();
  await runtimeHandler({
    method: "GET",
    headers: {
      origin: "https://degen-pension.vercel.app",
      "x-forwarded-for": "203.0.113.2",
    },
  }, runtimeResponse);
  const runtime = JSON.parse(runtimeResponse.body);
  assert.equal(runtimeResponse.statusCode, 200);
  assert.equal(runtime.ready, false);
  assert.equal(runtime.status, "NOT_CONFIGURED");
  assert.equal(runtime.checks.statsIndexer, false);
  assert.equal(runtime.checks.distributedRateLimit, false);
  assert.equal(runtime.checks.monitoring, false);
  assert.equal(runtime.checks.independentAudit, false);
  assert.equal(runtime.operations.statsIndexer.healthy, false);
});

test("API handlers keep client errors useful and redact operational 5xx details", async () => {
  __resetRateLimitsForTests();
  const clientHandler = createApiHandler(
    { name: "client-test", methods: ["GET"] },
    async () => {
      throw new ApiError(400, "INVALID_INPUT", "Input is invalid.", { field: "amount" });
    },
  );
  const clientResponse = mockResponse();
  await clientHandler({ method: "GET", headers: {}, socket: {} }, clientResponse);
  assert.deepEqual(JSON.parse(clientResponse.body), {
    ok: false,
    error: {
      code: "INVALID_INPUT",
      message: "Input is invalid.",
      details: { field: "amount" },
    },
  });

  const serverHandler = createApiHandler(
    { name: "server-test", methods: ["GET"] },
    async () => {
      throw new ApiError(503, "ELIGIBILITY_SIGNER_MISMATCH", "Internal signer does not match.", {
        expected: "private operational value",
      });
    },
  );
  const serverResponse = mockResponse();
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    await serverHandler({ method: "GET", headers: {}, socket: {} }, serverResponse);
  } finally {
    console.error = originalConsoleError;
  }
  assert.deepEqual(JSON.parse(serverResponse.body), {
    ok: false,
    error: {
      code: "SERVICE_UNAVAILABLE",
      message: "The service is temporarily unavailable.",
    },
  });
});
