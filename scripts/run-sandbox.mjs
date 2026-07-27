import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeFunctionData,
  encodePacked,
  getAddress,
  http,
  keccak256,
  stringToHex,
  toHex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createQuote } from "../server/quote.js";
import { GATEWAY_ABI } from "../server/constants.js";
import { loadMemberCount } from "../server/stats.js";
import {
  decodeBuyNativeCalldata,
  validateQuotePayload,
  waitForTransactionReceipt,
} from "../src/launchRuntime.js";

const PROJECT_ROOT = fileURLToPath(new URL("../", import.meta.url));
const CONTRACTS_ROOT = fileURLToPath(new URL("../contracts/", import.meta.url));
const CHAIN_ID = 4663;
const CONFIRMATIONS = 12;
const GROSS_AMOUNT = 10_000_000_000_000_000n;
const MAX_AMOUNT = 10n * 10n ** 18n;
const POLICY_HASH = keccak256(stringToHex("DEGEN_PENSION_LOCAL_SANDBOX_V1"));

const ADDRESSES = Object.freeze({
  weth: getAddress("0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73"),
  usdg: getAddress("0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168"),
  qqq: getAddress("0xD5f3879160bc7c32ebb4dC785F8a4F505888de68"),
  factory: getAddress("0x1f7d7550B1b028f7571E69A784071F0205FD2EfA"),
  router: getAddress("0xCaf681a66D020601342297493863E78C959E5cb2"),
  quoter: getAddress("0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7"),
  ponsFactory: getAddress("0xA5aAb3F0c6EeadF30Ef1D3Eb997108E976351feB"),
  wethUsdgPool: getAddress("0x52e65B17fB6E5BA00Ed806f37Afcd2DaA50271Ca"),
  usdgQqqPool: getAddress("0xEbD78dcfc8a6b3A696f1E191aD1ff321f9579f79"),
  projectPool: getAddress("0x00000000000000000000000000000000a11ce001"),
});

const ARTIFACTS = Object.freeze({
  mockErc20: "out/MockERC20.sol/MockERC20.json",
  mockWeth: "out/MockWETH.sol/MockWETH.json",
  mockFactory: "out/MockProduction.sol/MockUniswapV3Factory.json",
  mockRouter: "out/MockProduction.sol/MockSwapRouter02.json",
  mockQuoter: "out/MockProduction.sol/MockQuoterV2.json",
  mockPonsFactory: "out/MockProduction.sol/MockPonsLaunchFactory.json",
  mockPonsToken: "out/MockProduction.sol/MockPonsToken.json",
  activator: "out/ProductionMarketActivator.sol/ProductionMarketActivator.json",
});

function runCommand(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} failed (${code}): ${stderr.trim()}`));
    });
  });
}

async function openPort() {
  const server = createServer();
  server.unref();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : null;
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  if (!port) throw new Error("Could not allocate a localhost sandbox port.");
  return port;
}

async function startAnvil() {
  const port = await openPort();
  const rpcUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.env.ANVIL_BIN || "anvil", [
    "--host", "127.0.0.1",
    "--port", String(port),
    "--chain-id", String(CHAIN_ID),
    "--silent",
  ], { cwd: PROJECT_ROOT, stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk; });

  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Anvil exited before startup: ${stderr.trim()}`);
    try {
      const response = await fetch(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
      });
      const payload = await response.json();
      if (payload.result === toHex(CHAIN_ID)) return { child, rpcUrl };
    } catch {
      // The localhost process is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  child.kill("SIGTERM");
  throw new Error("Local Anvil sandbox did not become ready.");
}

async function stopAnvil(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    once(child, "exit"),
    new Promise((resolve) => setTimeout(resolve, 1_500)),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

function makeRpcRequest(rpcUrl) {
  let id = 0;
  return async ({ method, params = [] }) => {
    id += 1;
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    });
    const payload = await response.json();
    if (!response.ok || payload.error || payload.id !== id) {
      throw new Error(payload.error?.message || `Local RPC ${method} failed.`);
    }
    return payload.result;
  };
}

