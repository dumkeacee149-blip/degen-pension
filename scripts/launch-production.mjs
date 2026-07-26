import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import process from "node:process";
import {
  createPublicClient,
  formatEther,
  getAddress,
  http,
  isAddress,
  isAddressEqual,
  keccak256,
  parseAbi,
  zeroAddress,
} from "viem";

export const CONTROL_WALLET = "0x1373910FB6A73b640CdFBd980a776ED88f924247";
export const ELIGIBILITY_AUTHORITY = "0xE1f58F712f7A98D37D82CaD9F039e2c9b0f0b367";
export const ELIGIBILITY_POLICY_HASH =
  "0xb4367ebc10997be2f01f45b58197b507e9637ee66570eaf9b329cd3455b834cf";

const PROJECT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LOCAL_STATE_DIR = resolve(PROJECT_DIR, ".launch-local");
const LOCAL_STATE_FILE = resolve(LOCAL_STATE_DIR, "production-registry.json");
const RPC_URL = "https://rpc.mainnet.chain.robinhood.com";
const SITE_URL = "https://degen-pension.vercel.app";
const PONS_FACTORY = "0xA5aAb3F0c6EeadF30Ef1D3Eb997108E976351feB";
const WETH = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73";
const V3_FACTORY = "0x1f7d7550B1b028f7571E69A784071F0205FD2EfA";
const PONS_POOL_FEE = 10_000;
const LOCAL_ADMIN_PORT = 4177;
const LOCAL_CALLBACK_PORT = 4178;
const MIN_PREPARE_BALANCE_WEI = 1_000_000_000_000_000n;
const MIN_LAUNCH_BALANCE_WEI = 600_000_000_000_000n;

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

