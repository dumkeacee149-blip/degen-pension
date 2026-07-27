import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  encodeAbiParameters,
  encodeFunctionData,
  parseAbi,
  parseAbiParameters,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  __resetOperatorProofsForTests,
  auditOperatorControlProof,
  assertCanaryEvidence,
  assertOperatorProofCurrentForPromotion,
  assertReleaseCommitUnchanged,
  assertRegistrySnapshotMatchesManifest,
  assertRuntimeReady,
  CONTROL_WALLET,
  AUDIT_VERCEL_RUNTIME_KEYS,
  createOperatorControlChallenge,
  deployProductionCandidateAtCommit,
  deploymentManifestDigest,
  ELIGIBILITY_POLICY_HASH,
  LEGACY_VERCEL_RUNTIME_KEYS,
  operatorControlMessage,
  prepareInactiveProductionSite,
  promoteProductionCandidateAtCommit,
  readReleaseCodeCommit,
  releaseProductionCandidate,
  runProductionGate,
  validateDeploymentManifest,
  vercelRuntimeSyncCommands,
  vercelRuntimeValues,
  vercelCandidateDeployCommand,
  vercelPromoteCommand,
  VERCEL_TEAM_SLUG,
  verifyOperatorControl,
} from "../scripts/launch-production.mjs";
import * as publicDeployment from "../src/productionDeployment.js";

const { explorerAddress, PRODUCTION_DEPLOYMENT } = publicDeployment;
const TEST_PRIVATE_KEY = `0x${"42".repeat(32)}`;
const CANONICAL_QQQ = "0xD5f3879160bc7c32ebb4dC785F8a4F505888de68";
const CANONICAL_WETH = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73";
const READY_RUNTIME_CHECKS = Object.freeze({
  releaseManifest: true,
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
  quoterCode: true,
  quoteRoutes: true,
  eligibilityProvider: true,
  eligibilityChecker: true,
  eligibilitySigner: true,
  policyHash: true,
  activatedBlock: true,
  statsIndexer: true,
  distributedRateLimit: true,
  monitoring: true,
  independentAudit: true,
  stockAssetRegistry: true,
});
const TEST_GATEWAY_ABI = parseAbi([
  "function buyNative(uint256 minProjectOut,uint256 minStockOut,address recipient,uint256 deadline,uint256 eligibilityDeadline,bytes signature) payable returns (uint256 projectAmountOut,uint256 stockAmountOut)",
]);

async function deploymentManifest(overrides = {}) {
  const source = JSON.parse(await readFile(
    new URL("../contracts/deployments/robinhood-mainnet.json", import.meta.url),
    "utf8",
  ));
  const merged = { ...source, ...overrides };
  if (merged.tradingActive === true && overrides.independentAudit === undefined) {
    merged.independentAudit = {
      status: "verified",
      reportUrl: "https://auditor.example/report.pdf",
      sha256: "ab".repeat(32),
      firm: "Independent Security Lab",
      completedAt: "2026-07-01T00:00:00.000Z",
      scope: {
        manifestId: merged.manifestId,
        protocolVersion: merged.protocolVersion,
        registry: merged.registry,
        gatewayImplementation: merged.gatewayImplementation,
        gatewayImplementationRuntimeCodeHash: merged.gatewayImplementationRuntimeCodeHash,
        sourceCommit: "cd".repeat(20),
      },
    };
  }
  return validateDeploymentManifest(merged);
}

function registrySnapshot(manifest, overrides = {}) {
  return {
    registryAddress: manifest.registry,
    launchOperator: manifest.launchOperator,
    projectAuthority: manifest.projectAuthority,
    guardian: manifest.guardian,
    implementationAddress: manifest.gatewayImplementation,
    implementationCodeHash: manifest.gatewayImplementationRuntimeCodeHash,
    implementationInitialized: true,
    implementationPaused: true,
    eligibilityCheckerAddress: manifest.eligibilityChecker,
    eligibilityAuthority: manifest.eligibilityAuthority,
    eligibilityPolicyHash: manifest.eligibilityPolicyHash,
    policyAdmin: manifest.projectAuthority,
    stockAdapterAddress: manifest.stockAdapter,
    ponsAdapterFactoryAddress: manifest.ponsAdapterFactory,
    maxAmountIn: BigInt(manifest.maxAmountInWei),
    operatorAuthorized: true,
    currentOfficialToken: manifest.currentOfficialToken,
    currentMarket: manifest.currentMarket,
    activatedBlock: manifest.currentActivatedBlock,
    marketReady: manifest.tradingActive,
    ...overrides,
  };
}

function readyOperationalRuntime(manifest, checkedAt = new Date().toISOString()) {
  return {
    checks: { ...READY_RUNTIME_CHECKS },
    operations: {
      environment: "production",
      eligibilityProviderMode: "external",
      eligibilityExternalRequired: true,
      statsIndexer: {
        configured: true,
        healthy: true,
        boundedFallbackEnabled: false,
      },
      distributedRateLimitHealthy: true,
      monitoringHealthy: true,
      independentAuditVerified: true,
      independentAudit: {
        status: "VERIFIED",
        manifestBound: true,
        verified: true,
        reportUrl: manifest.independentAudit.reportUrl,
        sha256: manifest.independentAudit.sha256,
        firm: manifest.independentAudit.firm,
        completedAt: manifest.independentAudit.completedAt,
        scope: { ...manifest.independentAudit.scope },
      },
      stockAssetRegistry: {
        verified: true,
        tokenSymbol: "QQQ",
        status: "ASSET_STATUS_ACTIVE",
        marketWhole: "TRADING_STATUS_TRADABLE",
        marketFractional: "TRADING_STATUS_TRADABLE",
        checkedAt,
      },
    },
  };
}

