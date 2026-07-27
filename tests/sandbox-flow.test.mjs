import assert from "node:assert/strict";
import test from "node:test";
import {
  SANDBOX_DEFAULTS,
  calculateSandboxSplit,
  createSandboxQuote,
  runSandboxSimulation,
  simulateAtomicSettlement,
  unlockSandboxReceipt,
} from "../src/sandboxSimulation.js";

test("sandbox runs eligibility through a confirmed receipt without pretending to be a chain transaction", () => {
  const result = runSandboxSimulation();

  assert.equal(result.mode, "SANDBOX");
  assert.equal(result.status, "COMPLETED");
  assert.match(result.simulationId, /^SIM-/);
  assert.equal(result.chainTransaction, false);
  assert.equal(result.transactionHash, null);
  assert.equal(result.eligibility.eligible, true);
  assert.equal(result.eligibility.simulationOnly, true);

  assert.deepEqual(result.split, {
    grossAmountIn: 10_000_000_000_000_000n,
    explicitFeeBps: 0,
    explicitFeeAmount: 0n,
    netAmountIn: 10_000_000_000_000_000n,
    projectAmountIn: 9_900_000_000_000_000n,
    stockAmountIn: 100_000_000_000_000n,
    projectBps: 9_900,
    stockBps: 100,
  });
  assert.equal(
    result.split.explicitFeeAmount + result.split.netAmountIn,
    result.split.grossAmountIn,
  );
  assert.equal(
    result.split.projectAmountIn + result.split.stockAmountIn,
    result.split.netAmountIn,
  );

  assert.equal(result.quote.executable, true);
  assert.equal(result.quote.simulationOnly, true);
  assert.equal(result.quote.projectAmountOut, 19_800_000_000_000_000n);
  assert.equal(result.quote.stockAmountOut, 200_000_000_000_000n);
  assert.equal(result.quote.minProjectOut, 19_404_000_000_000_000n);
  assert.equal(result.quote.minStockOut, 196_000_000_000_000n);
  assert.equal(result.callSimulation.independent, true);
  assert.equal(result.callSimulation.success, true);
  assert.equal(result.settlement.atomic, true);
  assert.equal(result.settlement.committed, true);
  assert.equal(result.settlement.event.type, "SIMULATED_SPLITBUY");
  assert.equal(
    result.settlement.balancesAfter.feeRecipientInput
      + result.settlement.balancesAfter.routerInput,
    result.split.grossAmountIn,
  );
  assert.deepEqual(result.confirmations, {
    required: 12,
    observed: 12,
    status: "CONFIRMED",
    simulationOnly: true,
  });
  assert.equal(result.receipt.unlocked, true);
  assert.equal(result.receipt.memberNumber, 1);
  assert.equal(result.receipt.receiptId, "SIM-RECEIPT-0001");
  assert.equal(result.stages.every(({ status }) => status === "PASS"), true);
});

test("a failed stock leg atomically restores every balance and cannot mint a receipt or member", () => {
  const result = runSandboxSimulation({ failLeg: "stock" });

  assert.equal(result.status, "REVERTED");
  assert.equal(result.callSimulation.success, false);
  assert.equal(result.callSimulation.revertReason, "SANDBOX_STOCK_LEG_REVERTED");
  assert.equal(result.settlement.atomic, true);
  assert.equal(result.settlement.committed, false);
  assert.equal(result.settlement.reverted, true);
  assert.equal(result.settlement.event, null);
  assert.deepEqual(result.settlement.balancesAfter, result.settlement.balancesBefore);
  assert.equal(result.confirmations.status, "BLOCKED");
  assert.equal(result.confirmations.observed, 0);
  assert.equal(result.receipt.unlocked, false);
  assert.equal(result.receipt.memberNumber, null);
  assert.equal(result.receipt.receiptId, null);
  assert.equal(result.receipt.reason, "ATOMIC_SETTLEMENT_NOT_COMMITTED");
  assert.equal(result.stages.find(({ key }) => key === "settlement").status, "ROLLED_BACK");
  assert.equal(result.stages.find(({ key }) => key === "receipt").status, "LOCKED");
});

test("receipt and member remain gated until all 12 sandbox confirmations are observed", () => {
  const pending = runSandboxSimulation({ confirmationsObserved: 11 });

  assert.equal(pending.status, "AWAITING_CONFIRMATIONS");
  assert.equal(pending.settlement.committed, true);
  assert.equal(pending.confirmations.status, "PENDING");
  assert.equal(pending.receipt.unlocked, false);
  assert.equal(pending.receipt.memberNumber, null);
  assert.equal(pending.receipt.reason, "AWAITING_12_SANDBOX_CONFIRMATIONS");

  const unlocked = unlockSandboxReceipt({
    simulationId: pending.simulationId,
    settlement: pending.settlement,
    confirmations: { required: 12, observed: 12, status: "CONFIRMED" },
  });
  assert.equal(unlocked.unlocked, true);
  assert.equal(unlocked.memberNumber, 1);

  const bypassAttempt = unlockSandboxReceipt({
    simulationId: pending.simulationId,
    settlement: pending.settlement,
    confirmations: { required: 0, observed: 0, status: "CONFIRMED" },
  });
  assert.equal(bypassAttempt.unlocked, false);
  assert.equal(bypassAttempt.memberNumber, null);
});

test("split, quote, and atomic settlement helpers reject invalid or partial fixtures", () => {
  assert.throws(() => calculateSandboxSplit(1n, SANDBOX_DEFAULTS.feeBps), /too small/);
  assert.throws(() => calculateSandboxSplit(1_000n, 501), /0 to 500/);
  assert.throws(() => createSandboxQuote(null), /valid sandbox split/);

  const split = calculateSandboxSplit();
  const quote = createSandboxQuote(split);
  assert.throws(
    () => simulateAtomicSettlement({ split, quote, failLeg: "fee" }),
    /null, 'project', or 'stock'/,
  );
});