function pause(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
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

function stateFingerprint(snapshot) {
  const values = vercelRuntimeValues(snapshot);
  return createHash("sha256").update(JSON.stringify(values)).digest("hex");
}

export function vercelRuntimeValues(snapshot) {
  return Object.freeze({
    REGISTRY_ADDRESS: snapshot.registryAddress,
    PROJECT_AUTHORITY_ADDRESS: CONTROL_WALLET,
    GATEWAY_IMPLEMENTATION_ADDRESS: snapshot.implementationAddress,
    GATEWAY_IMPLEMENTATION_CODE_HASH: snapshot.implementationCodeHash,
    ELIGIBILITY_CHECKER_ADDRESS: snapshot.eligibilityCheckerAddress,
    ELIGIBILITY_POLICY_HASH: snapshot.eligibilityPolicyHash,
  });
}

async function loadLocalState() {
  try {
    const parsed = JSON.parse(await readFile(LOCAL_STATE_FILE, "utf8"));
    if (parsed?.schemaVersion !== 1 || !isAddress(parsed.registryAddress)) {
      throw new Error("Local Registry state is malformed.");
    }
    return parsed;
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function saveLocalState(snapshot, extra = {}) {
  const state = {
    schemaVersion: 1,
    chainId: 4663,
    ...snapshot,
    ...extra,
    savedAt: new Date().toISOString(),
  };
  await mkdir(LOCAL_STATE_DIR, { recursive: true, mode: 0o700 });
  await writeFile(LOCAL_STATE_FILE, `${JSON.stringify(state, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  return state;
}

async function contractCode(address, label) {
  const code = await client.getBytecode({ address });
  if (!code || code === "0x") throw new Error(`${label} has no contract code.`);
  return code;
}

export async function readAndValidateRegistry(registryAddress) {
  const normalizedRegistry = getAddress(registryAddress);
  await contractCode(normalizedRegistry, "Registry");
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
    currentMarket,
    currentOfficialToken,
    activatedBlock,
    marketReady,
  ] = await Promise.all([
    client.readContract({ address: normalizedRegistry, abi: registryAbi, functionName: "operatorAuthorized" }),
    client.readContract({ address: normalizedRegistry, abi: registryAbi, functionName: "launchOperator" }),
    client.readContract({ address: normalizedRegistry, abi: registryAbi, functionName: "projectAuthority" }),
    client.readContract({ address: normalizedRegistry, abi: registryAbi, functionName: "guardian" }),
    client.readContract({ address: normalizedRegistry, abi: registryAbi, functionName: "implementation" }),
    client.readContract({ address: normalizedRegistry, abi: registryAbi, functionName: "eligibilityChecker" }),
    client.readContract({ address: normalizedRegistry, abi: registryAbi, functionName: "stockAdapter" }),
    client.readContract({ address: normalizedRegistry, abi: registryAbi, functionName: "ponsAdapterFactory" }),
    client.readContract({ address: normalizedRegistry, abi: registryAbi, functionName: "maxAmountIn" }),
    client.readContract({ address: normalizedRegistry, abi: registryAbi, functionName: "currentMarket" }),
    client.readContract({ address: normalizedRegistry, abi: registryAbi, functionName: "currentOfficialToken" }),
    client.readContract({ address: normalizedRegistry, abi: registryAbi, functionName: "currentActivatedBlock" }),
    client.readContract({ address: normalizedRegistry, abi: registryAbi, functionName: "marketReady" }),
  ]);

  if (!same(launchOperator, CONTROL_WALLET)) throw new Error("Registry launch operator is not the replacement wallet.");
  if (!same(projectAuthority, CONTROL_WALLET)) throw new Error("Registry project authority is not the replacement wallet.");
  if (!same(guardian, CONTROL_WALLET)) throw new Error("Registry guardian is not the replacement wallet.");
  if (maxAmountIn !== 10n * 10n ** 18n) throw new Error("Registry maximum input is not the fixed 10 ETH limit.");

  const [implementationCode] = await Promise.all([
    contractCode(implementationAddress, "Gateway implementation"),
    contractCode(eligibilityCheckerAddress, "Eligibility checker"),
    contractCode(stockAdapterAddress, "QQQ adapter"),
    contractCode(ponsAdapterFactoryAddress, "Pons adapter factory"),
  ]);
  const [
    implementationInitialized,
    implementationPaused,
    eligibilityAuthority,
    policyAdmin,
    eligibilityPolicyHash,
  ] = await Promise.all([
    client.readContract({ address: implementationAddress, abi: implementationAbi, functionName: "initialized" }),
    client.readContract({ address: implementationAddress, abi: implementationAbi, functionName: "paused" }),
    client.readContract({ address: eligibilityCheckerAddress, abi: checkerAbi, functionName: "eligibilityAuthority" }),
    client.readContract({ address: eligibilityCheckerAddress, abi: checkerAbi, functionName: "policyAdmin" }),
    client.readContract({ address: eligibilityCheckerAddress, abi: checkerAbi, functionName: "policyHash" }),
  ]);
  if (implementationInitialized !== true || implementationPaused !== true) {
    throw new Error("Gateway implementation is not permanently initialized and paused.");
  }
  if (!same(eligibilityAuthority, ELIGIBILITY_AUTHORITY)) {
    throw new Error("Eligibility signer does not match the production service.");
  }
  if (!same(policyAdmin, CONTROL_WALLET)) throw new Error("Eligibility policy admin is not the replacement wallet.");
  if (eligibilityPolicyHash.toLowerCase() !== ELIGIBILITY_POLICY_HASH) {
    throw new Error("Eligibility policy hash does not match production.");
  }

  return {
    registryAddress: normalizedRegistry,
    launchOperator: getAddress(launchOperator),
    projectAuthority: getAddress(projectAuthority),
    guardian: getAddress(guardian),
    implementationAddress: getAddress(implementationAddress),
    implementationCodeHash: keccak256(implementationCode),
    eligibilityCheckerAddress: getAddress(eligibilityCheckerAddress),
    eligibilityPolicyHash: eligibilityPolicyHash.toLowerCase(),
    stockAdapterAddress: getAddress(stockAdapterAddress),
    ponsAdapterFactoryAddress: getAddress(ponsAdapterFactoryAddress),
    operatorAuthorized,
    currentMarket: same(currentMarket, zeroAddress) ? null : getAddress(currentMarket),
    currentOfficialToken: same(currentOfficialToken, zeroAddress) ? null : getAddress(currentOfficialToken),
    activatedBlock: Number(activatedBlock),
    marketReady,
  };
}

async function controlBalance() {
  return client.getBalance({ address: CONTROL_WALLET });
}

async function requireControlBalance(minimumWei, label) {
  const balance = await controlBalance();
  console.log(`CONTROL WALLET GAS: ${formatEther(balance)} ETH`);
  if (balance < minimumWei) {
    throw new Error(
      `${label} needs more gas. Top up ${CONTROL_WALLET} to at least 0.005 ETH before continuing.`,
    );
  }
}

export function createLocalControlServer(token) {
  const events = new Map();
  const waiters = new Map();
  const allowedEvents = new Set(["registry", "authorized", "activated"]);
  const emit = (event, payload) => {
    events.set(event, payload);
    const pending = waiters.get(event) || [];
    waiters.delete(event);
    for (const resolvePromise of pending) resolvePromise(payload);
  };
  const server = createServer(async (request, response) => {
    const origin = String(request.headers.origin || "");
    const allowedOrigin = `http://127.0.0.1:${LOCAL_ADMIN_PORT}`;
    response.setHeader("access-control-allow-origin", allowedOrigin);
    response.setHeader("access-control-allow-methods", "POST, OPTIONS");
    response.setHeader("access-control-allow-headers", "content-type");
    response.setHeader("access-control-allow-private-network", "true");
    response.setHeader("vary", "Origin");
    if (request.method === "OPTIONS") {
      response.statusCode = origin === allowedOrigin ? 204 : 403;
      return response.end();
    }
    const url = new URL(request.url || "/", `http://127.0.0.1:${LOCAL_CALLBACK_PORT}`);
    if (
      request.method !== "POST"
      || url.pathname !== "/state"
      || url.searchParams.get("token") !== token
      || origin !== allowedOrigin
    ) {
      response.statusCode = 403;
      return response.end();
    }
    let raw = "";
    for await (const chunk of request) {
      raw += chunk;
      if (Buffer.byteLength(raw) > 8_192) {
        response.statusCode = 413;
        return response.end();
      }
    }
    try {
      const body = JSON.parse(raw);
      if (!allowedEvents.has(body?.event) || !body.payload || typeof body.payload !== "object") {
        throw new Error("Invalid local event.");
      }
      emit(body.event, body.payload);
      response.statusCode = 204;
      return response.end();
    } catch {
      response.statusCode = 400;
      return response.end();
    }
  });

  const listen = () => new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(LOCAL_CALLBACK_PORT, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolvePromise();
    });
  });
  const waitFor = (event, timeoutMs = 20 * 60_000) => {
    if (events.has(event)) return Promise.resolve(events.get(event));
    return new Promise((resolvePromise, reject) => {
      const timeout = setTimeout(() => {
        const pending = waiters.get(event) || [];
        waiters.set(event, pending.filter((candidate) => candidate !== onEvent));
        reject(new Error(`Timed out waiting for local ${event} confirmation.`));
      }, timeoutMs);
      const onEvent = (payload) => {
        clearTimeout(timeout);
        resolvePromise(payload);
      };
      waiters.set(event, [...(waiters.get(event) || []), onEvent]);
    });
  };
  const close = () => new Promise((resolvePromise) => {
    server.closeAllConnections?.();
    server.close(() => resolvePromise());
  });
  return { listen, waitFor, close };
}

