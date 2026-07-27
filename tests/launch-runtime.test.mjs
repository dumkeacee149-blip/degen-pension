import assert from "node:assert/strict";
import test from "node:test";
import {
  BUY_NATIVE_SELECTOR,
  SPLIT_BUY_TOPIC,
  decodeBuyNativeCalldata,
  loadRuntimeReadiness,
  parseEthToWei,
  requestEligibility,
  validateQuotePayload,
  waitForTransactionReceipt,
} from "../src/launchRuntime.js";

const GATEWAY = "0x1111111111111111111111111111111111111111";
const TOKEN = "0x2222222222222222222222222222222222222222";
const STOCK = "0x3333333333333333333333333333333333333333";
const WALLET = "0x4444444444444444444444444444444444444444";
const FACTORY = "0x5555555555555555555555555555555555555555";
const INPUT = "0x6666666666666666666666666666666666666666";
const PROJECT_ADAPTER = "0x7777777777777777777777777777777777777777";
const STOCK_ADAPTER = "0x8888888888888888888888888888888888888888";
const CHECKER = "0x9999999999999999999999999999999999999999";
const SIGNER = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const POLICY_HASH = `0x${"ab".repeat(32)}`;
const SIGNATURE = `0x${"cd".repeat(65)}`;
const NOW = Date.parse("2026-07-25T00:00:00Z");

function word(value) {
  return BigInt(value).toString(16).padStart(64, "0");
}

function addressWord(address) {
  return address.slice(2).toLowerCase().padStart(64, "0");
}

function calldata({
  projectMin = 100n,
  stockMin = 2n,
  recipient = WALLET,
  deadline = BigInt(Math.floor((NOW + 60_000) / 1_000)),
  eligibilityDeadline = BigInt(Math.floor((NOW + 90_000) / 1_000)),
  signature = SIGNATURE,
} = {}) {
  const signatureHex = signature.slice(2);
  const paddedSignature = signatureHex.padEnd(Math.ceil(signatureHex.length / 64) * 64, "0");
  return [
    BUY_NATIVE_SELECTOR,
    word(projectMin),
    word(stockMin),
    addressWord(recipient),
    word(deadline),
    word(eligibilityDeadline),
    word(192),
    word(signatureHex.length / 2),
    paddedSignature,
  ].join("");
}

function response(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  };
}

const RECEIPT_VALUE = 10_000n;
const EXPECTED_TRANSACTION = Object.freeze({
  to: GATEWAY,
  data: calldata(),
  value: `0x${RECEIPT_VALUE.toString(16)}`,
});

function splitBuyLog({
  payer = WALLET,
  recipient = WALLET,
  grossAmountIn = RECEIPT_VALUE,
  projectAmountIn = 9_900n,
  stockAmountIn = 100n,
  projectAmountOut = 5_000n,
  stockAmountOut = 2n,
} = {}) {
  return {
    address: GATEWAY,
    topics: [
      SPLIT_BUY_TOPIC,
      `0x${addressWord(payer)}`,
      `0x${addressWord(recipient)}`,
    ],
    data: `0x${[
      grossAmountIn,
      0n,
      grossAmountIn,
      projectAmountIn,
      stockAmountIn,
      projectAmountOut,
      stockAmountOut,
    ].map(word).join("")}`,
  };
}

function successfulReceipt({
  blockNumber = "0x64",
  blockHash = `0x${"ab".repeat(32)}`,
  logs = [splitBuyLog()],
} = {}) {
  return {
    to: GATEWAY,
    status: "0x1",
    blockNumber,
    blockHash,
    logs,
  };
}

function minedTransaction(overrides = {}) {
  return {
    from: WALLET,
    to: GATEWAY,
    input: EXPECTED_TRANSACTION.data,
    value: EXPECTED_TRANSACTION.value,
    ...overrides,
  };
}

const market = {
  bootstrapConfigured: true,
  runtimeStatusEndpoint: "/api/runtime",
  eligibilityEndpoint: "/api/eligibility",
  gatewayAddress: GATEWAY,
  officialTokenAddress: TOKEN,
  stockTokenAddress: STOCK,
  factoryAddress: FACTORY,
  inputTokenAddress: INPUT,
  projectAdapterAddress: PROJECT_ADAPTER,
  stockAdapterAddress: STOCK_ADAPTER,
  activatedBlock: 123,
  explicitFeeBps: 0,
  slippageBps: 100,
  requestTimeoutMs: 500,
  runtimeMaxAgeMs: 120_000,
};
const chain = { chainIdDecimal: 4663 };

