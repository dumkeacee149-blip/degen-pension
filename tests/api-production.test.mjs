import assert from "node:assert/strict";
import test from "node:test";
import {
  decodeFunctionData,
  encodeFunctionResult,
  recoverTypedDataAddress,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import eligibilityHandler from "../api/eligibility.js";
import membersHandler from "../api/members.js";
import runtimeHandler from "../api/runtime.js";
import {
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
  applySlippage,
  calculateSplit,
  createQuote,
} from "../server/quote.js";
import { analyzeV3Path } from "../server/runtime.js";
import {
  __resetStatsCacheForTests,
  loadHolderCount,
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
};
const TEST_PRIVATE_KEY =
  "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const POLICY_HASH = `0x${"ab".repeat(32)}`;

function v3Path(tokenIn, fee, tokenOut) {
  return `${tokenIn.toLowerCase()}${fee.toString(16).padStart(6, "0")}${tokenOut.slice(2).toLowerCase()}`;
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
  });
  let providerCalls = 0;
  const fetchImpl = async () => {
    providerCalls += 1;
    return new Response(JSON.stringify({
      eligible: true,
      reason: "PROVIDER_ELIGIBLE",
      decisionId: "decision-1",
      expiresAt: new Date(Date.now() + 120_000).toISOString(),
    }), { status: 200, headers: { "content-type": "application/json" } });
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

test("quote uses onchain Quoter outputs, signed eligibility, and full Gateway simulation", async () => {
  const signer = privateKeyToAccount(TEST_PRIVATE_KEY);
  const config = {
    ...getServerConfig({}),
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
    gatewayAddress: ADDRESSES.gateway,
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

test("member stats need only canonical Gateway bindings and assign first-seen member numbers", async () => {
  __resetStatsCacheForTests();
  const secondMember = "0x8888888888888888888888888888888888888888";
  const config = {
    ...getServerConfig({
      LOG_CONFIRMATIONS: "0",
      STATS_CACHE_SECONDS: "30",
      MEMBER_LOG_CHUNK: "100",
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