test("public production record pins the verified foundation and inactive market", () => {
  assert.equal(PRODUCTION_DEPLOYMENT.manifestId, "robinhood-mainnet-production-v2");
  assert.equal(PRODUCTION_DEPLOYMENT.registryAddress, "0x2C2cAF5D52B5e6156f65030b92163B99FccA927e");
  assert.equal(PRODUCTION_DEPLOYMENT.gatewayImplementationAddress, "0xFbB603112215dF60C1108fABa0f089e77bBa6D8F");
  assert.equal(PRODUCTION_DEPLOYMENT.gatewayImplementationCodeHash, `0x${"c54c1db34171e6d63e9e763d2435c0211185736bc977744571c93bf815b87b21"}`);
  assert.equal(PRODUCTION_DEPLOYMENT.projectAuthority, CONTROL_WALLET);
  assert.equal(PRODUCTION_DEPLOYMENT.launchOperator, "0x9F2A37124db1a679A6C429859105ED4220E9d783");
  assert.equal(PRODUCTION_DEPLOYMENT.registrySourceVerified, true);
  assert.equal(PRODUCTION_DEPLOYMENT.gatewayImplementationSourceVerified, true);
  assert.equal(PRODUCTION_DEPLOYMENT.gatewayImplementationLocked, true);
  assert.equal(PRODUCTION_DEPLOYMENT.marketActive, false);
  assert.equal(PRODUCTION_DEPLOYMENT.officialTokenAddress, "");
  assert.equal(PRODUCTION_DEPLOYMENT.activeMarketAddress, "");
  assert.equal(
    PRODUCTION_DEPLOYMENT.legacyV1Foundation.marketFactoryAddress,
    "0xeE5b5Cc20264Eb76C0F462efCabc823cA65E76c9",
  );
  assert.equal(
    explorerAddress(PRODUCTION_DEPLOYMENT.registryAddress),
    `https://robinhoodchain.blockscout.com/address/${PRODUCTION_DEPLOYMENT.registryAddress}`,
  );
});

test("public production module exposes no transaction or wallet controls", () => {
  assert.deepEqual(
    Object.keys(publicDeployment).sort(),
    ["PRODUCTION_DEPLOYMENT", "explorerAddress"],
  );
});