test("parses ETH without floating point", () => {
  assert.equal(parseEthToWei("1.000000000000000001"), 1_000_000_000_000_000_001n);
  assert.throws(() => parseEthToWei("0"), /greater than zero/);
  assert.throws(() => parseEthToWei("1.0000000000000000001"), /valid ETH amount/);
});

test("decodes the complete buyNative calldata", () => {
  assert.deepEqual(decodeBuyNativeCalldata(calldata()), {
    selector: BUY_NATIVE_SELECTOR,
    minProjectOut: 100n,
    minStockOut: 2n,
    recipient: WALLET,
    deadline: BigInt(Math.floor((NOW + 60_000) / 1_000)),
    eligibilityDeadline: BigInt(Math.floor((NOW + 90_000) / 1_000)),
    eligibilitySignature: SIGNATURE,
  });
  assert.throws(
    () => decodeBuyNativeCalldata(`0xdeadbeef${calldata().slice(10)}`),
    /approved Gateway V2/,
  );
  assert.throws(() => decodeBuyNativeCalldata(`${calldata()}00`), /canonical ABI encoding/);
});

test("accepts only a matching, live, nonzero-minimum quote", () => {
  const payload = {
    schemaVersion: 1,
    expiresAt: new Date(NOW + 60_000).toISOString(),
    amountInWei: (10n ** 18n).toString(),
    minProjectOut: "100",
    minStockOut: "2",
    projectAmountOut: "120",
    stockAmountOut: "3",
    slippageBps: 100,
    eligibilityProof: {
      validUntil: Math.floor((NOW + 90_000) / 1_000).toString(),
      policyHash: POLICY_HASH,
      signature: SIGNATURE,
      signer: SIGNER,
      checker: CHECKER,
    },
    transaction: {
      to: GATEWAY,
      data: calldata(),
      value: "0xde0b6b3a7640000",
      chainId: 4663,
    },
  };
  const runtime = {
    ready: true,
    expiresAt: NOW + 120_000,
    limits: {
      minAmountInWei: 1n,
      maxAmountInWei: 100n * 10n ** 18n,
      maxSlippageBps: 200,
    },
    eligibility: {
      checkerAddress: CHECKER,
      signerAddress: SIGNER,
      policyHash: POLICY_HASH,
    },
    canonical: {
      gatewayAddress: GATEWAY,
    },
  };

  const validated = validateQuotePayload(payload, {
    market,
    runtime,
    recipient: WALLET,
    amountWei: 10n ** 18n,
    chainId: 4663,
    nowMs: NOW,
  });
  assert.equal(validated.decoded.recipient, WALLET);
  assert.equal(validated.decoded.minStockOut, 2n);

  assert.throws(
    () => validateQuotePayload(
      { ...payload, transaction: { ...payload.transaction, to: TOKEN } },
      { market, runtime, recipient: WALLET, amountWei: 10n ** 18n, chainId: 4663, nowMs: NOW },
    ),
    /official Gateway/,
  );
  assert.throws(
    () => validateQuotePayload(
      { ...payload, transaction: { ...payload.transaction, value: "0x1" } },
      { market, runtime, recipient: WALLET, amountWei: 10n ** 18n, chainId: 4663, nowMs: NOW },
    ),
    /does not match/,
  );
  assert.throws(
    () => validateQuotePayload(
      {
        ...payload,
        transaction: { ...payload.transaction, data: calldata({ stockMin: 0n }) },
        minStockOut: "0",
      },
      { market, runtime, recipient: WALLET, amountWei: 10n ** 18n, chainId: 4663, nowMs: NOW },
    ),
    /both be greater than zero/,
  );
  assert.throws(
    () => validateQuotePayload(
      { ...payload, expiresAt: new Date(NOW - 1).toISOString() },
      { market, runtime, recipient: WALLET, amountWei: 10n ** 18n, chainId: 4663, nowMs: NOW },
    ),
    /expired/,
  );
});