async function loadArtifacts() {
  await runCommand(process.env.FORGE_BIN || "forge", ["build", "--quiet"], CONTRACTS_ROOT);
  const entries = await Promise.all(Object.entries(ARTIFACTS).map(async ([key, relativePath]) => {
    const artifact = JSON.parse(await readFile(new URL(`../contracts/${relativePath}`, import.meta.url), "utf8"));
    return [key, artifact];
  }));
  return Object.fromEntries(entries);
}

async function mineBlocks(rpcRequest, count) {
  for (let index = 0; index < count; index += 1) {
    await rpcRequest({ method: "evm_mine" });
  }
}

async function waitWrite(publicClient, promise) {
  const hash = await promise;
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`Sandbox setup transaction reverted: ${hash}`);
  return receipt;
}

async function installCanonicalMocks({ artifacts, publicClient, walletClient, rpcRequest }) {
  const codeBindings = [
    [ADDRESSES.weth, artifacts.mockWeth.deployedBytecode.object],
    [ADDRESSES.usdg, artifacts.mockErc20.deployedBytecode.object],
    [ADDRESSES.qqq, artifacts.mockErc20.deployedBytecode.object],
    [ADDRESSES.factory, artifacts.mockFactory.deployedBytecode.object],
    [ADDRESSES.router, artifacts.mockRouter.deployedBytecode.object],
    [ADDRESSES.quoter, artifacts.mockQuoter.deployedBytecode.object],
    [ADDRESSES.ponsFactory, artifacts.mockPonsFactory.deployedBytecode.object],
  ];
  for (const [address, code] of codeBindings) {
    await rpcRequest({ method: "anvil_setCode", params: [address, code] });
  }
  for (const pool of [ADDRESSES.wethUsdgPool, ADDRESSES.usdgQqqPool, ADDRESSES.projectPool]) {
    await rpcRequest({ method: "anvil_setCode", params: [pool, "0x60006000f3"] });
  }

  await waitWrite(publicClient, walletClient.writeContract({
    address: ADDRESSES.factory,
    abi: artifacts.mockFactory.abi,
    functionName: "setPool",
    args: [ADDRESSES.weth, ADDRESSES.usdg, 100, ADDRESSES.wethUsdgPool],
  }));
  await waitWrite(publicClient, walletClient.writeContract({
    address: ADDRESSES.factory,
    abi: artifacts.mockFactory.abi,
    functionName: "setPool",
    args: [ADDRESSES.usdg, ADDRESSES.qqq, 3_000, ADDRESSES.usdgQqqPool],
  }));
}

