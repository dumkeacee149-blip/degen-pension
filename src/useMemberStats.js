import { useEffect, useState } from "react";
import { MARKET } from "./config.js";
import { loadMemberStats } from "./memberStats.js";

const EMPTY_STATS = MARKET.marketReady
  ? { status: "loading", memberCount: null, buyCount: null, asOfBlock: null, source: "none" }
  : { status: "prelaunch", memberCount: null, buyCount: null, asOfBlock: null, source: "none" };

export function useMemberStats() {
  const [stats, setStats] = useState(EMPTY_STATS);

  useEffect(() => {
    if (!MARKET.marketReady) return undefined;
    const controller = new AbortController();

    const refresh = async () => {
      try {
        const next = await loadMemberStats({ signal: controller.signal });
        setStats(next);
      } catch (error) {
        if (error?.name !== "AbortError") {
          setStats((current) => current.status === "ready"
            ? { ...current, stale: true }
            : { status: "error", memberCount: null, buyCount: null, asOfBlock: null, source: "none" });
        }
      }
    };

    refresh();
    const interval = window.setInterval(refresh, 60_000);
    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, []);

  return stats;
}