test("RuntimeReady requires runtime, quote, eligibility, canonical bindings, and freshness", async () => {
  const readyPayload = {
    schemaVersion: 1,
    ready: true,
    status: "ready",
    chainId: 4663,
    factoryAddress: FACTORY,
    registryAddress: FACTORY,
    implementationAddress: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    implementationCodeHash: `0x${"12".repeat(32)}`,
    gatewayAddress: GATEWAY,
    officialTokenAddress: TOKEN,
    stockTokenAddress: STOCK,
    inputTokenAddress: INPUT,
    projectAdapterAddress: PROJECT_ADAPTER,
    stockAdapterAddress: STOCK_ADAPTER,
    eligibilityCheckerAddress: CHECKER,
    eligibilitySignerAddress: SIGNER,
    policyHash: POLICY_HASH,
    activatedBlock: 123,
    explicitFeeBps: 0,
    limits: {
      minimumBuyWei: "1000000000000000",
      maximumBuyWei: "100000000000000000000",
      defaultSlippageBps: 100,
      maximumSlippageBps: 200,
      quoteTtlSeconds: 60,
      confirmations: 2,
    },
    checks: {
      rpcChain: true,
      foundationCode: true,
      factoryAuthority: true,
      factoryImplementation: true,
      factoryMarket: true,
      gatewayCode: true,
      gatewayInitialized: true,
      gatewayBindings: true,
      adapterCode: true,
      adapterBindings: true,
      activatedBlock: true,
      stockAssetRegistry: true,
      quoterCode: true,
      quoteRoutes: true,
      eligibilityProvider: true,
      eligibilityChecker: true,
      eligibilitySigner: true,
      policyHash: true,
      statsIndexer: true,
      distributedRateLimit: true,
      monitoring: true,
      independentAudit: true,
    },
    checkedAt: new Date(NOW - 1_000).toISOString(),
    expiresAt: new Date(NOW + 120_000).toISOString(),
  };
  const ready = await loadRuntimeReadiness({
    market,
    chain,
    nowMs: NOW,
    fetchImpl: async () => response(readyPayload),
  });
  assert.equal(ready.ready, true);

  const missingEligibility = await loadRuntimeReadiness({
    market,
    chain,
    nowMs: NOW,
    fetchImpl: async () => response({
      ...readyPayload,
      checks: { ...readyPayload.checks, eligibilityProvider: false },
    }),
  });
  assert.equal(missingEligibility.ready, false);

  const missingStockRegistry = await loadRuntimeReadiness({
    market,
    chain,
    nowMs: NOW,
    fetchImpl: async () => response({
      ...readyPayload,
      checks: { ...readyPayload.checks, stockAssetRegistry: false },
    }),
  });
  assert.equal(missingStockRegistry.ready, false);
  assert.equal(missingStockRegistry.checks.operations, false);

  const missingOperations = await loadRuntimeReadiness({
    market,
    chain,
    nowMs: NOW,
    fetchImpl: async () => response({
      ...readyPayload,
      checks: { ...readyPayload.checks, monitoring: false },
    }),
  });
  assert.equal(missingOperations.ready, false);
  assert.equal(missingOperations.checks.operations, false);

  const missingAudit = await loadRuntimeReadiness({
    market,
    chain,
    nowMs: NOW,
    fetchImpl: async () => response({
      ...readyPayload,
      checks: { ...readyPayload.checks, independentAudit: false },
    }),
  });
  assert.equal(missingAudit.ready, false);
  assert.equal(missingAudit.checks.audit, false);

  const pinnedInactiveManifest = await loadRuntimeReadiness({
    market: {
      ...market,
      gatewayImplementationAddress: readyPayload.implementationAddress,
      gatewayImplementationCodeHash: readyPayload.implementationCodeHash,
      eligibilityCheckerAddress: CHECKER,
      eligibilityPolicyHash: POLICY_HASH,
      releaseManifestRequired: true,
      releaseManifestActive: false,
    },
    chain,
    nowMs: NOW,
    fetchImpl: async () => response(readyPayload),
  });
  assert.equal(pinnedInactiveManifest.ready, false);
  assert.equal(pinnedInactiveManifest.matches.releaseManifestMatches, false);
  assert.equal(pinnedInactiveManifest.canonical, null);

  const pinnedActiveManifest = await loadRuntimeReadiness({
    market: {
      ...market,
      gatewayImplementationAddress: readyPayload.implementationAddress,
      gatewayImplementationCodeHash: readyPayload.implementationCodeHash,
      eligibilityCheckerAddress: CHECKER,
      eligibilityPolicyHash: POLICY_HASH,
      releaseManifestRequired: true,
      releaseManifestActive: true,
    },
    chain,
    nowMs: NOW,
    fetchImpl: async () => response(readyPayload),
  });
  assert.equal(pinnedActiveManifest.ready, true);

  const mismatchedPinnedRegistry = await loadRuntimeReadiness({
    market: {
      ...market,
      factoryAddress: "0xffffffffffffffffffffffffffffffffffffffff",
      gatewayImplementationAddress: readyPayload.implementationAddress,
      gatewayImplementationCodeHash: readyPayload.implementationCodeHash,
      eligibilityCheckerAddress: CHECKER,
      eligibilityPolicyHash: POLICY_HASH,
      releaseManifestRequired: true,
      releaseManifestActive: true,
    },
    chain,
    nowMs: NOW,
    fetchImpl: async () => response(readyPayload),
  });
  assert.equal(mismatchedPinnedRegistry.ready, false);
  assert.equal(mismatchedPinnedRegistry.matches.factoryMatches, false);

  const blockedButDiscovered = await loadRuntimeReadiness({
    market,
    chain,
    nowMs: NOW,
    fetchImpl: async () => response({
      ...readyPayload,
      ready: false,
      status: "NOT_READY",
      checks: { ...readyPayload.checks, eligibilityProvider: false },
    }),
  });
  assert.equal(blockedButDiscovered.ready, false);
  assert.equal(blockedButDiscovered.canonical.officialTokenAddress, TOKEN);
  assert.equal(blockedButDiscovered.canonical.activatedBlock, 123);

  const blockedBeforeManifestReview = await loadRuntimeReadiness({
    market: {
      ...market,
      gatewayImplementationAddress: readyPayload.implementationAddress,
      gatewayImplementationCodeHash: readyPayload.implementationCodeHash,
      eligibilityCheckerAddress: CHECKER,
      eligibilityPolicyHash: POLICY_HASH,
      releaseManifestRequired: true,
      releaseManifestActive: false,
    },
    chain,
    nowMs: NOW,
    fetchImpl: async () => response({
      ...readyPayload,
      ready: false,
      status: "NOT_READY",
      checks: { ...readyPayload.checks, monitoring: false },
    }),
  });
  assert.equal(blockedBeforeManifestReview.ready, false);
  assert.equal(blockedBeforeManifestReview.canonical, null);

  const blockedAfterManifestReview = await loadRuntimeReadiness({
    market: {
      ...market,
      gatewayImplementationAddress: readyPayload.implementationAddress,
      gatewayImplementationCodeHash: readyPayload.implementationCodeHash,
      eligibilityCheckerAddress: CHECKER,
      eligibilityPolicyHash: POLICY_HASH,
      releaseManifestRequired: true,
      releaseManifestActive: true,
    },
    chain,
    nowMs: NOW,
    fetchImpl: async () => response({
      ...readyPayload,
      ready: false,
      status: "NOT_READY",
      checks: { ...readyPayload.checks, monitoring: false },
    }),
  });
  assert.equal(blockedAfterManifestReview.ready, false);
  assert.equal(blockedAfterManifestReview.canonical.gatewayAddress, GATEWAY);

  await assert.rejects(
    () => loadRuntimeReadiness({
      market,
      chain,
      nowMs: NOW,
      fetchImpl: async () => response({
        ...readyPayload,
        checkedAt: new Date(NOW - 121_000).toISOString(),
      }),
    }),
    /stale or expired/,
  );
});

