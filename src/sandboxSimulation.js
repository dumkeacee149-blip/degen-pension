const BPS_DENOMINATOR = 10_000n;
const PROJECT_BPS = 9_900n;
const MAX_EXPLICIT_FEE_BPS = 500;
const PROJECT_OUTPUT_MULTIPLIER = 2n;
const STOCK_OUTPUT_MULTIPLIER = 2n;

export const SANDBOX_DEFAULTS = Object.freeze({
  grossAmountIn: 10_000_000_000_000_000n,
  feeBps: 0,
  slippageBps: 200,
  confirmationsRequired: 12,
  confirmationsObserved: 12,
  simulationId: "SIM-401KEK-0001",
});

export const SANDBOX_STAGES = Object.freeze([
  "eligibility",
  "split",
  "quote",
  "callSimulation",
  "settlement",
  "confirmations",
  "receipt",
]);

function integer(value, label) {
  if (typeof value === "bigint") return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return BigInt(value);
  if (typeof value === "number" && Number.isSafeInteger(value)) return BigInt(value);
  throw new TypeError(`${label} must be a non-negative integer or integer string.`);
}

function boundedBps(value, label, maximum = 10_000) {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw new RangeError(`${label} must be an integer from 0 to ${maximum}.`);
  }
  return value;
}

