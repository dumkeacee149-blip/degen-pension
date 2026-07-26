import {
  decodeFunctionResult,
  encodeFunctionData,
  getAddress,
  recoverTypedDataAddress,
  toHex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  GATEWAY_ABI,
  QUOTER_V2_ABI,
  QUOTE_TYPED_DATA_TYPES,
} from "./constants.js";
import { decideEligibility } from "./eligibility.js";
import { ApiError } from "./http.js";
import { getPublicClient, loadRuntime } from "./runtime.js";

const BPS_DENOMINATOR = 10_000n;
const PROJECT_BPS = 9_900n;

export function calculateSplit(grossAmountIn, explicitFeeBps) {
  const fee = grossAmountIn * BigInt(explicitFeeBps) / BPS_DENOMINATOR;
  const net = grossAmountIn - fee;
  const projectAmountIn = net * PROJECT_BPS / BPS_DENOMINATOR;
  const stockAmountIn = net - projectAmountIn;
  if (projectAmountIn <= 0n || stockAmountIn <= 0n) {
    throw new ApiError(400, "AMOUNT_TOO_SMALL", "Amount is too small for both settlement legs.");
  }
  return { fee, net, projectAmountIn, stockAmountIn };
}

export function applySlippage(amountOut, slippageBps) {
  const minimum = amountOut * (BPS_DENOMINATOR - BigInt(slippageBps)) / BPS_DENOMINATOR;
  if (minimum <= 0n) throw new ApiError(503, "QUOTE_TOO_SMALL", "Quoted output is too small.");
  return minimum;
}

async function quoteExactInput(client, quoterAddress, path, amountIn, account) {
  const callData = encodeFunctionData({
    abi: QUOTER_V2_ABI,
    functionName: "quoteExactInput",
    args: [path, amountIn],
  });
  let result;
  try {
    result = await client.call({ account, to: quoterAddress, data: callData });
  } catch {
    throw new ApiError(503, "QUOTER_REVERTED", "The onchain Quoter could not price both routes.");
  }
  if (!result.data) throw new ApiError(503, "QUOTER_INVALID", "The onchain Quoter returned no data.");
  const decoded = decodeFunctionResult({
    abi: QUOTER_V2_ABI,
    functionName: "quoteExactInput",
    data: result.data,
  });
  const amountOut = decoded[0];
  if (amountOut <= 0n) throw new ApiError(503, "NO_LIQUIDITY", "The route returned zero output.");
  return { amountOut, gasEstimate: decoded[3] };
}

async function signEligibility(config, runtime, wallet, recipient, validUntil) {
  if (!config.eligibilitySignerPrivateKey) {
    throw new ApiError(503, "ELIGIBILITY_SIGNER_UNAVAILABLE", "Eligibility signer is not configured.");
  }
  const account = privateKeyToAccount(config.eligibilitySignerPrivateKey);
  if (account.address.toLowerCase() !== runtime.eligibilitySignerAddress?.toLowerCase()) {
    throw new ApiError(503, "ELIGIBILITY_SIGNER_MISMATCH", "Eligibility signer does not match the onchain checker.");
  }
  const domain = {
    name: "DEGEN PENSION Eligibility",
    version: "1",
    chainId: config.chainId,
    verifyingContract: runtime.eligibilityCheckerAddress,
  };
  const message = {
    market: runtime.gatewayAddress,
    payer: wallet,
    recipient,
    validUntil,
    policyHash: runtime.policyHash,
  };
  const signature = await account.signTypedData({
    domain,
    types: QUOTE_TYPED_DATA_TYPES,
    primaryType: "Eligibility",
    message,
  });
  const recovered = await recoverTypedDataAddress({
    domain,
    types: QUOTE_TYPED_DATA_TYPES,
    primaryType: "Eligibility",
    message,
    signature,
  });
  if (recovered.toLowerCase() !== runtime.eligibilitySignerAddress.toLowerCase()) {
    throw new ApiError(503, "ELIGIBILITY_SIGNATURE_INVALID", "Eligibility signature self-check failed.");
  }
  return {
    signature,
    signer: runtime.eligibilitySignerAddress,
    checker: runtime.eligibilityCheckerAddress,
    policyHash: runtime.policyHash,
    validUntil: Number(validUntil),
    typedPayload: {
      domain,
      types: QUOTE_TYPED_DATA_TYPES,
      primaryType: "Eligibility",
      message: {
        ...message,
        validUntil: validUntil.toString(),
      },
    },
  };
}

async function simulateGateway(client, {
  wallet,
  gateway,
  amountInWei,
  minProjectOut,
  minStockOut,
  recipient,
  deadline,
  eligibilityDeadline,
  signature,
}) {
  const data = encodeFunctionData({
    abi: GATEWAY_ABI,
    functionName: "buyNative",
    args: [minProjectOut, minStockOut, recipient, deadline, eligibilityDeadline, signature],
  });
  let result;
  try {
    result = await client.call({
      account: wallet,
      to: gateway,
      data,
      value: amountInWei,
    });
  } catch {
    throw new ApiError(503, "GATEWAY_SIMULATION_REVERTED", "The complete 99/1 transaction simulation reverted.");
  }
  if (!result.data) {
    throw new ApiError(503, "GATEWAY_SIMULATION_INVALID", "The Gateway simulation returned no output.");
  }
  const [projectAmountOut, stockAmountOut] = decodeFunctionResult({
    abi: GATEWAY_ABI,
    functionName: "buyNative",
    data: result.data,
  });
  if (projectAmountOut < minProjectOut || stockAmountOut < minStockOut) {
    throw new ApiError(503, "GATEWAY_OUTPUT_MISMATCH", "Simulated output is below the signed minimum.");
  }
  return { data, projectAmountOut, stockAmountOut };
}