test("eligibility requires a live proof token for eligible wallets", async () => {
  const eligible = await requestEligibility({
    market,
    chain,
    wallet: WALLET,
    termsAccepted: true,
    notUSPerson: true,
    nowMs: NOW,
    fetchImpl: async (_url, init) => {
      assert.deepEqual(JSON.parse(init.body), {
        wallet: WALLET,
        termsAccepted: true,
        notUSPerson: true,
      });
      return response({
        eligible: true,
        reason: "ELIGIBLE",
        countryCode: "SG",
        checkedAt: new Date(NOW).toISOString(),
        expiresAt: new Date(NOW + 60_000).toISOString(),
        proof: {
          type: "DEGEN_PENSION_ELIGIBILITY_V1",
          token: "abcdefghijklmnop.qrstuvwxyzABCDEFG",
          wallet: WALLET,
          chainId: 4663,
          stockTokenAddress: STOCK,
          decisionId: "decision-123",
          issuedAt: new Date(NOW).toISOString(),
          expiresAt: new Date(NOW + 60_000).toISOString(),
        },
      });
    },
  });
  assert.equal(eligible.eligible, true);

  await assert.rejects(
    () => requestEligibility({
      market,
      chain,
      wallet: WALLET,
      termsAccepted: true,
      notUSPerson: true,
      nowMs: NOW,
      fetchImpl: async () => response({
        eligible: true,
        reason: "ELIGIBLE",
        countryCode: "SG",
        checkedAt: new Date(NOW).toISOString(),
        expiresAt: new Date(NOW + 60_000).toISOString(),
        proof: null,
      }),
    }),
    /proof is missing/,
  );
});