test("homepage omits the holder strip and Stock Token calculation card without deleting canonical proof logic", async () => {
  const [appSource, statsSource] = await Promise.all([
    readFile(new URL("../src/App.jsx", import.meta.url), "utf8"),
    readFile(new URL("../server/stats.js", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(appSource, /483[,_]?291/);
  assert.doesNotMatch(appSource, /TOKEN HOLDERS:/);
  assert.doesNotMatch(appSource, /OFFICIAL 99\/1 SELF-BUY CALCULATION/);
  assert.doesNotMatch(appSource, /holder-stock-(?:snapshot|dialog)/);
  assert.match(statsSource, /CONFIRMED_SELF_SPLITBUY_USDG_QQQ_SWAPS/);
  assert.match(statsSource, /STOCK_PROOF_SWAP_MISMATCH/);
});

test("frontend prelaunch routes and readiness claims fail closed", async () => {
  const [appSource, codeSource, configSource, deploySource, vercelSource] = await Promise.all([
    readFile(new URL("../src/App.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/CodePage.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/config.js", import.meta.url), "utf8"),
    readFile(new URL("../src/DeployPage.jsx", import.meta.url), "utf8"),
    readFile(new URL("../vercel.json", import.meta.url), "utf8"),
  ]);
  assert.match(appSource, /ref=\{buyTriggerRef\}[\s\S]*?href="\/flow"/);
  assert.match(appSource, /window\.location\.assign\("\/flow"\)/);
  assert.match(appSource, /runtimeReady && runtime\.limits/);
  assert.match(appSource, /SHARE AFTER CONFIRMATION/);
  assert.match(appSource, /CHECK RECEIPT AGAIN/);
  assert.match(appSource, /next\.asOfBlock >= receiptConfirmedBlock/);
  assert.match(appSource, /transaction: binding\.transaction/);
  assert.match(appSource, /rpcUrl: CHAIN\.rpcUrls\[0\]/);
  assert.match(appSource, /lazy\(\(\) => import\("\.\/CodePage\.jsx"\)\)/);
  assert.match(appSource, /lazy\(\(\) => import\("\.\/FlowPage\.jsx"\)\)/);
  assert.match(appSource, /lazy\(\(\) => import\("\.\/SandboxPage\.jsx"\)\)/);
  assert.match(codeSource, /CODE REVIEW · PUBLIC IMPLEMENTATION/);
  assert.match(codeSource, /5 \/ 5 PASSED/);
  assert.match(codeSource, /PASS means the code path is implemented/);
  assert.doesNotMatch(codeSource, /useRuntimeReadiness|PRODUCTION_DEPLOYMENT/);
  assert.doesNotMatch(codeSource, /wallet|BLOCKED|NOT READY|PENDING/i);
  assert.doesNotMatch(codeSource, /MarketFactoryV2\.sol/);
  assert.match(configSource, /releaseManifestRequired: !isDevelopment/);
  assert.match(configSource, /PRODUCTION_DEPLOYMENT\.activeMarketAddress/);
  assert.match(configSource, /PRODUCTION_DEPLOYMENT\.gatewayImplementationCodeHash/);
  assert.match(deploySource, /AUTHORITATIVE PRODUCTION V2 RECORD/);
  assert.match(deploySource, /PRODUCTION_DEPLOYMENT\.tradingActive/);
  assert.match(deploySource, /LEGACY V1 · REFERENCE ONLY/);
  const vercel = JSON.parse(vercelSource);
  assert.equal(vercel.redirects, undefined);
  assert.ok(vercel.rewrites.some((route) => route.destination === "/index.html"));
});

test("Vercel synchronization exposes only runtime verification bindings", () => {
  const snapshot = {
    registryAddress: "0x1111111111111111111111111111111111111111",
    projectAuthority: CONTROL_WALLET,
    implementationAddress: "0x2222222222222222222222222222222222222222",
    implementationCodeHash: `0x${"33".repeat(32)}`,
    eligibilityCheckerAddress: "0x4444444444444444444444444444444444444444",
    eligibilityPolicyHash: ELIGIBILITY_POLICY_HASH,
  };
  const values = vercelRuntimeValues(snapshot);
  assert.deepEqual(Object.keys(values), [
    "REGISTRY_ADDRESS",
    "PROJECT_AUTHORITY_ADDRESS",
    "GATEWAY_IMPLEMENTATION_ADDRESS",
    "GATEWAY_IMPLEMENTATION_CODE_HASH",
    "ELIGIBILITY_CHECKER_ADDRESS",
    "ELIGIBILITY_POLICY_HASH",
    "ELIGIBILITY_PROVIDER_MODE",
    "ALLOW_BOUNDED_STATS_FALLBACK",
  ]);
  assert.equal(values.PROJECT_AUTHORITY_ADDRESS, CONTROL_WALLET);
  assert.equal(values.ELIGIBILITY_PROVIDER_MODE, "external");
  assert.equal(values.ALLOW_BOUNDED_STATS_FALLBACK, "false");
  assert.equal("DEPLOYER_ADDRESS" in values, false);
  assert.equal("PRIVATE_KEY" in values, false);
  assert.equal("ELIGIBILITY_PROVIDER_API_KEY" in values, false);

  const commands = vercelRuntimeSyncCommands(snapshot);
  const removes = commands.filter(({ action }) => action === "remove");
  const adds = commands.filter(({ action }) => action === "add");
  assert.deepEqual(
    removes.map(({ name }) => name),
    [...LEGACY_VERCEL_RUNTIME_KEYS, ...AUDIT_VERCEL_RUNTIME_KEYS],
  );
  assert.ok(removes.every(({ args, name }) => (
    JSON.stringify(args) === JSON.stringify(["vercel", "env", "rm", name, "production", "--yes"])
  )));
  assert.deepEqual(adds.map(({ name }) => name), Object.keys(values));
  assert.ok(adds.every(({ args, name, value }) => (
    JSON.stringify(args) === JSON.stringify([
      "vercel", "env", "add", name, "production", "--value", value, "--force", "--yes",
    ])
  )));
  assert.ok(commands.every(({ name }) => ![
    "FACTORY_ADDRESS",
    "GATEWAY_ADDRESS",
    "OFFICIAL_TOKEN_ADDRESS",
    "GATEWAY_ACTIVATED_BLOCK",
  ].includes(name) || removes.some((command) => command.name === name)));
});

test("Vercel audit mirrors are derived from verified manifest evidence", async () => {
  const manifest = await deploymentManifest({
    tradingActive: true,
    currentOfficialToken: "0x7777777777777777777777777777777777777777",
    currentMarket: "0x8888888888888888888888888888888888888888",
    currentActivatedBlock: 123,
  });
  const values = vercelRuntimeValues(registrySnapshot(manifest), manifest);
  assert.equal(values.INDEPENDENT_AUDIT_REPORT_URL, manifest.independentAudit.reportUrl);
  assert.equal(values.INDEPENDENT_AUDIT_SHA256, manifest.independentAudit.sha256);
  assert.equal(values.INDEPENDENT_AUDIT_FIRM, manifest.independentAudit.firm);
  assert.equal(values.INDEPENDENT_AUDIT_COMPLETED_AT, manifest.independentAudit.completedAt);
  assert.equal(
    values.INDEPENDENT_AUDIT_SOURCE_COMMIT,
    manifest.independentAudit.scope.sourceCommit,
  );
});

test("production release stages with skip-domain and promotes only after the canary gate", async () => {
  assert.deepEqual([...vercelCandidateDeployCommand().args], [
    "vercel", "deploy", "--prod", "--skip-domain", "--yes",
  ]);
  assert.deepEqual([...vercelPromoteCommand("https://candidate.vercel.app").args], [
    "vercel", "promote", "https://candidate.vercel.app", "--yes", "--scope", VERCEL_TEAM_SLUG,
  ]);
  assert.notDeepEqual([...vercelCandidateDeployCommand().args], [
    "vercel", "deploy", "--prod", "--yes",
  ]);

  const codeCommit = "65".repeat(20);
  const order = [];
  const release = await releaseProductionCandidate({
    manifest: { manifestId: "test" },
    operatorControlProof: { codeCommit },
    gateArguments: { ca: "test" },
    codeCommitLoader: async () => codeCommit,
    candidateDeployImpl: async () => {
      order.push("candidate --prod --skip-domain");
      return { codeCommit, candidateUrl: "https://candidate.vercel.app" };
    },
    gateImpl: async ({ siteUrl }) => {
      assert.equal(siteUrl, "https://candidate.vercel.app");
      order.push("runtime", "eligibility", "quote", "eth_call", "canary");
      return { status: "GO" };
    },
    finalProofGuardImpl: async () => { order.push("final proof+commit"); },
    promoteImpl: async () => { order.push("promote"); },
  });
  assert.deepEqual(order, [
    "candidate --prod --skip-domain",
    "runtime",
    "eligibility",
    "quote",
    "eth_call",
    "canary",
    "final proof+commit",
    "promote",
  ]);
  assert.equal(release.candidateDeploymentUrl, "https://candidate.vercel.app");

  let promotions = 0;
  await assert.rejects(
    releaseProductionCandidate({
      manifest: { manifestId: "test" },
      operatorControlProof: { codeCommit },
      gateArguments: {},
      codeCommitLoader: async () => codeCommit,
      candidateDeployImpl: async () => ({
        codeCommit,
        candidateUrl: "https://candidate.vercel.app",
      }),
      gateImpl: async () => { throw new Error("CANARY_FAILED · test"); },
      finalProofGuardImpl: async () => {},
      promoteImpl: async () => { promotions += 1; },
    }),
    /CANARY_FAILED/,
  );
  assert.equal(promotions, 0);

  for (const gateArtifact of [{ status: "NO_GO" }, undefined]) {
    let finalGuards = 0;
    promotions = 0;
    await assert.rejects(
      releaseProductionCandidate({
        manifest: { manifestId: "test" },
        operatorControlProof: { codeCommit },
        gateArguments: {},
        codeCommitLoader: async () => codeCommit,
        candidateDeployImpl: async () => ({
          codeCommit,
          candidateUrl: "https://candidate.vercel.app",
        }),
        gateImpl: async () => gateArtifact,
        finalProofGuardImpl: async () => { finalGuards += 1; },
        promoteImpl: async () => { promotions += 1; },
      }),
      /RELEASE_GATE_NOT_GO/,
    );
    assert.equal(finalGuards, 0);
    assert.equal(promotions, 0);
  }
});

test("the checked-in deployment manifest is the sole, internally consistent stack record", async () => {
  const manifest = await deploymentManifest();
  assert.equal(manifest.manifestId, "robinhood-mainnet-production-v2");
  assert.equal(manifest.registry, "0x2C2cAF5D52B5e6156f65030b92163B99FccA927e");
  assert.equal(manifest.launchOperator, "0x9F2A37124db1a679A6C429859105ED4220E9d783");
  assert.equal(manifest.projectAuthority, CONTROL_WALLET);
  assert.notEqual(manifest.launchOperator, manifest.projectAuthority);
  assert.equal(manifest.tradingActive, false);
  assert.deepEqual(manifest.independentAudit, {
    status: "not-ready",
    reportUrl: null,
    sha256: null,
    firm: null,
    completedAt: null,
    scope: null,
  });
  assert.equal(manifest.currentActivatedBlock, 0);
  assert.match(deploymentManifestDigest(manifest), /^[a-f0-9]{64}$/);
  assert.doesNotThrow(() => assertRegistrySnapshotMatchesManifest(registrySnapshot(manifest), manifest));
  assert.throws(
    () => assertRegistrySnapshotMatchesManifest(
      registrySnapshot(manifest, { launchOperator: CONTROL_WALLET }),
      manifest,
    ),
    /DEPLOYMENT_MANIFEST_MISMATCH.*launchOperator/,
  );
  assert.notEqual(
    deploymentManifestDigest(manifest),
    deploymentManifestDigest({
      ...manifest,
      independentAudit: { ...manifest.independentAudit, status: "tampered" },
    }),
    "operator/release digest must bind audit evidence",
  );
});

test("prepare mode refuses an active manifest before Vercel sync or deployment", async () => {
  const ca = "0x7777777777777777777777777777777777777777";
  const gateway = "0x8888888888888888888888888888888888888888";
  const activeManifest = await deploymentManifest({
    tradingActive: true,
    currentOfficialToken: ca,
    currentMarket: gateway,
    currentActivatedBlock: 123,
  });
  const activeSnapshot = registrySnapshot(activeManifest);
  const codeCommit = "67".repeat(20);
  let syncs = 0;
  let candidates = 0;
  let promotions = 0;
  await assert.rejects(
    prepareInactiveProductionSite({
      manifest: activeManifest,
      snapshot: activeSnapshot,
      codeCommit,
      codeCommitLoader: async () => codeCommit,
      syncImpl: async () => { syncs += 1; },
      candidateDeployImpl: async () => {
        candidates += 1;
        return { codeCommit, candidateUrl: "https://candidate.vercel.app" };
      },
      promoteImpl: async () => { promotions += 1; },
    }),
    /PREPARE_ACTIVE_MARKET_FORBIDDEN/,
  );
  assert.equal(syncs, 0);
  assert.equal(candidates, 0);
  assert.equal(promotions, 0);

  const inactiveManifest = await deploymentManifest();
  const prepared = await prepareInactiveProductionSite({
    manifest: inactiveManifest,
    snapshot: registrySnapshot(inactiveManifest),
    codeCommit,
    codeCommitLoader: async () => codeCommit,
    syncImpl: async () => { syncs += 1; },
    candidateDeployImpl: async () => {
      candidates += 1;
      return { codeCommit, candidateUrl: "https://candidate.vercel.app" };
    },
    promoteImpl: async () => { promotions += 1; },
  });
  assert.equal(prepared.status, "PREPARED");
  assert.equal(syncs, 1);
  assert.equal(candidates, 1);
  assert.equal(promotions, 1);

  const auditedInactiveManifest = validateDeploymentManifest({
    ...inactiveManifest,
    independentAudit: {
      status: "verified",
      reportUrl: "https://auditor.example/report.pdf",
      sha256: "ab".repeat(32),
      firm: "Independent Security Lab",
      completedAt: "2026-07-01T00:00:00.000Z",
      scope: {
        manifestId: inactiveManifest.manifestId,
        protocolVersion: inactiveManifest.protocolVersion,
        registry: inactiveManifest.registry,
        gatewayImplementation: inactiveManifest.gatewayImplementation,
        gatewayImplementationRuntimeCodeHash:
          inactiveManifest.gatewayImplementationRuntimeCodeHash,
        sourceCommit: "cd".repeat(20),
      },
    },
  });
  const auditedPrepared = await prepareInactiveProductionSite({
    manifest: auditedInactiveManifest,
    snapshot: registrySnapshot(auditedInactiveManifest),
    codeCommit,
    codeCommitLoader: async () => codeCommit,
    syncImpl: async (_snapshot, syncedManifest) => {
      syncs += 1;
      assert.equal(syncedManifest.independentAudit.status, "verified");
    },
    candidateDeployImpl: async () => {
      candidates += 1;
      return { codeCommit, candidateUrl: "https://candidate-audited.vercel.app" };
    },
    promoteImpl: async () => { promotions += 1; },
  });
  assert.equal(auditedPrepared.status, "PREPARED");
  assert.equal(syncs, 2);
  assert.equal(candidates, 2);
  assert.equal(promotions, 2);
});

test("operator control proof is fresh, fully bound, auditable and single-use per process", async () => {
  __resetOperatorProofsForTests();
  const account = privateKeyToAccount(TEST_PRIVATE_KEY);
  const manifest = await deploymentManifest({ launchOperator: account.address });
  const codeCommit = "12".repeat(20);
  const nowSeconds = 2_000_000_000;
  const proof = createOperatorControlChallenge(manifest, {
    codeCommit,
    nowSeconds,
    randomBytesImpl: () => Buffer.alloc(32, 0xab),
  });
  const message = operatorControlMessage(manifest, proof);
  assert.match(message, new RegExp(`issuedAt:${nowSeconds}`));
  assert.match(message, new RegExp(`expiresAt:${nowSeconds + 300}`));
  assert.match(message, new RegExp(`challenge:0x${"ab".repeat(32)}`));
  assert.match(message, new RegExp(`manifestSha256:${deploymentManifestDigest(manifest)}`));
  assert.match(message, new RegExp(`codeCommit:${codeCommit}`));
  const signature = await account.signMessage({ message });
  const verified = await verifyOperatorControl(manifest, {
    proof,
    signature,
    codeCommit,
    nowSeconds: nowSeconds + 1,
  });
  assert.equal(verified.recoveredOperator, account.address);
  assert.equal(verified.issuedAt, nowSeconds);
  assert.equal(verified.expiresAt, nowSeconds + 300);
  assert.equal(verified.verifiedAt, nowSeconds + 1);
  assert.equal((await auditOperatorControlProof(manifest, verified, { codeCommit })).challenge, proof.challenge);
  await assert.rejects(
    verifyOperatorControl(manifest, {
      proof,
      signature,
      codeCommit,
      nowSeconds: nowSeconds + 2,
    }),
    /OPERATOR_PROOF_REPLAYED/,
  );
  await assert.rejects(
    auditOperatorControlProof(manifest, {
      ...verified,
      verifiedAt: proof.expiresAt + 1,
    }, { codeCommit }),
    /OPERATOR_PROOF_TIME_INVALID/,
  );

  const expired = createOperatorControlChallenge(manifest, {
    codeCommit,
    nowSeconds: nowSeconds - 301,
    randomBytesImpl: () => Buffer.alloc(32, 0xcd),
  });
  await assert.rejects(
    verifyOperatorControl(manifest, {
      proof: expired,
      signature: await account.signMessage({ message: operatorControlMessage(manifest, expired) }),
      codeCommit,
      nowSeconds,
    }),
    /OPERATOR_PROOF_EXPIRED/,
  );

  const future = createOperatorControlChallenge(manifest, {
    codeCommit,
    nowSeconds: nowSeconds + 60,
    randomBytesImpl: () => Buffer.alloc(32, 0xef),
  });
  await assert.rejects(
    verifyOperatorControl(manifest, {
      proof: future,
      signature: await account.signMessage({ message: operatorControlMessage(manifest, future) }),
      codeCommit,
      nowSeconds,
    }),
    /OPERATOR_PROOF_FROM_FUTURE/,
  );

  const wrongCommitProof = createOperatorControlChallenge(manifest, {
    codeCommit,
    nowSeconds,
    randomBytesImpl: () => Buffer.alloc(32, 0x11),
  });
  await assert.rejects(
    verifyOperatorControl(manifest, {
      proof: wrongCommitProof,
      signature: await account.signMessage({ message: operatorControlMessage(manifest, wrongCommitProof) }),
      codeCommit: "34".repeat(20),
      nowSeconds,
    }),
    /OPERATOR_PROOF_BINDING_MISMATCH/,
  );

  const wrongSignerProof = createOperatorControlChallenge(manifest, {
    codeCommit,
    nowSeconds,
    randomBytesImpl: () => Buffer.alloc(32, 0x22),
  });
  const wrongSigner = privateKeyToAccount(`0x${"24".repeat(32)}`);
  await assert.rejects(
    verifyOperatorControl(manifest, {
      proof: wrongSignerProof,
      signature: await wrongSigner.signMessage({ message: operatorControlMessage(manifest, wrongSignerProof) }),
      codeCommit,
      nowSeconds,
    }),
    /OPERATOR_PROOF_MISMATCH/,
  );
});

test("release commit binding rejects a dirty worktree", async () => {
  const commit = "78".repeat(20);
  const cleanRunner = async (_command, args) => (
    args[0] === "rev-parse"
      ? { code: 0, stdout: `${commit}\n`, stderr: "" }
      : { code: 0, stdout: "", stderr: "" }
  );
  assert.equal(await readReleaseCodeCommit({ runCaptureImpl: cleanRunner }), commit);
  const dirtyRunner = async (_command, args) => (
    args[0] === "rev-parse"
      ? { code: 0, stdout: `${commit}\n`, stderr: "" }
      : { code: 0, stdout: " M scripts/launch-production.mjs\n", stderr: "" }
  );
  await assert.rejects(
    readReleaseCodeCommit({ runCaptureImpl: dirtyRunner }),
    /RELEASE_WORKTREE_DIRTY/,
  );

  let revisionReads = 0;
  const movingHeadRunner = async (_command, args) => {
    if (args[0] !== "rev-parse") return { code: 0, stdout: "", stderr: "" };
    revisionReads += 1;
    return {
      code: 0,
      stdout: `${revisionReads === 1 ? commit : "90".repeat(20)}\n`,
      stderr: "",
    };
  };
  await assert.rejects(
    readReleaseCodeCommit({ runCaptureImpl: movingHeadRunner }),
    /RELEASE_COMMIT_CHANGED/,
  );

  assert.equal(
    await assertReleaseCommitUnchanged(commit, { codeCommitLoader: async () => commit }),
    commit,
  );
  await assert.rejects(
    assertReleaseCommitUnchanged(commit, {
      codeCommitLoader: async () => "91".repeat(20),
    }),
    /RELEASE_COMMIT_CHANGED/,
  );

  let deployments = 0;
  await assert.rejects(
    deployProductionCandidateAtCommit(commit, {
      codeCommitLoader: async () => "92".repeat(20),
      runCaptureImpl: async () => {
        deployments += 1;
        return { code: 0, stdout: "https://candidate.vercel.app\n", stderr: "" };
      },
    }),
    /RELEASE_COMMIT_CHANGED/,
  );
  assert.equal(deployments, 0);
  const candidate = await deployProductionCandidateAtCommit(commit, {
    codeCommitLoader: async () => commit,
    runCaptureImpl: async () => {
      deployments += 1;
      return { code: 0, stdout: "https://candidate.vercel.app\n", stderr: "" };
    },
  });
  assert.equal(candidate.codeCommit, commit);
  assert.equal(candidate.candidateUrl, "https://candidate.vercel.app");
  assert.equal(deployments, 1);

  const noisyCandidate = await deployProductionCandidateAtCommit(commit, {
    codeCommitLoader: async () => commit,
    runCaptureImpl: async () => ({
      code: 0,
      stdout: "",
      stderr: "Retrieving project…\nProduction: https://candidate-noisy.vercel.app [35s]\n",
    }),
  });
  assert.equal(noisyCandidate.candidateUrl, "https://candidate-noisy.vercel.app");
  const currentCliCandidate = await deployProductionCandidateAtCommit(commit, {
    codeCommitLoader: async () => commit,
    runCaptureImpl: async () => ({
      code: 0,
      stdout: "",
      stderr: [
        "Production: https://immutable-candidate.vercel.app [33s]",
        "Aliased: https://moving-project-alias.vercel.app [33s]",
        '{"status":"ok","deployment":{"url":"https://immutable-candidate.vercel.app"}}',
      ].join("\n"),
    }),
  });
  assert.equal(currentCliCandidate.candidateUrl, "https://immutable-candidate.vercel.app");
  await assert.rejects(
    deployProductionCandidateAtCommit(commit, {
      codeCommitLoader: async () => commit,
      runCaptureImpl: async () => ({
        code: 0,
        stdout: "https://candidate-a.vercel.app\n",
        stderr: "https://candidate-b.vercel.app\n",
      }),
    }),
    /multiple deployment URLs/,
  );

  let promotions = 0;
  await assert.rejects(
    promoteProductionCandidateAtCommit(candidate.candidateUrl, commit, {
      codeCommitLoader: async () => "94".repeat(20),
      runImpl: async () => { promotions += 1; },
    }),
    /RELEASE_COMMIT_CHANGED/,
  );
  assert.equal(promotions, 0);
});

test("runtime readiness requires the complete fresh V2 contract and operational proof", async () => {
  const ca = "0x7777777777777777777777777777777777777777";
  const gateway = "0x8888888888888888888888888888888888888888";
  const manifest = await deploymentManifest({
    tradingActive: true,
    currentOfficialToken: ca,
    currentMarket: gateway,
    currentActivatedBlock: 123,
  });
  const snapshot = registrySnapshot(manifest);
  const checkedAt = new Date().toISOString();
  const operational = readyOperationalRuntime(manifest, checkedAt);
  const ready = {
    schemaVersion: 1,
    ready: true,
    status: "READY",
    chainId: 4663,
    protocolVersion: manifest.protocolVersion,
    registryAddress: manifest.registry,
    factoryAddress: manifest.registry,
    projectAuthorityAddress: manifest.projectAuthority,
    officialTokenAddress: ca,
    gatewayAddress: gateway,
    implementationAddress: manifest.gatewayImplementation,
    implementationCodeHash: manifest.gatewayImplementationRuntimeCodeHash,
    eligibilityCheckerAddress: manifest.eligibilityChecker,
    eligibilitySignerAddress: manifest.eligibilityAuthority,
    policyHash: manifest.eligibilityPolicyHash,
    stockAdapterAddress: manifest.stockAdapter,
    stockTokenAddress: CANONICAL_QQQ,
    inputTokenAddress: CANONICAL_WETH,
    activatedBlock: 123,
    gatewayCodeHash: `0x${"66".repeat(32)}`,
    marketRegistered: true,
    gatewayInitializedOnchain: true,
    gatewayPaused: false,
    explicitFeeBps: 0,
    limits: { confirmations: 12 },
    checkedAt,
    expiresAt: new Date(Date.now() + 30_000).toISOString(),
    checks: operational.checks,
    operations: operational.operations,
    releaseManifest: {
      required: true,
      manifestId: manifest.manifestId,
      tradingActive: true,
      bound: true,
    },
  };
  assert.equal(assertRuntimeReady(ready, { ca, snapshot, manifest }), ready);
  assert.throws(
    () => assertRuntimeReady({ ...ready, schemaVersion: 2 }, { ca, snapshot, manifest }),
    /RUNTIME_SCHEMA_MISMATCH/,
  );
  assert.throws(
    () => assertRuntimeReady({
      ...ready,
      releaseManifest: { ...ready.releaseManifest, bound: false },
    }, { ca, snapshot, manifest }),
    /RUNTIME_NOT_READY.*releaseManifest/,
  );
  const { releaseManifest: _releaseManifest, ...checksWithoutManifest } = ready.checks;
  assert.throws(
    () => assertRuntimeReady({ ...ready, checks: checksWithoutManifest }, { ca, snapshot, manifest }),
    /RUNTIME_NOT_READY.*releaseManifest/,
  );
  assert.throws(
    () => assertRuntimeReady({
      ...ready,
      ready: false,
      status: "NOT_READY",
      checks: { ...ready.checks, statsIndexer: false },
    }, { ca, snapshot, manifest }),
    /RUNTIME_NOT_READY.*statsIndexer/,
  );
  assert.throws(
    () => assertRuntimeReady({
      ...ready,
      ready: false,
      status: "NOT_READY",
      checks: { ...ready.checks, independentAudit: false },
      operations: { ...ready.operations, independentAuditVerified: false },
    }, { ca, snapshot, manifest }),
    /RUNTIME_NOT_READY.*independentAudit/,
  );
  assert.throws(
    () => assertRuntimeReady({
      ...ready,
      operations: {
        ...ready.operations,
        independentAudit: {
          ...ready.operations.independentAudit,
          reportUrl: "https://attacker.example/self-report.pdf",
          sha256: "ef".repeat(32),
        },
      },
    }, { ca, snapshot, manifest }),
    /RUNTIME_NOT_READY.*productionOperations/,
    "a READY boolean cannot replace manifest-bound public audit evidence",
  );
  const { gatewayBindings: _gatewayBindings, ...incompleteCoreChecks } = ready.checks;
  assert.throws(
    () => assertRuntimeReady({ ...ready, checks: incompleteCoreChecks }, { ca, snapshot, manifest }),
    /RUNTIME_NOT_READY.*gatewayBindings/,
  );
  const { stockAssetRegistry: _removed, ...legacyChecks } = ready.checks;
  assert.throws(
    () => assertRuntimeReady({ ...ready, checks: legacyChecks }, { ca, snapshot, manifest }),
    /RUNTIME_NOT_READY.*stockAssetRegistry/,
  );
  assert.throws(
    () => assertRuntimeReady({
      ...ready,
      stockAdapterAddress: "0x9999999999999999999999999999999999999999",
    }, { ca, snapshot, manifest }),
    /RUNTIME_BINDING_MISMATCH.*stock adapter/,
  );
  assert.throws(
    () => assertRuntimeReady({
      ...ready,
      implementationCodeHash: `0x${"99".repeat(32)}`,
    }, { ca, snapshot, manifest }),
    /RUNTIME_BINDING_MISMATCH.*implementation code hash/,
  );
  assert.throws(
    () => assertRuntimeReady({
      ...ready,
      checkedAt: new Date(Date.now() - 120_000).toISOString(),
    }, { ca, snapshot, manifest }),
    /RUNTIME_STALE/,
  );
  for (const confirmations of [0, 101]) {
    assert.throws(
      () => assertRuntimeReady({
        ...ready,
        limits: { ...ready.limits, confirmations },
      }, { ca, snapshot, manifest }),
      /RUNTIME_LIMITS_INVALID/,
    );
  }
  assert.throws(
    () => assertRuntimeReady({
      ...ready,
      operations: {
        ...ready.operations,
        stockAssetRegistry: {
          ...ready.operations.stockAssetRegistry,
          marketFractional: "TRADING_STATUS_HALTED",
        },
      },
    }, { ca, snapshot, manifest }),
    /RUNTIME_NOT_READY.*productionOperations/,
  );
});

test("canary evidence must bind payer, Gateway, value, both outputs and confirmations", () => {
  const wallet = "0x7777777777777777777777777777777777777777";
  const gateway = "0x8888888888888888888888888888888888888888";
  const evidence = {
    transaction: {
      to: gateway,
      from: wallet,
      value: 100_000_000_000_000n,
      blockNumber: 100n,
    },
    receipt: { status: "success", blockNumber: 100n },
    event: {
      payer: wallet,
      recipient: wallet,
      grossAmountIn: 100_000_000_000_000n,
      projectAmountIn: 99_000_000_000_000n,
      stockAmountIn: 1_000_000_000_000n,
      projectAmountOut: 99n,
      stockAmountOut: 1n,
    },
    callRecipient: wallet,
    latestBlock: 111n,
    gateway,
    probeWallet: wallet,
    activatedBlock: 90,
    minimumConfirmations: 12,
  };
  assert.deepEqual(assertCanaryEvidence(evidence), {
    amountInWei: "100000000000000",
    blockNumber: 100,
    confirmations: 12,
  });
  assert.throws(
    () => assertCanaryEvidence({
      ...evidence,
      event: { ...evidence.event, stockAmountOut: 0n },
    }),
    /CANARY_OUTPUT_MISMATCH/,
  );
  assert.throws(
    () => assertCanaryEvidence({ ...evidence, latestBlock: 110n }),
    /CANARY_UNCONFIRMED/,
  );
  assert.throws(
    () => assertCanaryEvidence({ ...evidence, activatedBlock: 101 }),
    /CANARY_BLOCK_MISMATCH/,
  );
  assert.throws(
    () => assertCanaryEvidence({
      ...evidence,
      transaction: { ...evidence.transaction, value: 10_000_000_000_000_001n },
      event: { ...evidence.event, grossAmountIn: 10_000_000_000_000_001n },
    }),
    /CANARY_OUTPUT_MISMATCH/,
  );
  assert.throws(
    () => assertCanaryEvidence({
      ...evidence,
      latestBlock: 10_100n,
      maximumConfirmations: 10_000,
    }),
    /CANARY_STALE/,
  );
});

test("production gate requires READY, eligibility, quote, independent eth_call and canary", async () => {
  __resetOperatorProofsForTests();
  const operatorAccount = privateKeyToAccount(TEST_PRIVATE_KEY);
  const ca = "0x7777777777777777777777777777777777777777";
  const gateway = "0x8888888888888888888888888888888888888888";
  const wallet = "0x9999999999999999999999999999999999999999";
  const manifest = await deploymentManifest({
    launchOperator: operatorAccount.address,
    tradingActive: true,
    currentOfficialToken: ca,
    currentMarket: gateway,
    currentActivatedBlock: 123,
  });
  const snapshot = registrySnapshot(manifest);
  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  const deadline = BigInt(Math.floor(Date.parse(expiresAt) / 1_000));
  const eligibilityDeadline = deadline - 5n;
  const signature = `0x${"11".repeat(65)}`;
  const eligibilityCheckerAddress = manifest.eligibilityChecker;
  const eligibilitySignerAddress = manifest.eligibilityAuthority;
  const policyHash = manifest.eligibilityPolicyHash;
  const projectPath = "0x010203";
  const stockPath = "0x040506";
  const operational = readyOperationalRuntime(manifest);
  const codeCommit = "56".repeat(20);
  let proofByte = 1;
  const freshOperatorProof = async () => {
    const nowSeconds = Math.floor(Date.now() / 1_000);
    const proof = createOperatorControlChallenge(manifest, {
      codeCommit,
      nowSeconds,
      randomBytesImpl: () => Buffer.alloc(32, proofByte++),
    });
    const signature = await operatorAccount.signMessage({
      message: operatorControlMessage(manifest, proof),
    });
    return verifyOperatorControl(manifest, { proof, signature, codeCommit, nowSeconds });
  };
  const runtime = {
    schemaVersion: 1,
    ready: true,
    status: "READY",
    chainId: 4663,
    protocolVersion: manifest.protocolVersion,
    registryAddress: manifest.registry,
    factoryAddress: manifest.registry,
    projectAuthorityAddress: manifest.projectAuthority,
    officialTokenAddress: ca,
    gatewayAddress: gateway,
    implementationAddress: manifest.gatewayImplementation,
    activatedBlock: 123,
    checkedAt: new Date().toISOString(),
    expiresAt,
    checks: operational.checks,
    operations: operational.operations,
    releaseManifest: {
      required: true,
      manifestId: manifest.manifestId,
      tradingActive: true,
      bound: true,
    },
    limits: { defaultSlippageBps: 200, confirmations: 12 },
    eligibilityCheckerAddress,
    eligibilitySignerAddress,
    policyHash,
    routes: { projectPath, stockPath },
    gatewayCodeHash: `0x${"33".repeat(32)}`,
    implementationCodeHash: manifest.gatewayImplementationRuntimeCodeHash,
    projectAdapterAddress: "0x1111111111111111111111111111111111111111",
    stockAdapterAddress: manifest.stockAdapter,
    stockTokenAddress: CANONICAL_QQQ,
    inputTokenAddress: CANONICAL_WETH,
    marketRegistered: true,
    gatewayInitializedOnchain: true,
    gatewayPaused: false,
    explicitFeeBps: 0,
  };
  const quote = {
    schemaVersion: 1,
    expiresAt,
    amountInWei: "100000000000000",
    minProjectOut: "90",
    minStockOut: "9",
    projectAmountOut: "100",
    stockAmountOut: "10",
    eligibilityProof: {
      validUntil: Number(eligibilityDeadline),
      policyHash,
      signature,
      signer: eligibilitySignerAddress,
      checker: eligibilityCheckerAddress,
      providerDecision: { decisionId: "test", wallet },
    },
    typedPayload: {
      domain: {
        chainId: 4663,
        verifyingContract: eligibilityCheckerAddress,
      },
      primaryType: "Eligibility",
      message: {
        market: gateway,
        payer: wallet,
        recipient: wallet,
        validUntil: eligibilityDeadline.toString(),
        policyHash,
      },
    },
    transaction: {
      to: gateway,
      data: encodeFunctionData({
        abi: TEST_GATEWAY_ABI,
        functionName: "buyNative",
        args: [90n, 9n, wallet, deadline, eligibilityDeadline, signature],
      }),
      value: "0x5af3107a4000",
      chainId: 4663,
    },
    quoteSource: {
      type: "ONCHAIN_QUOTER_V2_AND_GATEWAY_ETH_CALL",
      projectPath,
      stockPath,
      simulatedAtBlock: "124",
    },
  };
  const responses = [
    runtime,
    { eligible: true, expiresAt, proof: { token: "proof", wallet } },
    quote,
  ];
  let requestCount = 0;
  const fetchImpl = async () => new Response(JSON.stringify(responses[requestCount++]), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
  let ethCallCount = 0;
  const publicClient = {
    call: async () => {
      ethCallCount += 1;
      return {
        data: encodeAbiParameters(parseAbiParameters("uint256,uint256"), [100n, 10n]),
      };
    },
  };
  let canaryCount = 0;
  const operatorControlProof = await freshOperatorProof();
  const result = await runProductionGate({
    ca,
    snapshot,
    manifest,
    operatorControlProof,
    probeWallet: wallet,
    canaryTransactionHash: `0x${"ab".repeat(32)}`,
    siteUrl: "https://example.test",
    fetchImpl,
    publicClient,
    codeCommitLoader: async () => codeCommit,
    canaryVerifier: async () => {
      canaryCount += 1;
      return {
        amountInWei: "100000000000000",
        blockNumber: 124,
        confirmations: 12,
      };
    },
  });
  assert.equal(result.status, "GO");
  assert.equal(requestCount, 3);
  assert.equal(ethCallCount, 1);
  assert.equal(canaryCount, 1);
  assert.equal(result.canaryAmountInWei, "100000000000000");
  assert.equal(result.canaryBlockNumber, 124);
  assert.equal(result.manifestId, manifest.manifestId);
  assert.equal(result.gatewayCodeHash, runtime.gatewayCodeHash);
  assert.equal(result.operations.independentAuditVerified, true);
  assert.deepEqual(result.independentAudit, runtime.operations.independentAudit);
  assert.equal(result.codeCommit, codeCommit);
  assert.equal(result.operatorControlProof.challenge, operatorControlProof.challenge);
  assert.equal((await assertOperatorProofCurrentForPromotion(
    manifest,
    operatorControlProof,
    { codeCommitLoader: async () => codeCommit },
  )).challenge, operatorControlProof.challenge);
  await assert.rejects(
    assertOperatorProofCurrentForPromotion(manifest, operatorControlProof, {
      codeCommitLoader: async () => "95".repeat(20),
    }),
    /RELEASE_COMMIT_CHANGED/,
  );

  await assert.rejects(
    runProductionGate({
      ca,
      snapshot,
      manifest,
      operatorControlProof,
      probeWallet: wallet,
      canaryTransactionHash: `0x${"ab".repeat(32)}`,
      siteUrl: "https://example.test",
      fetchImpl,
      publicClient,
      codeCommitLoader: async () => codeCommit,
      canaryVerifier: async () => ({
        amountInWei: "100000000000000",
        blockNumber: 124,
        confirmations: 12,
      }),
    }),
    /OPERATOR_PROOF_REPLAYED/,
  );

  requestCount = 0;
  await assert.rejects(
    runProductionGate({
      ca,
      snapshot,
      manifest,
      operatorControlProof: await freshOperatorProof(),
      probeWallet: wallet,
      canaryTransactionHash: `0x${"ab".repeat(32)}`,
      siteUrl: "https://example.test",
      fetchImpl,
      publicClient,
      codeCommitLoader: async () => "93".repeat(20),
      canaryVerifier: async () => ({
        amountInWei: "100000000000000",
        blockNumber: 124,
        confirmations: 12,
      }),
    }),
    /RELEASE_COMMIT_CHANGED/,
  );
  assert.equal(requestCount, 0);

  requestCount = 0;
  ethCallCount = 0;
  canaryCount = 0;
  const blockedFetch = async () => new Response(JSON.stringify({
    ...runtime,
    ready: false,
    status: "NOT_READY",
    checks: { ...runtime.checks, monitoring: false },
    operations: { ...runtime.operations, monitoringHealthy: false },
  }), { status: 200, headers: { "content-type": "application/json" } });
  await assert.rejects(
    runProductionGate({
      ca,
      snapshot,
      manifest,
      operatorControlProof: await freshOperatorProof(),
      probeWallet: wallet,
      canaryTransactionHash: `0x${"ab".repeat(32)}`,
      siteUrl: "https://example.test",
      fetchImpl: blockedFetch,
      publicClient,
      codeCommitLoader: async () => codeCommit,
      canaryVerifier: async () => {
        canaryCount += 1;
        return {
          amountInWei: "100000000000000",
          blockNumber: 124,
          confirmations: 12,
        };
      },
    }),
    /RUNTIME_NOT_READY.*monitoring/,
  );
  assert.equal(ethCallCount, 0);
  assert.equal(canaryCount, 0);

  requestCount = 0;
  const mismatchedQuote = {
    ...quote,
    transaction: {
      ...quote.transaction,
      data: encodeFunctionData({
        abi: TEST_GATEWAY_ABI,
        functionName: "buyNative",
        args: [
          90n,
          9n,
          "0x6666666666666666666666666666666666666666",
          deadline,
          eligibilityDeadline,
          signature,
        ],
      }),
    },
  };
  const mismatchResponses = [
    runtime,
    { eligible: true, expiresAt, proof: { token: "proof", wallet } },
    mismatchedQuote,
  ];
  const mismatchFetch = async () => new Response(
    JSON.stringify(mismatchResponses[requestCount++]),
    { status: 200, headers: { "content-type": "application/json" } },
  );
  await assert.rejects(
    runProductionGate({
      ca,
      snapshot,
      manifest,
      operatorControlProof: await freshOperatorProof(),
      probeWallet: wallet,
      canaryTransactionHash: `0x${"ab".repeat(32)}`,
      siteUrl: "https://example.test",
      fetchImpl: mismatchFetch,
      publicClient,
      codeCommitLoader: async () => codeCommit,
      canaryVerifier: async () => {
        canaryCount += 1;
        return {
          amountInWei: "100000000000000",
          blockNumber: 124,
          confirmations: 12,
        };
      },
    }),
    /QUOTE_CALLDATA_MISMATCH/,
  );
  assert.equal(ethCallCount, 0);
  assert.equal(canaryCount, 0);
});

test("launch script has no obsolete deploy console or false DONE path", async () => {
  const source = await readFile(new URL("../scripts/launch-production.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(
    source,
    /startLocalAdmin|production-registry\.json|DONE ·|LAUNCH_CONTROL_NONCE|LAUNCH_OPERATOR_PROOF/,
  );
  assert.match(source, /contracts\/deployments\/robinhood-mainnet\.json/);
  assert.match(source, /OPERATOR_PROOF_EXPIRED/);
  assert.match(source, /OPERATOR_PROOF_FROM_FUTURE/);
  assert.match(source, /OPERATOR_PROOF_REPLAYED/);
  assert.match(source, /stockAssetRegistry/);
  assert.match(source, /releaseManifest/);
  assert.match(source, /RUNTIME_NOT_READY/);
  assert.match(source, /ETH_CALL_FAILED/);
  assert.match(source, /CANARY_FAILED/);
  assert.match(source, /--skip-domain/);
  assert.match(source, /"vercel", "promote"/);
  assert.doesNotMatch(source, /"vercel", "deploy", "--prod", "--yes"/);
});