async function startLocalAdmin({ registryAddress = "", officialToken = "" } = {}) {
  const token = randomBytes(24).toString("hex");
  const control = createLocalControlServer(token);
  await control.listen();
  const vite = spawn("npx", [
    "vite",
    "--host", "127.0.0.1",
    "--port", String(LOCAL_ADMIN_PORT),
    "--strictPort",
  ], {
    cwd: PROJECT_DIR,
    stdio: "ignore",
    env: { ...process.env, VITE_ENABLE_LOCAL_DEPLOY_PAGE: "true" },
  });
  let earlyExit = null;
  vite.once("exit", (code) => { earlyExit = code; });
  try {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      if (earlyExit !== null) throw new Error(`Local admin page failed to start (${earlyExit}).`);
      try {
        const response = await fetch(`http://127.0.0.1:${LOCAL_ADMIN_PORT}/deploy`, {
          signal: AbortSignal.timeout(1_000),
        });
        if (response.ok) {
          const query = new URLSearchParams({
            adminToken: token,
            callbackPort: String(LOCAL_CALLBACK_PORT),
          });
          if (registryAddress) query.set("registry", registryAddress);
          if (officialToken) query.set("ca", officialToken);
          return {
            vite,
            control,
            url: `http://127.0.0.1:${LOCAL_ADMIN_PORT}/deploy?${query}`,
          };
        }
      } catch {
        // Vite is still starting.
      }
      await pause(250);
    }
    throw new Error("Local admin page did not become ready within 10 seconds.");
  } catch (error) {
    vite.kill("SIGTERM");
    await control.close();
    throw error;
  }
}