test("receipt confirmation waits for the verified confirmation depth", async () => {
  const methods = [];
  let latestBlock = 99n;
  const receipt = successfulReceipt();
  const rpcRequest = async ({ method }) => {
      methods.push(method);
      if (method === "eth_getTransactionReceipt") return receipt;
      if (method === "eth_getTransactionByHash") return minedTransaction();
      if (method === "eth_blockNumber") {
        latestBlock += 1n;
        return `0x${latestBlock.toString(16)}`;
      }
      throw new Error(`Unexpected method ${method}`);
  };

  const confirmed = await waitForTransactionReceipt({
    rpcRequest,
    hash: `0x${"12".repeat(32)}`,
    gatewayAddress: GATEWAY,
    wallet: WALLET,
    transaction: EXPECTED_TRANSACTION,
    confirmations: 2,
    timeoutMs: 1_000,
    pollMs: 1,
  });

  assert.equal(confirmed, receipt);
  assert.equal(methods.filter((method) => method === "eth_getTransactionReceipt").length, 2);
  assert.equal(methods.filter((method) => method === "eth_blockNumber").length, 2);
});

test("receipt confirmation rejects another successful Gateway transaction", async () => {
  await assert.rejects(
    () => waitForTransactionReceipt({
      rpcRequest: async ({ method }) => {
          if (method === "eth_getTransactionReceipt") return successfulReceipt();
          if (method === "eth_getTransactionByHash") {
            return minedTransaction({ input: `${BUY_NATIVE_SELECTOR}${"00".repeat(32)}` });
          }
          throw new Error(`Unexpected method ${method}`);
      },
      hash: `0x${"22".repeat(32)}`,
      gatewayAddress: GATEWAY,
      wallet: WALLET,
      transaction: EXPECTED_TRANSACTION,
      confirmations: 1,
      timeoutMs: 100,
      pollMs: 1,
    }),
    (error) => error?.code === "INVALID_RECEIPT",
  );
});

test("receipt confirmation requires one wallet-bound positive SplitBuy event", async () => {
  const invalidReceipts = [
    successfulReceipt({ logs: [] }),
    successfulReceipt({ logs: [splitBuyLog(), splitBuyLog()] }),
    successfulReceipt({ logs: [splitBuyLog({ recipient: TOKEN })] }),
    successfulReceipt({ logs: [splitBuyLog({ stockAmountOut: 0n })] }),
    successfulReceipt({ logs: [splitBuyLog({ projectAmountIn: 5_000n, stockAmountIn: 5_000n })] }),
    successfulReceipt({ logs: [splitBuyLog({ projectAmountOut: 99n })] }),
    successfulReceipt({ logs: [splitBuyLog({ stockAmountOut: 1n })] }),
  ];
  for (const receipt of invalidReceipts) {
    await assert.rejects(
      () => waitForTransactionReceipt({
        rpcRequest: async ({ method }) => {
            if (method === "eth_getTransactionReceipt") return receipt;
            if (method === "eth_getTransactionByHash") return minedTransaction();
            throw new Error(`Unexpected method ${method}`);
        },
        hash: `0x${"23".repeat(32)}`,
        gatewayAddress: GATEWAY,
        wallet: WALLET,
        transaction: EXPECTED_TRANSACTION,
        confirmations: 1,
        timeoutMs: 100,
        pollMs: 1,
      }),
      (error) => error?.code === "INVALID_RECEIPT",
    );
  }
});

