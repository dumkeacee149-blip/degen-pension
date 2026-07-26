import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "vite";

const OFFICIAL_TOKEN = "0x3333333333333333333333333333333333333333";
const GATEWAY = "0x6666666666666666666666666666666666666666";
const RECIPIENT = "0x1111111111111111111111111111111111111111";
const NOW = Date.parse("2026-07-26T04:00:00.000Z");

let vite;
let loadHolderStats;
let loadHolderStockStats;
let loadMemberStats;
let isAbortedRequest;
let holderStatsBinding;
let memberStatsBinding;
let memberCopy;

before(async () => {
  vite = await createServer({
    appType: "custom",
    configFile: false,
    root: process.cwd(),
    logLevel: "error",
    optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true },
  });
  ({ loadHolderStats } = await vite.ssrLoadModule("/src/holderStats.js"));
  ({ loadHolderStockStats } = await vite.ssrLoadModule("/src/holderStockStats.js"));
  ({ loadMemberStats } = await vite.ssrLoadModule("/src/memberStats.js"));
  ({ isAbortedRequest } = await vite.ssrLoadModule("/src/useRuntimeReadiness.js"));
  ({ holderStatsBinding } = await vite.ssrLoadModule("/src/useHolderStats.js"));
  ({ memberStatsBinding } = await vite.ssrLoadModule("/src/useMemberStats.js"));
  ({ memberCopy } = await vite.ssrLoadModule("/src/FlowPage.jsx"));
});

after(async () => {
  await vite?.close();
});

