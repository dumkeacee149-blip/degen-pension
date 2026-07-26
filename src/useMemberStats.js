import { useEffect, useState } from "react";
import { MARKET } from "./config.js";
import { loadMemberStats } from "./memberStats.js";

const UNAVAILABLE_STATS = Object.freeze({
  status: "unavailable",
  memberCount: null,
  buyCount: null,
  memberNumber: null,
  recipient: null,
  asOfBlock: null,
  source: "none",
  checkedAt: null,
  stale: false,
  error: null,
});

function loadingStats(gatewayAddress, recipient) {
  return {
    ...UNAVAILABLE_STATS,
    status: "loading",
    gatewayAddress,
    recipient: recipient || null,
  };
}

function failedStats(current, error) {
  const message = error?.message || "Member index is unavailable";
  if (current.memberCount !== null && current.buyCount !== null) {
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

export function memberStatsBinding(runtime) {
  return runtime?.canonical?.gatewayAddress || MARKET.gatewayAddress || "";
}

export function useMemberStats(runtime, refreshToken = 0, recipient = "") {
  const [stats, setStats] = useState(UNAVAILABLE_STATS);
  const gatewayAddress = memberStatsBinding(runtime);
  const enabled = Boolean(gatewayAddress || MARKET.memberStatsEndpoint);
  const normalizedRecipient = String(recipient || "").trim().toLowerCase();

  useEffect(() => {
    if (!enabled) {
      setStats(UNAVAILABLE_STATS);
      return undefined;
    }

    const controller = new AbortController();
    setStats((current) => (
      (!gatewayAddress || current.gatewayAddress?.toLowerCase() === gatewayAddress.toLowerCase())
        && (current.recipient || "") === normalizedRecipient
        && current.memberCount !== null
        ? current
        : loadingStats(gatewayAddress, normalizedRecipient)
    ));

    const refresh = async () => {
      try {
        const next = await loadMemberStats({
          recipient: normalizedRecipient || undefined,
          gatewayAddress,
          signal: controller.signal,
        });
        if (!controller.signal.aborted) {
          setStats(next);
        }
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
  }, [enabled, gatewayAddress, normalizedRecipient, refreshToken]);

  return stats;
}