async function closeLocalAdmin(admin) {
  if (!admin) return;
  admin.vite.kill("SIGTERM");
  await admin.control.close();
}

async function waitForAuthorization(registryAddress, timeoutMs = 20 * 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const authorized = await client.readContract({
      address: registryAddress,
      abi: registryAbi,
      functionName: "operatorAuthorized",
    });
    if (authorized === true) return;
    process.stdout.write(".");
    await pause(2_500);
  }
  throw new Error("Timed out waiting for operator authorization.");
}

async function syncVercelRuntime(snapshot, savedState = {}) {
  const fingerprint = stateFingerprint(snapshot);
  if (savedState.vercelRuntimeFingerprint === fingerprint) {
    console.log("PASS · Vercel Registry bindings are already synchronized.");
    return savedState;
  }
  console.log("\nSynchronizing private Vercel runtime bindings:");
  for (const [name, value] of Object.entries(vercelRuntimeValues(snapshot))) {
    console.log(`  ${name}`);
    await run("npx", [
      "vercel",
      "env",
      "add",
      name,
      "production",
      "--value",
      value,
      "--force",
      "--yes",
    ]);
  }
  return saveLocalState(snapshot, { vercelRuntimeFingerprint: fingerprint });
}

async function deployProductionSite() {
  await run("npx", ["vercel", "deploy", "--prod", "--yes"]);
}

async function prepareProduction() {
  console.log("\nPREPARE MODE · NEW PRIVATE CONTROL STACK\n");
  await requireControlBalance(MIN_PREPARE_BALANCE_WEI, "Registry deployment and authorization");
  let savedState = await loadLocalState();
  let snapshot = null;
  if (savedState) snapshot = await readAndValidateRegistry(savedState.registryAddress);

  if (!snapshot || !snapshot.operatorAuthorized) {
    const admin = await startLocalAdmin({ registryAddress: snapshot?.registryAddress || "" });
    try {
      console.log("Opening the private local management page.");
      console.log(`Use the selected wallet ${CONTROL_WALLET}.`);
      await run("/usr/bin/open", [admin.url]);
      if (!snapshot) {
        console.log("Confirm DEPLOY FIXED STACK in MetaMask.");
        const event = await admin.control.waitFor("registry");
        if (!isAddress(event?.registryAddress)) throw new Error("Local page returned an invalid Registry address.");
        snapshot = await readAndValidateRegistry(event.registryAddress);
        savedState = await saveLocalState(snapshot);
        console.log(`PASS · New Registry captured: ${snapshot.registryAddress}`);
      }
      if (!snapshot.operatorAuthorized) {
        console.log("Confirm AUTHORIZE OPERATOR in MetaMask.");
        await waitForAuthorization(snapshot.registryAddress);
        snapshot = await readAndValidateRegistry(snapshot.registryAddress);
        if (!snapshot.operatorAuthorized) throw new Error("Operator authorization did not persist onchain.");
        savedState = await saveLocalState(snapshot);
        console.log("PASS · One-way launch authorization confirmed.");
      }
    } finally {
      await closeLocalAdmin(admin);
    }
  } else {
    console.log(`PASS · Existing private Registry is authorized: ${snapshot.registryAddress}`);
  }

  savedState = await syncVercelRuntime(snapshot, savedState || {});
  console.log("\nDeploying the Registry-aware public site to Vercel.");
  await deployProductionSite();
  console.log("PASS · Public site is prepared. Buying remains fail-closed until the official CA is activated.");
  await run("/usr/bin/open", [SITE_URL]);
  return savedState;
}

