import { useCallback, useEffect, useState } from "react";
import { MARKET } from "./config.js";
import { loadHolderStockStats } from "./holderStockStats.js";

const EMPTY_PROOF = Object.freeze({
  status: "pending",
  selfBuyCount: null,
  uniqueBuyerCount: null,
  usdgSpentRaw: null,
  usdgSpent: null,
  qqqAmountOutRaw: null,
  qqqAmount: null,
  usdgDecimals: null,
  qqqDecimals: null,
  approximateUsdValue: null,
  officialTokenAddress: null,
  gatewayAddress: null,
  stockTokenAddress: null,
  settlementTokenAddress: null,
  settlementPoolAddress: null,
  activatedBlock: null,
  asOfBlock: null,
  source: null,
  scope: null,
  valuationBasis: null,
  checkedAt: null,
  updatedAt: null,
  stale: false,
  error: null,
});

function idleProof(officialTokenAddress, gatewayAddress, activatedBlock) {
  return {
    ...EMPTY_PROOF,
    status: "idle",
    officialTokenAddress,
    gatewayAddress,
    activatedBlock: String(activatedBlock),
  };
}

function sameBinding(current, officialTokenAddress, gatewayAddress, activatedBlock) {
  return current.officialTokenAddress?.toLowerCase() === officialTokenAddress.toLowerCase()
    && current.gatewayAddress?.toLowerCase() === gatewayAddress.toLowerCase()
    && current.activatedBlock === String(activatedBlock);
}

function failedProof(current, error, officialTokenAddress, gatewayAddress, activatedBlock) {
  const message = error?.message || "Holder Stock proof is unavailable";
  if (sameBinding(current, officialTokenAddress, gatewayAddress, activatedBlock)
    && current.selfBuyCount !== null) {
    return {
      ...current,
      status: "stale",
      stale: true,
      error: message,
    };
  }
  return {
    ...idleProof(officialTokenAddress, gatewayAddress, activatedBlock),
    status: "error",
    error: message,
  };
}

export function useHolderStockStats({
  open,
  officialTokenAddress,
  gatewayAddress,
  activatedBlock,
}) {
  const [proof, setProof] = useState(EMPTY_PROOF);
  const [refreshToken, setRefreshToken] = useState(0);
  const refresh = useCallback(() => setRefreshToken((value) => value + 1), []);

  useEffect(() => {
    if (!officialTokenAddress || !gatewayAddress || !activatedBlock) {
      setProof(EMPTY_PROOF);
      return undefined;
    }
    if (!open) {
      setProof((current) => {
        if (!sameBinding(current, officialTokenAddress, gatewayAddress, activatedBlock)) {
          return idleProof(officialTokenAddress, gatewayAddress, activatedBlock);
        }
        return current.status === "loading"
          ? idleProof(officialTokenAddress, gatewayAddress, activatedBlock)
          : current;
      });
      return undefined;
    }

    const controller = new AbortController();
    setProof((current) => ({
      ...(sameBinding(current, officialTokenAddress, gatewayAddress, activatedBlock)
        ? current
        : idleProof(officialTokenAddress, gatewayAddress, activatedBlock)),
      status: "loading",
      error: null,
    }));

    const load = async () => {
      try {
        const next = await loadHolderStockStats({
          signal: controller.signal,
          officialTokenAddress,
          gatewayAddress,
          activatedBlock,
        });
        if (!controller.signal.aborted) setProof(next);
      } catch (error) {
        if (!controller.signal.aborted && error?.name !== "AbortError") {
          setProof((current) => failedProof(
            current,
            error,
            officialTokenAddress,
            gatewayAddress,
            activatedBlock,
          ));
        }
      }
    };
    void load();
    return () => controller.abort();
  }, [open, officialTokenAddress, gatewayAddress, activatedBlock, refreshToken]);

  useEffect(() => {
    if (
      !["ready", "empty"].includes(proof.status)
      || !Number.isFinite(proof.updatedAt)
      || !Number.isFinite(MARKET.runtimeMaxAgeMs)
      || MARKET.runtimeMaxAgeMs <= 0
    ) {
      return undefined;
    }
    const remaining = Math.max(
      0,
      proof.updatedAt + MARKET.runtimeMaxAgeMs - Date.now(),
    );
    const timer = window.setTimeout(() => {
      setProof((current) => (
        current.updatedAt === proof.updatedAt && ["ready", "empty"].includes(current.status)
          ? { ...current, status: "stale", stale: true }
          : current
      ));
    }, Math.min(remaining + 1, 2_147_483_647));
    return () => window.clearTimeout(timer);
  }, [proof.status, proof.updatedAt]);

  return { ...proof, refresh };
}