function confirmationCount(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative safe integer.`);
  }
  return value;
}

function snapshotBalances(balances) {
  return {
    payerInput: balances.payerInput,
    feeRecipientInput: balances.feeRecipientInput,
    projectAdapterInput: balances.projectAdapterInput,
    stockAdapterInput: balances.stockAdapterInput,
    routerInput: balances.routerInput,
    recipientProject: balances.recipientProject,
    recipientStock: balances.recipientStock,
    gatewayInput: balances.gatewayInput,
  };
}

function initialBalances(grossAmountIn) {
  return {
    payerInput: grossAmountIn,
    feeRecipientInput: 0n,
    projectAdapterInput: 0n,
    stockAdapterInput: 0n,
    routerInput: 0n,
    recipientProject: 0n,
    recipientStock: 0n,
    gatewayInput: 0n,
  };
}

export function calculateSandboxSplit(
  grossAmountIn = SANDBOX_DEFAULTS.grossAmountIn,
  feeBps = SANDBOX_DEFAULTS.feeBps,
) {
  const gross = integer(grossAmountIn, "grossAmountIn");
  const explicitFeeBps = boundedBps(feeBps, "feeBps", MAX_EXPLICIT_FEE_BPS);
  if (gross <= 0n) throw new RangeError("grossAmountIn must be greater than zero.");

  const explicitFeeAmount = gross * BigInt(explicitFeeBps) / BPS_DENOMINATOR;
  const netAmountIn = gross - explicitFeeAmount;
  const projectAmountIn = netAmountIn * PROJECT_BPS / BPS_DENOMINATOR;
  const stockAmountIn = netAmountIn - projectAmountIn;
  if (projectAmountIn <= 0n || stockAmountIn <= 0n) {
    throw new RangeError("grossAmountIn is too small to fund both sandbox legs.");
  }

  return {
    grossAmountIn: gross,
    explicitFeeBps,
    explicitFeeAmount,
    netAmountIn,
    projectAmountIn,
    stockAmountIn,
    projectBps: Number(PROJECT_BPS),
    stockBps: Number(BPS_DENOMINATOR - PROJECT_BPS),
  };
}

export function createSandboxQuote(
  split,
  { slippageBps = SANDBOX_DEFAULTS.slippageBps } = {},
) {
  if (!split || typeof split.projectAmountIn !== "bigint" || typeof split.stockAmountIn !== "bigint") {
    throw new TypeError("A valid sandbox split is required.");
  }
  const allowedSlippageBps = boundedBps(slippageBps, "slippageBps", 1_000);
  const projectAmountOut = split.projectAmountIn * PROJECT_OUTPUT_MULTIPLIER;
  const stockAmountOut = split.stockAmountIn * STOCK_OUTPUT_MULTIPLIER;
  const minProjectOut = projectAmountOut
    * (BPS_DENOMINATOR - BigInt(allowedSlippageBps))
    / BPS_DENOMINATOR;
  const minStockOut = stockAmountOut
    * (BPS_DENOMINATOR - BigInt(allowedSlippageBps))
    / BPS_DENOMINATOR;
  if (minProjectOut <= 0n || minStockOut <= 0n) {
    throw new RangeError("The sandbox quote is too small to execute both legs.");
  }

  return {
    executable: true,
    simulationOnly: true,
    source: "DETERMINISTIC_SANDBOX_FIXTURE",
    slippageBps: allowedSlippageBps,
    projectAmountOut,
    stockAmountOut,
    minProjectOut,
    minStockOut,
    projectRoute: "SANDBOX_INPUT_TO_401KEK",
    stockRoute: "SANDBOX_INPUT_TO_QQQ",
  };
}

export function simulateAtomicSettlement({ split, quote, failLeg = null }) {
  if (!split || !quote?.executable) {
    throw new TypeError("An executable sandbox quote and its split are required.");
  }
  if (failLeg !== null && failLeg !== "project" && failLeg !== "stock") {
    throw new RangeError("failLeg must be null, 'project', or 'stock'.");
  }

  const balancesBefore = initialBalances(split.grossAmountIn);
  if (failLeg !== null) {
    return {
      atomic: true,
      committed: false,
      reverted: true,
      failedLeg: failLeg,
      revertReason: `SANDBOX_${failLeg.toUpperCase()}_LEG_REVERTED`,
      balancesBefore: snapshotBalances(balancesBefore),
      balancesAfter: snapshotBalances(balancesBefore),
      event: null,
    };
  }

  const balancesAfter = {
    payerInput: 0n,
    feeRecipientInput: split.explicitFeeAmount,
    projectAdapterInput: 0n,
    stockAdapterInput: 0n,
    routerInput: split.netAmountIn,
    recipientProject: quote.projectAmountOut,
    recipientStock: quote.stockAmountOut,
    gatewayInput: 0n,
  };

  return {
    atomic: true,
    committed: true,
    reverted: false,
    failedLeg: null,
    revertReason: null,
    balancesBefore: snapshotBalances(balancesBefore),
    balancesAfter: snapshotBalances(balancesAfter),
    event: {
      type: "SIMULATED_SPLITBUY",
      payer: "SANDBOX_PAYER",
      recipient: "SANDBOX_RECIPIENT",
      grossAmountIn: split.grossAmountIn,
      explicitFeeAmount: split.explicitFeeAmount,
      netAmountIn: split.netAmountIn,
      projectAmountIn: split.projectAmountIn,
      stockAmountIn: split.stockAmountIn,
      projectAmountOut: quote.projectAmountOut,
      stockAmountOut: quote.stockAmountOut,
    },
  };
}

export function unlockSandboxReceipt({
  simulationId = SANDBOX_DEFAULTS.simulationId,
  settlement,
  confirmations,
}) {
  const eventIsCanonicalForSandbox = settlement?.committed === true
    && settlement?.reverted === false
    && settlement?.event?.type === "SIMULATED_SPLITBUY";
  if (!eventIsCanonicalForSandbox) {
    return {
      unlocked: false,
      memberNumber: null,
      receiptId: null,
      source: null,
      reason: "ATOMIC_SETTLEMENT_NOT_COMMITTED",
    };
  }
  if (
    confirmations?.status !== "CONFIRMED"
    || confirmations.required !== SANDBOX_DEFAULTS.confirmationsRequired
    || confirmations.observed < SANDBOX_DEFAULTS.confirmationsRequired
  ) {
    return {
      unlocked: false,
      memberNumber: null,
      receiptId: null,
      source: null,
      reason: "AWAITING_12_SANDBOX_CONFIRMATIONS",
    };
  }

  return {
    unlocked: true,
    memberNumber: 1,
    receiptId: "SIM-RECEIPT-0001",
    source: "SIMULATED_SPLITBUY_EVENT",
    simulationId,
    disclaimer: "SANDBOX ONLY - NOT AN ONCHAIN RECEIPT",
  };
}

function stage(key, status, evidence) {
  return { key, status, evidence };
}

export function runSandboxSimulation({
  grossAmountIn = SANDBOX_DEFAULTS.grossAmountIn,
  feeBps = SANDBOX_DEFAULTS.feeBps,
  slippageBps = SANDBOX_DEFAULTS.slippageBps,
  confirmationsObserved = SANDBOX_DEFAULTS.confirmationsObserved,
  failLeg = null,
} = {}) {
  const observed = confirmationCount(confirmationsObserved, "confirmationsObserved");
  const simulationId = SANDBOX_DEFAULTS.simulationId;
  const eligibility = {
    eligible: true,
    simulationOnly: true,
    source: "LOCAL_SANDBOX_POLICY_FIXTURE",
    policy: "SANDBOX_ALLOW_V1",
  };
  const split = calculateSandboxSplit(grossAmountIn, feeBps);
  const quote = createSandboxQuote(split, { slippageBps });

  // The call result is derived without mutating balances. The settlement below
  // starts from the same pristine snapshot, mirroring an independent eth_call.
  const callResult = simulateAtomicSettlement({ split, quote, failLeg });
  const callSimulation = {
    independent: true,
    simulationOnly: true,
    success: callResult.committed,
    revertReason: callResult.revertReason,
  };
  const settlement = simulateAtomicSettlement({ split, quote, failLeg });
  const confirmations = {
    required: SANDBOX_DEFAULTS.confirmationsRequired,
    observed: settlement.committed ? observed : 0,
    status: settlement.committed && observed >= SANDBOX_DEFAULTS.confirmationsRequired
      ? "CONFIRMED"
      : settlement.committed
        ? "PENDING"
        : "BLOCKED",
    simulationOnly: true,
  };
  const receipt = unlockSandboxReceipt({ simulationId, settlement, confirmations });
  const completed = receipt.unlocked;
  const status = settlement.reverted
    ? "REVERTED"
    : completed
      ? "COMPLETED"
      : "AWAITING_CONFIRMATIONS";

  const stages = [
    stage("eligibility", "PASS", eligibility.source),
    stage("split", "PASS", "FEE_FIRST_NET_99_1"),
    stage("quote", "PASS", quote.source),
    stage(
      "callSimulation",
      callSimulation.success ? "PASS" : "REVERTED",
      callSimulation.success ? "INDEPENDENT_CALL_SUCCEEDED" : callSimulation.revertReason,
    ),
    stage(
      "settlement",
      settlement.committed ? "PASS" : "ROLLED_BACK",
      settlement.committed ? "BOTH_LEGS_COMMITTED" : "NO_BALANCE_CHANGE",
    ),
    stage("confirmations", confirmations.status === "CONFIRMED" ? "PASS" : confirmations.status, `${confirmations.observed}/${confirmations.required}`),
    stage("receipt", receipt.unlocked ? "PASS" : "LOCKED", receipt.unlocked ? receipt.receiptId : receipt.reason),
  ];

  return {
    mode: "SANDBOX",
    status,
    simulationId,
    chainTransaction: false,
    transactionHash: null,
    disclaimer: "DETERMINISTIC LOCAL SIMULATION - NO WALLET, NO REAL FUNDS, NOT A CHAIN TRANSACTION",
    stages,
    eligibility,
    split,
    quote,
    callSimulation,
    settlement,
    confirmations,
    receipt,
  };
}