async function preflight(ca, snapshot) {
  const chainId = await client.getChainId();
  if (chainId !== 4663) throw new Error(`RPC returned unexpected chain ${chainId}.`);
  await contractCode(ca, "Official CA");
  if (!snapshot.operatorAuthorized) throw new Error("Launch operator is not authorized.");
  if (snapshot.currentMarket) {
    if (same(snapshot.currentOfficialToken, ca) && snapshot.marketReady) {
      return { alreadyLive: true };
    }
    throw new Error(`Registry already has another active CA: ${snapshot.currentOfficialToken}`);
  }

  const launched = await client.readContract({
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
    client.readContract({
      address: V3_FACTORY,
      abi: v3FactoryAbi,
      functionName: "getPool",
      args: [WETH, ca, PONS_POOL_FEE],
    }),
    client.readContract({ address: ca, abi: tokenAbi, functionName: "liquidityPool" }),
  ]);
  if (same(canonicalPool, zeroAddress)) throw new Error("Canonical Pons liquidity pool has not been created yet.");
  if (!same(canonicalPool, tokenPool)) {
    throw new Error(`Token pool ${tokenPool} does not match canonical pool ${canonicalPool}.`);
  }
  await contractCode(canonicalPool, "Canonical Pons pool");

  await client.simulateContract({
    address: snapshot.registryAddress,
    abi: registryAbi,
    functionName: "activatePonsMarket",
    args: [ca],
    account: CONTROL_WALLET,
  });
  return { alreadyLive: false, canonicalPool };
}

async function waitForActivation(registryAddress, ca, timeoutMs = 15 * 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const snapshot = await readAndValidateRegistry(registryAddress);
    if (
      same(snapshot.currentOfficialToken, ca)
      && snapshot.currentMarket
      && snapshot.marketReady
      && snapshot.activatedBlock > 0
    ) return snapshot;
    process.stdout.write(".");
    await pause(2_500);
  }
  throw new Error("Timed out waiting for the activation transaction.");
}