export async function createQuote(config, {
  wallet,
  recipient,
  amountInWei,
  slippageBps,
  termsAccepted,
  notUSPerson,
  countryCode,
  fetchImpl = fetch,
  runtimeLoader = loadRuntime,
  clientFactory = getPublicClient,
  eligibilityDecider = decideEligibility,
}) {
  if (wallet.toLowerCase() !== recipient.toLowerCase()) {
    throw new ApiError(
      400,
      "RECIPIENT_MUST_EQUAL_WALLET",
      "Production eligibility currently requires payer and recipient to be the same wallet.",
    );
  }
  const runtime = await runtimeLoader(config, { fresh: true });
  if (!runtime.ready) {
    const failedChecks = Object.entries(runtime.checks)
      .filter(([, passed]) => !passed)
      .map(([name]) => name);
    throw new ApiError(503, "MARKET_NOT_READY", "The complete production market is not ready.", {
      status: runtime.status,
      failedChecks,
    });
  }

  const eligibility = await eligibilityDecider(config, {
    wallet,
    countryCode,
    termsAccepted,
    notUSPerson,
    fetchImpl,
  });
  if (!eligibility.eligible) {
    throw new ApiError(403, "NOT_ELIGIBLE", "This wallet cannot receive a Stock Token quote.", {
      reason: eligibility.reason,
      countryCode: eligibility.countryCode,
    });
  }

  const split = calculateSplit(amountInWei, runtime.explicitFeeBps);
  if (!runtime.routes?.projectPath || !runtime.routes?.stockPath) {
    throw new ApiError(503, "QUOTE_ROUTE_UNAVAILABLE", "Verified onchain quote routes are unavailable.");
  }
  const client = clientFactory(config);
  const [projectQuote, stockQuote, latestBlock] = await Promise.all([
    quoteExactInput(client, config.quoterAddress, runtime.routes.projectPath, split.projectAmountIn, wallet),
    quoteExactInput(client, config.quoterAddress, runtime.routes.stockPath, split.stockAmountIn, wallet),
    client.getBlock({ blockTag: "latest" }),
  ]);
  const minProjectOut = applySlippage(projectQuote.amountOut, slippageBps);
  const minStockOut = applySlippage(stockQuote.amountOut, slippageBps);
  const chainNow = Number(latestBlock.timestamp);
  const deadline = BigInt(chainNow + config.quoteTtlSeconds);
  const providerExpiry = Math.floor(Date.parse(eligibility.expiresAt) / 1_000);
  const eligibilityDeadline = BigInt(Math.min(Number(deadline), providerExpiry));
  if (Number(eligibilityDeadline) <= chainNow) {
    throw new ApiError(503, "ELIGIBILITY_EXPIRED", "Eligibility expired before quote creation.");
  }

  const eligibilityProof = await signEligibility(
    config,
    runtime,
    wallet,
    recipient,
    eligibilityDeadline,
  );
  const simulation = await simulateGateway(client, {
    wallet,
    gateway: runtime.gatewayAddress,
    amountInWei,
    minProjectOut,
    minStockOut,
    recipient,
    deadline,
    eligibilityDeadline,
    signature: eligibilityProof.signature,
  });

  return {
    schemaVersion: 1,
    expiresAt: new Date(Number(deadline) * 1_000).toISOString(),
    amountInWei: amountInWei.toString(),
    minProjectOut: minProjectOut.toString(),
    minStockOut: minStockOut.toString(),
    projectAmountOut: simulation.projectAmountOut.toString(),
    stockAmountOut: simulation.stockAmountOut.toString(),
    slippageBps,
    eligibilityProof: {
      validUntil: eligibilityProof.validUntil,
      policyHash: eligibilityProof.policyHash,
      signature: eligibilityProof.signature,
      signer: eligibilityProof.signer,
      checker: eligibilityProof.checker,
      providerDecision: eligibility.proof,
    },
    typedPayload: eligibilityProof.typedPayload,
    transaction: {
      to: getAddress(runtime.gatewayAddress),
      data: simulation.data,
      value: toHex(amountInWei),
      chainId: config.chainId,
    },
    quoteSource: {
      type: "ONCHAIN_QUOTER_V2_AND_GATEWAY_ETH_CALL",
      quoter: config.quoterAddress,
      projectPath: runtime.routes.projectPath,
      stockPath: runtime.routes.stockPath,
      projectGasEstimate: projectQuote.gasEstimate.toString(),
      stockGasEstimate: stockQuote.gasEstimate.toString(),
      simulatedAtBlock: latestBlock.number.toString(),
    },
  };
}
