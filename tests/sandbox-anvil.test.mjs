import assert from "node:assert/strict";
import test from "node:test";
import { runLocalSandbox } from "../scripts/run-sandbox.mjs";

test("local chain sandbox completes the exact quote, transaction, confirmations, receipt and member flow", { timeout: 60_000 }, async () => {
  const result = await runLocalSandbox();

  assert.equal(result.mode, "LOCAL_ANVIL_SANDBOX");
  assert.equal(result.productionReady, false);
  assert.equal(result.walletConnectionUsed, false);
  assert.equal(result.realFundsUsed, false);
  assert.equal(result.externalRpcUsed, false);
  assert.equal(result.chainId, 4663);
  assert.equal(result.rpcScope, "EPHEMERAL_127_0_0_1_ONLY");
  assert.equal(result.split.explicitFeeBps, 0);
  assert.equal(BigInt(result.split.project) + BigInt(result.split.stock), BigInt(result.split.net));
  assert.equal(BigInt(result.split.fee) + BigInt(result.split.net), BigInt(result.split.gross));
  assert.equal(result.quote.source, "ONCHAIN_QUOTER_V2_AND_GATEWAY_ETH_CALL");
  assert.equal(result.quote.ethCallPassed, true);
  assert.ok(BigInt(result.quote.projectAmountOut) >= BigInt(result.quote.minProjectOut));
  assert.ok(BigInt(result.quote.stockAmountOut) >= BigInt(result.quote.minStockOut));
  assert.match(result.transaction.hash, /^0x[a-fA-F0-9]{64}$/);
  assert.equal(result.transaction.localOnly, true);
  assert.equal(result.transaction.status, "CONFIRMED");
  assert.equal(result.transaction.confirmations, 12);
  assert.equal(result.transaction.splitBuyEvents, 1);
  assert.equal(result.receipt.memberNumber, 1);
  assert.equal(result.receipt.memberCount, 1);
  assert.equal(result.receipt.buyCount, 1);
  assert.equal(result.receipt.onchainProductionReceipt, false);
  assert.match(result.rollbackProof.transactionHash, /^0x[a-fA-F0-9]{64}$/);
  assert.equal(result.rollbackProof.status, "REVERTED");
  assert.equal(result.rollbackProof.splitBuyEvents, 0);
  assert.equal(result.rollbackProof.balancesRestored, true);
  assert.equal(result.rollbackProof.receiptUnlocked, false);
});