async function verifyPublicRuntime(ca) {
  for (let attempt = 1; attempt <= 12; attempt += 1) {
    try {
      const response = await fetch(`${SITE_URL}/api/runtime?launch=${Date.now()}`, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      if (!same(payload.officialTokenAddress, ca)) {
        throw new Error("Runtime CA does not match the activated CA.");
      }
      return payload;
    } catch (error) {
      if (attempt === 12) throw error;
      await pause(5_000);
    }
  }
  return null;
}

async function launchOfficialCa(ca, { preflightOnly = false } = {}) {
  const savedState = await loadLocalState();
  if (!savedState) throw new Error("No replacement Registry is prepared. Run the desktop script once in PREPARE mode first.");
  let snapshot = await readAndValidateRegistry(savedState.registryAddress);
  if (!snapshot.operatorAuthorized) throw new Error("Replacement Registry is not pre-authorized.");
  await requireControlBalance(MIN_LAUNCH_BALANCE_WEI, "Official CA activation");

  console.log(`\n[1/5] Preflight ${ca}`);
  const checked = await preflight(ca, snapshot);
  console.log("PASS · Official Pons token, WETH pair, 1% pool and activation simulation verified.");
  if (preflightOnly) {
    console.log("\nDONE · Preflight-only mode stopped before opening a wallet or sending a transaction.\n");
    return;
  }

  if (!checked.alreadyLive) {
    const admin = await startLocalAdmin({
      registryAddress: snapshot.registryAddress,
      officialToken: ca,
    });
    try {
      console.log("\n[2/5] Opening the private local activation page.");
      console.log(`Confirm ACTIVATE 99/1 with ${CONTROL_WALLET} in MetaMask.`);
      await run("/usr/bin/open", [admin.url]);
      process.stdout.write("Waiting for the onchain activation");
      snapshot = await waitForActivation(snapshot.registryAddress, ca);
      console.log("\nPASS · Gateway and Pons Adapter activated atomically.");
    } finally {
      await closeLocalAdmin(admin);
    }
  } else {
    console.log("\n[2/5] This CA is already active; skipping the activation transaction.");
    snapshot = await readAndValidateRegistry(snapshot.registryAddress);
  }

  let nextState = await saveLocalState(snapshot, {
    vercelRuntimeFingerprint: savedState.vercelRuntimeFingerprint || "",
  });
  console.log("\n[3/5] Confirming Vercel Registry bindings and deploying Production.");
  nextState = await syncVercelRuntime(snapshot, nextState);
  await deployProductionSite();
  console.log("PASS · Vercel production deployment completed.");

  console.log("\n[4/5] Verifying the public runtime and homepage CA.");
  try {
    const runtime = await verifyPublicRuntime(ca);
    console.log(`PASS · Runtime status ${runtime.status}; homepage CA is ${runtime.officialTokenAddress}.`);
    if (runtime.ready !== true) {
      console.log("NOTICE · CA is public, but buying remains fail-closed until every runtime check passes.");
    }
  } catch (error) {
    console.log(`NOTICE · Vercel deployed, but Runtime verification could not complete: ${error.message}`);
    console.log("The browser will open the homepage for a direct check.");
  }

  console.log("\n[5/5] Opening the production homepage.");
  await run("/usr/bin/open", [`${SITE_URL}/?launch=${Date.now()}`]);
  console.log("\nDONE · Official CA activated and the production site redeployed.\n");
  await saveLocalState(snapshot, {
    vercelRuntimeFingerprint: nextState.vercelRuntimeFingerprint || stateFingerprint(snapshot),
  });
}

async function checkOnly() {
  console.log("\nCHECK MODE · NO WALLET REQUEST · NO TRANSACTION\n");
  const chainId = await client.getChainId();
  if (chainId !== 4663) throw new Error(`RPC returned unexpected chain ${chainId}.`);
  const balance = await controlBalance();
  console.log(`PASS · Robinhood Chain RPC: ${chainId}`);
  console.log(`CONTROL WALLET GAS: ${formatEther(balance)} ETH`);
  if (balance < MIN_PREPARE_BALANCE_WEI) {
    console.log("NOTICE · Top up to 0.005 ETH before PREPARE mode.");
  }
  const state = await loadLocalState();
  if (!state) {
    console.log("READY FOR PREPARE · No replacement Registry has been deployed yet.");
    return;
  }
  const snapshot = await readAndValidateRegistry(state.registryAddress);
  console.log(`PASS · Registry: ${snapshot.registryAddress}`);
  console.log(`PASS · Operator authorized: ${snapshot.operatorAuthorized ? "YES" : "NO"}`);
  console.log(`MARKET: ${snapshot.marketReady ? snapshot.currentOfficialToken : "WAITING FOR OFFICIAL CA"}`);
}

function printHelp() {
  console.log(`
401KEK FAST LAUNCH

Double-click behavior:
  No local Registry   -> opens PREPARE mode
  Registry prepared   -> asks for the official Pons CA and runs launch mode

Options:
  --prepare           Deploy/authorize the replacement Registry and sync Vercel
  --check             Read-only RPC, gas and Registry diagnostics
  --preflight-only CA Validate a real official CA without opening a wallet
  --help              Show this help
`);
}

async function main() {
  console.log("\n401KEK · ROBINHOOD CHAIN FAST LAUNCH\n");
  const arguments_ = process.argv.slice(2);
  if (arguments_.includes("--help")) {
    printHelp();
    return;
  }
  if (arguments_.includes("--check")) {
    await checkOnly();
    return;
  }
  const forcePrepare = arguments_.includes("--prepare");
  const preflightOnly = arguments_.includes("--preflight-only");
  const unknownFlags = arguments_.filter((value) => value.startsWith("--")
    && !["--prepare", "--preflight-only"].includes(value));
  if (unknownFlags.length) throw new Error(`Unknown option: ${unknownFlags.join(", ")}`);

  const existingState = await loadLocalState();
  if (forcePrepare || !existingState) {
    await prepareProduction();
    return;
  }

  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const caArgument = arguments_.find((value) => !value.startsWith("--"));
    const raw = caArgument || await terminal.question("Paste the official Pons CA: ");
    const candidate = raw.trim().replace(/^['"]|['"]$/g, "");
    if (!isAddress(candidate)) throw new Error("CA must be a complete 0x address with 40 hex characters.");
    await launchOfficialCa(getAddress(candidate), { preflightOnly });
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
