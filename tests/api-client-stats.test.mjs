import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "vite";

const OFFICIAL_TOKEN = "0x3333333333333333333333333333333333333333";
const GATEWAY = "0x6666666666666666666666666666666666666666";
const RECIPIENT = "0x1111111111111111111111111111111111111111";
const NOW = Date.parse("2026-07-26T04:00:00.000Z");

let vite;
let loadHolderStats;
let loadMemberStats;
let isAbortedRequest;
let holderStatsBinding;
let memberStatsBinding;

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
  ({ loadMemberStats } = await vite.ssrLoadModule("/src/memberStats.js"));
  ({ isAbortedRequest } = await vite.ssrLoadModule("/src/useRuntimeReadiness.js"));
  ({ holderStatsBinding } = await vite.ssrLoadModule("/src/useHolderStats.js"));
  ({ memberStatsBinding } = await vite.ssrLoadModule("/src/useMemberStats.js"));
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
