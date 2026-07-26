import { useCallback, useEffect, useRef, useState } from "react";
import { MARKET, ROBINHOOD_CHAIN } from "./config.js";
import { blockedRuntimeState, loadRuntimeReadiness } from "./launchRuntime.js";

const initialState = MARKET.bootstrapConfigured
  ? {
      status: "checking",
      ready: false,
      reason: "Checking all production services and controls.",
      checks: {
        runtime: false,
        quote: false,
        eligibility: false,
        operations: false,
        audit: false,
      },
      checkedAt: null,
      expiresAt: null,
      limits: null,
    }
  : blockedRuntimeState(
      "Official CA, Gateway, activation block, and all production services and controls are required.",
    );

export function isAbortedRequest(error, signal) {
  return signal?.aborted === true || error?.name === "AbortError";
}

export function useRuntimeReadiness() {
  const [state, setState] = useState(initialState);
  const requestIdRef = useRef(0);
  const controllerRef = useRef(null);
  const lastCanonicalRef = useRef(initialState.canonical || null);

  const refresh = useCallback(async ({ quiet = false } = {}) => {
    if (!MARKET.bootstrapConfigured) {
      const blocked = blockedRuntimeState(
        "Official CA, Gateway, activation block, and all production services and controls are required.",
      );
      setState(blocked);
      return blocked;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    if (!quiet) {
      setState((current) => ({
        ...current,
        status: "checking",
        ready: false,
        reason: "Checking all production services and controls.",
      }));
    }

    try {
      const next = await loadRuntimeReadiness({
        market: MARKET,
        chain: ROBINHOOD_CHAIN,
        signal: controller.signal,
      });
      if (requestId === requestIdRef.current) {
        lastCanonicalRef.current = next.canonical || null;
        setState(next);
      }
      return next;
    } catch (error) {
      if (isAbortedRequest(error, controller.signal)) return null;
      const next = {
        status: "error",
        ready: false,
        reason: error?.message || "Runtime readiness check failed.",
        checks: {
          runtime: false,
          quote: false,
          eligibility: false,
          operations: false,
          audit: false,
        },
        checkedAt: null,
        expiresAt: null,
        limits: null,
        canonical: lastCanonicalRef.current,
      };
      if (requestId === requestIdRef.current) setState(next);
      return next;
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
    }
  }, []);

  useEffect(() => {
    void refresh();
    if (!MARKET.bootstrapConfigured) return undefined;

    const refreshQuietly = () => {
      void refresh({ quiet: true });
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") refreshQuietly();
    };
    window.addEventListener("online", refreshQuietly);
    document.addEventListener("visibilitychange", onVisibility);
    const interval = window.setInterval(refreshQuietly, MARKET.runtimeRefreshMs);

    return () => {
      requestIdRef.current += 1;
      controllerRef.current?.abort();
      window.removeEventListener("online", refreshQuietly);
      document.removeEventListener("visibilitychange", onVisibility);
      window.clearInterval(interval);
    };
  }, [refresh]);

  return { ...state, refresh };
}