test("receipt confirmation resets when an included transaction is reorganized", async () => {
  const oldReceipt = successfulReceipt();
  const newReceipt = successfulReceipt({
    blockNumber: "0x66",
    blockHash: `0x${"cd".repeat(32)}`,
  });
  const receipts = [oldReceipt, null, newReceipt, newReceipt];
  const latestBlocks = ["0x64", "0x66", "0x67"];
  let receiptIndex = 0;
  let transactionReads = 0;
  const rpcRequest = async ({ method }) => {
      if (method === "eth_getTransactionReceipt") {
        const receipt = receipts[receiptIndex];
        receiptIndex += 1;
        return receipt === undefined ? newReceipt : receipt;
      }
      if (method === "eth_getTransactionByHash") {
        transactionReads += 1;
        return minedTransaction();
      }
      if (method === "eth_blockNumber") return latestBlocks.shift() ?? "0x67";
      throw new Error(`Unexpected method ${method}`);
  };

  const confirmed = await waitForTransactionReceipt({
    rpcRequest,
    hash: `0x${"56".repeat(32)}`,
    gatewayAddress: GATEWAY,
    wallet: WALLET,
    transaction: EXPECTED_TRANSACTION,
    confirmations: 2,
    timeoutMs: 1_000,
    pollMs: 1,
  });

  assert.equal(confirmed.blockHash, newReceipt.blockHash);
  assert.equal(transactionReads, 2);
});

test("reverted transactions never become shareable confirmed receipts", async () => {
  await assert.rejects(
    () => waitForTransactionReceipt({
      rpcRequest: async () => ({
          to: GATEWAY,
          status: "0x0",
          blockNumber: "0x64",
        }),
      hash: `0x${"34".repeat(32)}`,
      gatewayAddress: GATEWAY,
      wallet: WALLET,
      transaction: EXPECTED_TRANSACTION,
      confirmations: 1,
      timeoutMs: 100,
      pollMs: 1,
    }),
    (error) => error?.code === "TRANSACTION_REVERTED",
  );
});

test("receipt confirmation never trusts the wallet provider for chain reads", async () => {
  let walletProviderCalls = 0;
  const confirmed = await waitForTransactionReceipt({
    ethereum: {
      request: async () => {
        walletProviderCalls += 1;
        throw new Error("Wallet provider must not be used for receipt verification");
      },
    },
    rpcRequest: async ({ method }) => {
      if (method === "eth_getTransactionReceipt") return successfulReceipt();
      if (method === "eth_getTransactionByHash") return minedTransaction();
      throw new Error(`Unexpected method ${method}`);
    },
    hash: `0x${"78".repeat(32)}`,
    gatewayAddress: GATEWAY,
    wallet: WALLET,
    transaction: EXPECTED_TRANSACTION,
    confirmations: 1,
    timeoutMs: 100,
    pollMs: 1,
  });

  assert.equal(confirmed.status, "0x1");
  assert.equal(walletProviderCalls, 0);
});

test("public RPC confirmation rejects malformed and oversized responses", async () => {
  const cases = [
    {
      headers: { get: () => null },
      text: async () => "{not-json",
    },
    {
      headers: { get: () => String((512 * 1024) + 1) },
      text: async () => "{}",
    },
  ];

  for (const rpcResponse of cases) {
    await assert.rejects(
      () => waitForTransactionReceipt({
        rpcUrl: "https://rpc.example.test",
        fetchImpl: async () => ({ ok: true, ...rpcResponse }),
        hash: `0x${"89".repeat(32)}`,
        gatewayAddress: GATEWAY,
        wallet: WALLET,
        transaction: EXPECTED_TRANSACTION,
        confirmations: 1,
        timeoutMs: 100,
        pollMs: 1,
      }),
      (error) => error?.code === "RPC_UNAVAILABLE",
    );
  }
});
