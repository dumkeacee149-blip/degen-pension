import { useEffect, useState } from "react";
import { MARKET } from "./config.js";
import { loadHolderStats } from "./holderStats.js";

const UNAVAILABLE_STATS = Object.freeze({
  status: "unavailable",
  holderCount: null,
  source: "none",
  updatedAt: null,
  checkedAt: null,
  officialTokenAddress: null,
  stale: false,
  error: null,
});

function loadingStats(officialTokenAddress) {
  return {
    ...UNAVAILABLE_STATS,
    status: "loading",
    officialTokenAddress,
  };
}

function failedStats(current, error) {
  const message = error?.message || "Holder index is unavailable";
  if (current.holderCount !== null) {
    return {
      ...current,
      status: "stale",
      stale: true,
      error: message,
    };
  }
  return {
    ...UNAVAILABLE_STATS,
    status: "error",
    error: message,
  };
}

export function holderStatsBinding(runtime) {
  return runtime?.canonical?.officialTokenAddress
    || (MARKET.tokenConfigured ? MARKET.officialTokenAddress : "");
}

export function useHolderStats(runtime, refreshToken = 0) {
  const [stats, setStats] = useState(UNAVAILABLE_STATS);
  const officialTokenAddress = holderStatsBinding(runtime);
  const enabled = Boolean(officialTokenAddress && MARKET.holderStatsEndpoint);

  useEffect(() => {
    if (!enabled) {
      setStats(UNAVAILABLE_STATS);
      return undefined;
    }

    const controller = new AbortController();
    setStats((current) => (
      (!officialTokenAddress
        || current.officialTokenAddress?.toLowerCase() === officialTokenAddress.toLowerCase())
        && current.holderCount !== null
        ? current
        : loadingStats(officialTokenAddress)
    ));

    const refresh = async () => {
      try {
        const next = await loadHolderStats({
          officialTokenAddress,
          signal: controller.signal,
        });
        if (!controller.signal.aborted) setStats(next);
      } catch (error) {
        if (!controller.signal.aborted && error?.name !== "AbortError") {
          setStats((current) => failedStats(current, error));
        }
      }
    };

    void refresh();
    const interval = window.setInterval(() => {
      void refresh();
    }, 60_000);
    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, [enabled, officialTokenAddress, refreshToken]);

  return stats;
}