async function deployContract(publicClient, walletClient, artifact, args = []) {
  const hash = await walletClient.deployContract({
    abi: artifact.abi,
    bytecode: artifact.bytecode.object,
    args,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success" || !receipt.contractAddress) {
    throw new Error(`Sandbox deployment reverted: ${hash}`);
  }
  return receipt.contractAddress;
}

function amountStrings({ gross, fee, net, project, stock }) {
  return Object.fromEntries(Object.entries({ gross, fee, net, project, stock }).map(([key, value]) => [key, value.toString()]));
}

export async function runLocalSandbox() {
  const artifacts = await loadArtifacts();
  const { child, rpcUrl } = await startAnvil();
  const rpcRequest = makeRpcRequest(rpcUrl);

  try {
    const chain = defineChain({
      id: CHAIN_ID,
      name: "Robinhood Chain Local Sandbox",
      nativeCurrency: { name: "Sandbox Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [rpcUrl] } },
    });
    const authority = privateKeyToAccount(generatePrivateKey());
    const operator = privateKeyToAccount(generatePrivateKey());
    const buyer = privateKeyToAccount(generatePrivateKey());
    const eligibilityPrivateKey = generatePrivateKey();
    const eligibilitySigner = privateKeyToAccount(eligibilityPrivateKey);
    for (const account of [authority, operator, buyer]) {
      await rpcRequest({ method: "anvil_setBalance", params: [account.address, toHex(100n * 10n ** 18n)] });
    }

    const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
    const authorityWallet = createWalletClient({ account: authority, chain, transport: http(rpcUrl) });
    const operatorWallet = createWalletClient({ account: operator, chain, transport: http(rpcUrl) });
    const buyerWallet = createWalletClient({ account: buyer, chain, transport: http(rpcUrl) });

    await installCanonicalMocks({ artifacts, publicClient, walletClient: authorityWallet, rpcRequest });
    const officialTokenAddress = await deployContract(
      publicClient,
      authorityWallet,
      artifacts.mockPonsToken,
      [ADDRESSES.projectPool],
    );
    await waitWrite(publicClient, authorityWallet.writeContract({
      address: ADDRESSES.factory,
      abi: artifacts.mockFactory.abi,
      functionName: "setPool",
      args: [ADDRESSES.weth, officialTokenAddress, 10_000, ADDRESSES.projectPool],
    }));
    await waitWrite(publicClient, authorityWallet.writeContract({
      address: ADDRESSES.ponsFactory,
      abi: artifacts.mockPonsFactory.abi,
      functionName: "setLaunchedToken",
      args: [officialTokenAddress, ADDRESSES.weth, 10_000, true],
    }));

    const registryAddress = await deployContract(
      publicClient,
      authorityWallet,
      artifacts.activator,
      [authority.address, operator.address, authority.address, eligibilitySigner.address, POLICY_HASH, MAX_AMOUNT],
    );
    await waitWrite(publicClient, authorityWallet.writeContract({
      address: registryAddress,
      abi: artifacts.activator.abi,
      functionName: "authorizeLaunchOperator",
    }));
    await waitWrite(publicClient, operatorWallet.writeContract({
      address: registryAddress,
      abi: artifacts.activator.abi,
      functionName: "activatePonsMarket",
      args: [officialTokenAddress],
    }));

    const [gatewayAddress, projectAdapterAddress, stockAdapterAddress, eligibilityCheckerAddress, activatedBlock] = await Promise.all([
      publicClient.readContract({ address: registryAddress, abi: artifacts.activator.abi, functionName: "currentMarket" }),
      publicClient.readContract({ address: registryAddress, abi: artifacts.activator.abi, functionName: "currentProjectAdapter" }),
      publicClient.readContract({ address: registryAddress, abi: artifacts.activator.abi, functionName: "currentStockAdapter" }),
      publicClient.readContract({ address: registryAddress, abi: artifacts.activator.abi, functionName: "eligibilityChecker" }),
      publicClient.readContract({ address: registryAddress, abi: artifacts.activator.abi, functionName: "activatedBlock" }),
    ]);
    const explicitFeeBps = Number(await publicClient.readContract({
      address: gatewayAddress,
      abi: GATEWAY_ABI,
      functionName: "explicitFeeBps",
    }));
    const projectPath = encodePacked(
      ["address", "uint24", "address"],
      [ADDRESSES.weth, 10_000, officialTokenAddress],
    );
    const stockPath = encodePacked(
      ["address", "uint24", "address", "uint24", "address"],
      [ADDRESSES.weth, 100, ADDRESSES.usdg, 3_000, ADDRESSES.qqq],
    );
    const runtimeExpiresAt = Date.now() + 120_000;
    const runtime = {
      ready: true,
      expiresAt: runtimeExpiresAt,
      gatewayAddress,
      explicitFeeBps,
      routes: { projectPath, stockPath },
      eligibilitySignerAddress: eligibilitySigner.address,
      eligibilityCheckerAddress,
      policyHash: POLICY_HASH,
      canonical: {
        gatewayAddress,
        officialTokenAddress,
        stockTokenAddress: ADDRESSES.qqq,
        activatedBlock: Number(activatedBlock),
        explicitFeeBps,
      },
      limits: {
        minAmountInWei: 100_000_000_000_000n,
        maxAmountInWei: MAX_AMOUNT,
        defaultSlippageBps: 200,
        maxSlippageBps: 500,
        confirmations: CONFIRMATIONS,
      },
      eligibility: {
        signerAddress: eligibilitySigner.address.toLowerCase(),
        checkerAddress: eligibilityCheckerAddress.toLowerCase(),
        policyHash: POLICY_HASH.toLowerCase(),
      },
    };
    const config = {
      vercelEnvironment: "development",
      chainId: CHAIN_ID,
      rpcUrl,
      quoterAddress: ADDRESSES.quoter,
      quoteTtlSeconds: 45,
      eligibilitySignerPrivateKey: eligibilityPrivateKey,
      confirmations: CONFIRMATIONS,
    };
    const localEligibility = async () => ({
      eligible: true,
      reason: "LOCAL_SANDBOX_ELIGIBLE",
      countryCode: "SG",
      expiresAt: new Date(Date.now() + 120_000).toISOString(),
      proof: {
        type: "LOCAL_SANDBOX_PROVIDER_DECISION",
        decisionId: "SANDBOX-ELIGIBILITY-0001",
        simulationOnly: true,
      },
    });
    const quotePayload = await createQuote(config, {
      wallet: buyer.address,
      recipient: buyer.address,
      amountInWei: GROSS_AMOUNT,
      slippageBps: 200,
      termsAccepted: true,
      notUSPerson: true,
      countryCode: "SG",
      runtimeLoader: async () => runtime,
      clientFactory: () => publicClient,
      eligibilityDecider: localEligibility,
    });
    const executableQuote = validateQuotePayload(quotePayload, {
      market: { slippageBps: 200 },
      runtime,
      recipient: buyer.address,
      amountWei: GROSS_AMOUNT,
      chainId: CHAIN_ID,
      slippageBps: 200,
    });

    const transactionHash = await buyerWallet.sendTransaction({
      to: executableQuote.transaction.to,
      data: executableQuote.transaction.data,
      value: BigInt(executableQuote.transaction.value),
      gas: 3_000_000n,
    });
    const included = await publicClient.waitForTransactionReceipt({ hash: transactionHash });
    if (included.status !== "success") throw new Error("The successful sandbox buy unexpectedly reverted.");
    await mineBlocks(rpcRequest, CONFIRMATIONS - 1);
    const confirmedReceipt = await waitForTransactionReceipt({
      rpcRequest,
      hash: transactionHash,
      gatewayAddress,
      wallet: buyer.address,
      transaction: executableQuote.transaction,
      confirmations: CONFIRMATIONS,
      timeoutMs: 10_000,
      pollMs: 20,
    });

    const [projectBalance, stockBalance, gatewayInputBalance] = await Promise.all([
      publicClient.readContract({ address: officialTokenAddress, abi: artifacts.mockPonsToken.abi, functionName: "balanceOf", args: [buyer.address] }),
      publicClient.readContract({ address: ADDRESSES.qqq, abi: artifacts.mockErc20.abi, functionName: "balanceOf", args: [buyer.address] }),
      publicClient.readContract({ address: ADDRESSES.weth, abi: artifacts.mockWeth.abi, functionName: "balanceOf", args: [gatewayAddress] }),
    ]);
    if (
      projectBalance !== BigInt(quotePayload.projectAmountOut)
      || stockBalance !== BigInt(quotePayload.stockAmountOut)
      || gatewayInputBalance !== 0n
    ) {
      throw new Error("Sandbox output balances do not match the independently simulated quote.");
    }

    const decoded = decodeBuyNativeCalldata(executableQuote.transaction.data);
    const failedData = encodeFunctionData({
      abi: GATEWAY_ABI,
      functionName: "buyNative",
      args: [
        decoded.minProjectOut,
        BigInt(quotePayload.stockAmountOut) + 1n,
        buyer.address,
        decoded.deadline,
        decoded.eligibilityDeadline,
        decoded.eligibilitySignature,
      ],
    });
    const failedHash = await buyerWallet.sendTransaction({
      to: gatewayAddress,
      data: failedData,
      value: GROSS_AMOUNT,
      gas: 3_000_000n,
    });
    const failedReceipt = await publicClient.waitForTransactionReceipt({ hash: failedHash });
    const [projectAfterFailure, stockAfterFailure] = await Promise.all([
      publicClient.readContract({ address: officialTokenAddress, abi: artifacts.mockPonsToken.abi, functionName: "balanceOf", args: [buyer.address] }),
      publicClient.readContract({ address: ADDRESSES.qqq, abi: artifacts.mockErc20.abi, functionName: "balanceOf", args: [buyer.address] }),
    ]);
    if (
      failedReceipt.status !== "reverted"
      || failedReceipt.logs.length !== 0
      || projectAfterFailure !== projectBalance
      || stockAfterFailure !== stockBalance
    ) {
      throw new Error("The forced second-leg failure did not roll back the complete sandbox buy.");
    }

    const memberSnapshot = await loadMemberCount({
      vercelEnvironment: "development",
      gatewayAddress,
      officialTokenAddress,
      stockTokenAddress: ADDRESSES.qqq,
      activatedBlock: Number(activatedBlock),
      confirmations: CONFIRMATIONS,
      allowBoundedStatsFallback: true,
      statsCacheSeconds: 0,
      memberMaxScanBlocks: 10_000,
      memberLogChunk: 1_000,
    }, {
      clientFactory: () => publicClient,
      recipient: buyer.address,
    });
    if (memberSnapshot.memberCount !== 1 || memberSnapshot.memberNumber !== 1 || memberSnapshot.buyCount !== 1) {
      throw new Error("Confirmed sandbox SplitBuy did not resolve to member #1.");
    }

    const fee = GROSS_AMOUNT * BigInt(explicitFeeBps) / 10_000n;
    const net = GROSS_AMOUNT - fee;
    const project = net * 9_900n / 10_000n;
    const stock = net - project;
    return {
      mode: "LOCAL_ANVIL_SANDBOX",
      productionReady: false,
      walletConnectionUsed: false,
      realFundsUsed: false,
      externalRpcUsed: false,
      chainId: CHAIN_ID,
      rpcScope: "EPHEMERAL_127_0_0_1_ONLY",
      registryAddress,
      gatewayAddress,
      officialTokenAddress,
      qqqAddress: ADDRESSES.qqq,
      projectAdapterAddress,
      stockAdapterAddress,
      eligibility: {
        decision: "LOCAL_SANDBOX_ELIGIBLE",
        eip712Signer: eligibilitySigner.address,
        onchainChecker: eligibilityCheckerAddress,
      },
      split: {
        explicitFeeBps,
        ...amountStrings({ gross: GROSS_AMOUNT, fee, net, project, stock }),
      },
      quote: {
        source: quotePayload.quoteSource.type,
        ethCallPassed: true,
        projectAmountOut: quotePayload.projectAmountOut,
        stockAmountOut: quotePayload.stockAmountOut,
        minProjectOut: quotePayload.minProjectOut,
        minStockOut: quotePayload.minStockOut,
      },
      transaction: {
        hash: transactionHash,
        localOnly: true,
        status: "CONFIRMED",
        blockNumber: BigInt(confirmedReceipt.blockNumber).toString(),
        confirmations: CONFIRMATIONS,
        splitBuyEvents: 1,
      },
      receipt: {
        id: `SANDBOX-${transactionHash.slice(2, 10).toUpperCase()}`,
        memberNumber: memberSnapshot.memberNumber,
        memberCount: memberSnapshot.memberCount,
        buyCount: memberSnapshot.buyCount,
        asOfBlock: memberSnapshot.asOfBlock,
        onchainProductionReceipt: false,
      },
      rollbackProof: {
        forcedLeg: "QQQ",
        transactionHash: failedHash,
        status: "REVERTED",
        splitBuyEvents: 0,
        balancesRestored: true,
        receiptUnlocked: false,
      },
    };
  } finally {
    await stopAnvil(child);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runLocalSandbox()
    .then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
    .catch((error) => {
      process.stderr.write(`${error?.stack || error}\n`);
      process.exitCode = 1;
    });
}