test("holder snapshots distinguish confirmed empty, stale, and unavailable data", async () => {
  const responseFor = (holderCount, checkedAt = NOW) => async () => new Response(
    JSON.stringify({
      holderCount,
      officialTokenAddress: OFFICIAL_TOKEN,
      source: "BLOCKSCOUT_TOKEN_API",
      checkedAt: new Date(checkedAt).toISOString(),
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );

  const empty = await loadHolderStats({
    fetchImpl: responseFor(0),
    nowMs: NOW,
    maxAgeMs: 120_000,
  });
  assert.equal(empty.status, "empty");
  assert.equal(empty.holderCount, 0);
  assert.equal(empty.officialTokenAddress, OFFICIAL_TOKEN);

  const stale = await loadHolderStats({
    officialTokenAddress: OFFICIAL_TOKEN,
    fetchImpl: responseFor(9, NOW - 121_000),
    nowMs: NOW,
    maxAgeMs: 120_000,
  });
  assert.equal(stale.status, "stale");
  assert.equal(stale.holderCount, 9);

  await assert.rejects(
    loadHolderStats({
      officialTokenAddress: OFFICIAL_TOKEN,
      fetchImpl: async () => new Response(
        JSON.stringify({
          holderCount: 0,
          officialTokenAddress: RECIPIENT,
          checkedAt: new Date(NOW).toISOString(),
        }),
        { status: 200 },
      ),
      nowMs: NOW,
    }),
    /canonical official token/i,
  );
});

test("holder Stock calculations require canonical CA bindings and preserve verified zero", async () => {
  const basePayload = {
    schemaVersion: 1,
    status: "empty",
    selfBuyCount: 0,
    uniqueBuyerCount: 0,
    usdgSpentRaw: "0",
    usdgSpent: "0",
    qqqAmountOutRaw: "0",
    qqqAmount: "0",
    approximateUsdValue: "0.00",
    officialTokenAddress: OFFICIAL_TOKEN,
    gatewayAddress: GATEWAY,
    stockTokenAddress: "0xD5f3879160bc7c32ebb4dC785F8a4F505888de68",
    settlementTokenAddress: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
    settlementPoolAddress: "0xEbD78dcfc8a6b3A696f1E191aD1ff321f9579f79",
    activatedBlock: "100",
    asOfBlock: "123",
    source: "CONFIRMED_SELF_SPLITBUY_USDG_QQQ_SWAPS",
    scope: "CURRENT_CANONICAL_GATEWAY_SINCE_ACTIVATION",
    valuationBasis: "USDG_NOMINAL_DOLLAR",
    checkedAt: new Date(NOW).toISOString(),
  };
  const empty = await loadHolderStockStats({
    officialTokenAddress: OFFICIAL_TOKEN,
    gatewayAddress: GATEWAY,
    activatedBlock: 100,
    nowMs: NOW,
    fetchImpl: async () => new Response(JSON.stringify(basePayload), { status: 200 }),
  });
  assert.equal(empty.status, "empty");
  assert.equal(empty.approximateUsdValue, "0.00");
  assert.equal(empty.officialTokenAddress, OFFICIAL_TOKEN.toLowerCase());

  const activationPending = await loadHolderStockStats({
    officialTokenAddress: OFFICIAL_TOKEN,
    gatewayAddress: GATEWAY,
    activatedBlock: 100,
    nowMs: NOW,
    fetchImpl: async () => new Response(JSON.stringify({
      ...basePayload,
      status: "activation_pending",
      asOfBlock: "99",
    }), { status: 200 }),
  });
  assert.equal(activationPending.status, "activation_pending");
  assert.equal(activationPending.asOfBlock, "99");

  const ready = await loadHolderStockStats({
    officialTokenAddress: OFFICIAL_TOKEN,
    gatewayAddress: GATEWAY,
    activatedBlock: 100,
    nowMs: NOW,
    fetchImpl: async () => new Response(JSON.stringify({
      ...basePayload,
      status: "ready",
      selfBuyCount: 2,
      uniqueBuyerCount: 1,
      usdgSpentRaw: "483291000000",
      usdgSpent: "483291",
      qqqAmountOutRaw: "666191293500000000000",
      qqqAmount: "666.1912935",
      approximateUsdValue: "483291.00",
      usdgDecimals: 6,
      qqqDecimals: 18,
    }), { status: 200 }),
  });
  assert.equal(ready.status, "ready");
  assert.equal(ready.selfBuyCount, 2);
  assert.equal(ready.approximateUsdValue, "483291.00");

  await assert.rejects(
    loadHolderStockStats({
      officialTokenAddress: OFFICIAL_TOKEN,
      gatewayAddress: GATEWAY,
      activatedBlock: 100,
      nowMs: NOW,
      fetchImpl: async () => new Response(JSON.stringify({
        ...basePayload,
        officialTokenAddress: RECIPIENT,
      }), { status: 200 }),
    }),
    /canonical official token/i,
  );
  await assert.rejects(
    loadHolderStockStats({
      officialTokenAddress: OFFICIAL_TOKEN,
      gatewayAddress: GATEWAY,
      activatedBlock: 100,
      nowMs: NOW,
      fetchImpl: async () => new Response(JSON.stringify({
        ...basePayload,
        gatewayAddress: RECIPIENT,
      }), { status: 200 }),
    }),
    /canonical Gateway/i,
  );
  await assert.rejects(
    loadHolderStockStats({
      officialTokenAddress: OFFICIAL_TOKEN,
      gatewayAddress: GATEWAY,
      activatedBlock: 100,
      nowMs: NOW,
      fetchImpl: async () => new Response(JSON.stringify({
        ...basePayload,
        scope: "ALL_TIME_ALL_GATEWAYS",
      }), { status: 200 }),
    }),
    /methodology is unsupported/i,
  );
  await assert.rejects(
    loadHolderStockStats({
      officialTokenAddress: OFFICIAL_TOKEN,
      gatewayAddress: GATEWAY,
      activatedBlock: 100,
      nowMs: NOW,
      fetchImpl: async () => new Response(JSON.stringify({
        ...basePayload,
        usdgSpent: "99",
      }), { status: 200 }),
    }),
    /totals do not match/i,
  );
  await assert.rejects(
    loadHolderStockStats({
      officialTokenAddress: OFFICIAL_TOKEN,
      gatewayAddress: GATEWAY,
      activatedBlock: 100,
      nowMs: NOW,
      fetchImpl: async () => new Response(JSON.stringify({
        ...basePayload,
        status: "activation_pending",
        asOfBlock: "100",
      }), { status: 200 }),
    }),
    /status does not match/i,
  );
});

test("holder Stock calculations reject invented totals and mark old proofs stale", async () => {
  const payload = {
    schemaVersion: 1,
    status: "ready",
    selfBuyCount: 1,
    uniqueBuyerCount: 1,
    usdgSpentRaw: "1000000",
    usdgSpent: "1",
    qqqAmountOutRaw: "1000000000000000",
    qqqAmount: "0.001",
    approximateUsdValue: "1.00",
    usdgDecimals: 6,
    qqqDecimals: 18,
    officialTokenAddress: OFFICIAL_TOKEN,
    gatewayAddress: GATEWAY,
    stockTokenAddress: "0xD5f3879160bc7c32ebb4dC785F8a4F505888de68",
    settlementTokenAddress: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
    settlementPoolAddress: "0xEbD78dcfc8a6b3A696f1E191aD1ff321f9579f79",
    activatedBlock: "100",
    asOfBlock: "123",
    source: "CONFIRMED_SELF_SPLITBUY_USDG_QQQ_SWAPS",
    scope: "CURRENT_CANONICAL_GATEWAY_SINCE_ACTIVATION",
    valuationBasis: "USDG_NOMINAL_DOLLAR",
    checkedAt: new Date(NOW - 121_000).toISOString(),
  };
  const stale = await loadHolderStockStats({
    officialTokenAddress: OFFICIAL_TOKEN,
    gatewayAddress: GATEWAY,
    activatedBlock: 100,
    nowMs: NOW,
    maxAgeMs: 120_000,
    fetchImpl: async () => new Response(JSON.stringify(payload), { status: 200 }),
  });
  assert.equal(stale.status, "stale");

  await assert.rejects(
    loadHolderStockStats({
      officialTokenAddress: OFFICIAL_TOKEN,
      gatewayAddress: GATEWAY,
      activatedBlock: 100,
      nowMs: NOW,
      fetchImpl: async () => new Response(JSON.stringify({
        ...payload,
        status: "empty",
        selfBuyCount: 0,
        uniqueBuyerCount: 0,
      }), { status: 200 }),
    }),
    /totals do not match/i,
  );
});

test("member snapshots carry recipient member numbers without inventing missing counts", async () => {
  let requestedUrl = "";
  const found = await loadMemberStats({
    recipient: RECIPIENT,
    nowMs: NOW,
    maxAgeMs: 120_000,
    fetchImpl: async (url) => {
      requestedUrl = url;
      return new Response(JSON.stringify({
        memberCount: 2,
        buyCount: 3,
        memberNumber: 1,
        recipient: RECIPIENT,
        gatewayAddress: GATEWAY,
        asOfBlock: "123",
        source: "CONFIRMED_SPLITBUY_LOGS",
        checkedAt: new Date(NOW).toISOString(),
      }), { status: 200 });
    },
  });
  assert.match(requestedUrl, new RegExp(`recipient=${RECIPIENT}`));
  assert.equal(found.status, "ready");
  assert.equal(found.memberNumber, 1);
  assert.equal(found.gatewayAddress, GATEWAY);

  await assert.rejects(
    loadMemberStats({
      gatewayAddress: GATEWAY,
      nowMs: NOW,
      fetchImpl: async () => new Response(JSON.stringify({
        memberCount: 0,
        gatewayAddress: GATEWAY,
        asOfBlock: "123",
        checkedAt: new Date(NOW).toISOString(),
      }), { status: 200 }),
    }),
    /buy count/i,
  );
});

test("runtime abort classification resolves cleanup cancellations instead of rethrowing", () => {
  const controller = new AbortController();
  controller.abort();
  assert.equal(isAbortedRequest(new Error("cancelled"), controller.signal), true);
  assert.equal(isAbortedRequest({ name: "AbortError" }, new AbortController().signal), true);
  assert.equal(isAbortedRequest(new Error("network"), new AbortController().signal), false);
});

test("public stat bindings do not depend on quote or eligibility readiness", () => {
  const runtime = {
    ready: false,
    checks: { runtime: true, quote: false, eligibility: false },
    canonical: {
      officialTokenAddress: OFFICIAL_TOKEN,
      gatewayAddress: GATEWAY,
    },
  };
  assert.equal(holderStatsBinding(runtime), OFFICIAL_TOKEN);
  assert.equal(memberStatsBinding(runtime), GATEWAY);
});

test("flow member copy never turns an unavailable snapshot into a verified zero", () => {
  assert.deepEqual(memberCopy({ status: "unavailable", memberCount: null }, true), {
    number: "…",
    label: "MEMBER INDEX PENDING",
    line: "WAITING FOR A VERIFIED CANONICAL SNAPSHOT",
  });
  assert.deepEqual(memberCopy({ status: "stale", memberCount: 12 }, true), {
    number: "12",
    label: "LAST VERIFIED · STALE",
    line: "NOT A LIVE COUNT · WAITING FOR A FRESH CANONICAL SNAPSHOT",
  });
  assert.equal(memberCopy({ status: "empty", memberCount: 0 }, true).number, "0");
});
