import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  ArrowClockwise,
  ChartLineUp,
  Cloud,
  Cpu,
  DeviceMobile,
  Hexagon,
  ShareNetwork,
  Wallet,
  X,
} from "@phosphor-icons/react";
import { MARKET, ROBINHOOD_CHAIN as CHAIN } from "./config.js";
import {
  normalizeAddress,
  normalizeChainId,
  parseEthToWei,
  requestAndValidateQuote,
  requestEligibility,
  waitForTransactionReceipt,
} from "./launchRuntime.js";
import { loadMemberStats } from "./memberStats.js";
import { useHolderStats } from "./useHolderStats.js";
import { useMemberStats } from "./useMemberStats.js";
import { useRuntimeReadiness } from "./useRuntimeReadiness.js";

const CodePage = lazy(() => import("./CodePage.jsx"));
const FlowPage = lazy(() => import("./FlowPage.jsx"));
const DeployPage = lazy(() => import("./DeployPage.jsx"));
const SandboxPage = lazy(() => import("./SandboxPage.jsx"));

function RouteFallback() {
  return (
    <main className="route-fallback" aria-busy="true" aria-live="polite">
      OPENING VERIFIED RECORD…
    </main>
  );
}

function shortAddress(value) {
  if (!value) return "";
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function useDialogA11y({ open, dialogRef, triggerRef, onClose }) {
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return undefined;
    const lastFocused = document.activeElement;
    const background = [
      document.querySelector(".home-header"),
      document.querySelector(".home-main"),
      document.querySelector(".home-footer"),
    ].filter(Boolean);
    const previousOverflow = document.body.style.overflow;
    background.forEach((element) => {
      element.inert = true;
      element.setAttribute("aria-hidden", "true");
    });
    document.body.style.overflow = "hidden";

    const focusableSelector = [
      "button:not([disabled])",
      "a[href]",
      "input:not([disabled])",
      "[tabindex]:not([tabindex='-1'])",
    ].join(",");
    const focusDialog = window.requestAnimationFrame(() => {
      dialogRef.current?.querySelector(focusableSelector)?.focus();
    });
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current?.();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll(focusableSelector)]
        .filter((element) => !element.hidden && element.getClientRects().length > 0);
      if (!focusable.length) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(focusDialog);
      window.removeEventListener("keydown", onKeyDown);
      background.forEach((element) => {
        element.inert = false;
        element.removeAttribute("aria-hidden");
      });
      document.body.style.overflow = previousOverflow;
      const focusTarget = lastFocused?.isConnected
        ? lastFocused
        : triggerRef.current?.isConnected
          ? triggerRef.current
          : null;
      focusTarget?.focus();
    };
  }, [open, dialogRef, triggerRef]);
}

function splitAmount(value, ratio, explicitFeeBps = MARKET.explicitFeeBps) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return "0.0000";
  const safeFeeBps = Number.isInteger(explicitFeeBps) && explicitFeeBps >= 0
    ? explicitFeeBps
    : 0;
  const net = number * (1 - safeFeeBps / 10_000);
  const result = net * ratio;
  return result < 0.0001 ? "<0.0001" : result.toFixed(4);
}

function formatEthAmount(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return "0.0000";
  return number < 0.0001 ? "<0.0001" : number.toFixed(4);
}

function validateAmount(value, limits) {
  if (!value) return { valid: false, message: "ENTER AN AMOUNT TO CONTINUE.", wei: null };
  try {
    const wei = parseEthToWei(value);
    if (limits?.minAmountInWei && wei < limits.minAmountInWei) {
      return { valid: false, message: "AMOUNT IS BELOW THE VERIFIED MARKET MINIMUM.", wei };
    }
    if (limits?.maxAmountInWei && wei > limits.maxAmountInWei) {
      return { valid: false, message: "AMOUNT IS ABOVE THE VERIFIED MARKET MAXIMUM.", wei };
    }
    return { valid: true, message: "", wei };
  } catch (error) {
    return { valid: false, message: String(error?.message || "ENTER A VALID ETH AMOUNT.").toUpperCase(), wei: null };
  }
}

function sanitizeAmount(value) {
  const clean = value.replace(/[^0-9.]/g, "");
  const [whole, ...fraction] = clean.split(".");
  return fraction.length ? `${whole}.${fraction.join("").slice(0, 18)}` : whole;
}

const BUSY_ACTION_STATES = new Set([
  "connecting",
  "checking-eligibility",
  "switching-chain",
  "quoting",
  "submitting",
  "confirming",
]);

function actionLabel(state, hasAmount) {
  if (state === "connecting") return "CONNECTING WALLET...";
  if (state === "checking-eligibility") return "CHECKING ELIGIBILITY...";
  if (state === "switching-chain") return "SWITCHING NETWORK...";
  if (state === "quoting") return "VERIFYING QUOTE...";
  if (state === "submitting") return "OPENING WALLET...";
  if (state === "confirming") return "CONFIRMING ONCHAIN...";
  return hasAmount ? "CONNECT, CHECK & CONFIRM" : "ENTER AMOUNT";
}

function runtimeMessage(runtime) {
  if (!MARKET.bootstrapConfigured) {
    return "MARKET BLOCKED · ONE OR MORE REQUIRED PRODUCTION SERVICES OR CONTROLS ARE NOT CONFIGURED.";
  }
  if (runtime.status === "checking") {
    return "PRODUCTION CHECKS RUNNING · NO WALLET REQUEST YET.";
  }
  if (!runtime.ready) {
    return `MARKET BLOCKED · ${String(runtime.reason || "A REQUIRED SAFETY CHECK FAILED.").toUpperCase()}`;
  }
  return "MARKET CONTROLS AND QUOTE ROUTE ARE READY. AN EXACT QUOTE AND FULL SIMULATION RUN ONLY AFTER AMOUNT AND ELIGIBILITY CHECKS.";
}

function eligibilityMessage(eligibility) {
  if (eligibility.status === "eligible") {
    return `ELIGIBLE · ${eligibility.countryCode} · PROOF EXPIRES SOON`;
  }
  if (eligibility.status === "ineligible") {
    return `NOT ELIGIBLE · ${String(eligibility.reason || "THE ELIGIBILITY SERVICE DECLINED THIS WALLET.").toUpperCase()}`;
  }
  if (eligibility.status === "checking") return "CHECKING WALLET ELIGIBILITY...";
  return "ELIGIBILITY: CHECKED AFTER WALLET CONNECTION. STOCK-TOKEN ACCESS MAY BE RESTRICTED.";
}

function getPublicStage(stats) {
  if (stats.status === "prelaunch" || stats.status === "unavailable") {
    return {
      key: "prelaunch",
      headline: ["YOUR WORST", "FINANCIAL DECISION"],
      accent: "NEEDS 1% ADULT SUPERVISION.",
      subline: "BUY THE MEME. ROUTE 1% TO QQQ. PRINT THE RECEIPT.",
      form: "CURRENT FORM: UNEMPLOYED ACCOUNTANT",
      milestone: "FIRST OFFICIAL RECEIPT OPENS THE WALL",
      art: "/assets/raccoon-deadpan-v2.webp",
    };
  }
  if (stats.status === "loading") {
    return {
      key: "loading",
      headline: ["YOUR BAD DECISION", "IS BEING"],
      accent: "AUDITED BY A RACCOON.",
      subline: "READING THE OFFICIAL TOKEN HOLDER COUNT FROM THE CHAIN.",
      form: "CURRENT FORM: COUNTING THE DAMAGE",
      milestone: "NEXT OFFICE UPGRADE AT 100 MEMBERS",
      art: "/assets/raccoon-ledger-v1.webp",
    };
  }
  if (stats.status === "error") {
    return {
      key: "error",
      headline: ["THE CHAIN SAID", "BE RIGHT"],
      accent: "BACK.",
      subline: "THE COUNTER IS OFFLINE. THE BUY ROUTE IS SEPARATE.",
      form: "CURRENT FORM: TECH SUPPORT VICTIM",
      milestone: "HOLDER COUNT RETURNS WITH THE INDEX",
      art: "/assets/raccoon-overtime-v1.webp",
    };
  }

  const count = stats.holderCount || 0;
  if (count === 0) {
    return {
      key: stats.status === "stale" ? "stale" : "empty",
      headline: ["THE PENSION WALL", "IS PAINFULLY"],
      accent: "EMPTY.",
      subline: stats.status === "stale"
        ? "THE LAST CONFIRMED COUNT IS SHOWN WHILE THE INDEX RECOVERS."
        : "THE COUNTER MOVES WHEN THE OFFICIAL TOKEN GAINS HOLDERS.",
      form: "CURRENT FORM: EMPTY OFFICE",
      milestone: "CLAIM THE FIRST ONCHAIN RECEIPT",
      art: "/assets/raccoon-deadpan-v2.webp",
    };
  }
  if (count < 100) {
    return {
      key: stats.status === "stale" ? "stale" : "growing",
      headline: [`${count.toLocaleString("en-US")} BAD DECISIONS.`, "ONE GROWING"],
      accent: "PENSION WALL.",
      subline: "THE RACCOON CHANGES JOBS AS THE OFFICIAL TOKEN GAINS HOLDERS.",
      form: "CURRENT FORM: JUNIOR BOOKKEEPER",
      milestone: `${100 - count} MORE HOLDERS UNTIL THE OFFICE UPGRADE`,
      art: "/assets/raccoon-watch-chart-v1.webp",
    };
  }
  return {
    key: stats.status === "stale" ? "stale" : "crowded",
    headline: ["THE GROUP CHAT", "HAS A PENSION"],
    accent: "DEPARTMENT NOW.",
    subline: `${count.toLocaleString("en-US")} WALLETS CURRENTLY HOLD THE OFFICIAL TOKEN.`,
    form: "CURRENT FORM: ABSOLUTELY EMPLOYED",
    milestone: "THE NEXT UPGRADE IS DECIDED BY THE CROWD",
    art: "/assets/raccoon-reluctant-celebration-v1.webp",
  };
}

function Brand({ compact = false }) {
  return (
    <a className={`brand${compact ? " brand-compact" : ""}`} href="/" aria-label="Degen Pension home">
      <img src="/brand/mark-99-1-v2.webp" alt="" />
      <span>DEGEN PENSION</span>
      <b>401KEK</b>
    </a>
  );
}

function NetworkLabel() {
  return (
    <span className="network-label">
      <Hexagon size={24} weight="fill" aria-hidden="true" />
      ROBINHOOD CHAIN
    </span>
  );
}

function HomePage() {
  const [statsRefreshToken, setStatsRefreshToken] = useState(0);
  const runtime = useRuntimeReadiness();
  const holderStats = useHolderStats(runtime, statsRefreshToken);
  const stats = useMemberStats(runtime, statsRefreshToken);
  const stage = getPublicStage(holderStats);
  const [amount, setAmount] = useState("");
  const [isBuySheetOpen, setIsBuySheetOpen] = useState(false);
  const [actionState, setActionState] = useState("idle");
  const [actionMessage, setActionMessage] = useState("");
  const [submittedHash, setSubmittedHash] = useState("");
  const [receiptWallet, setReceiptWallet] = useState("");
  const [receiptGateway, setReceiptGateway] = useState("");
  const [receiptConfirmedBlock, setReceiptConfirmedBlock] = useState(null);
  const [receiptMemberNumber, setReceiptMemberNumber] = useState(null);
  const [receiptMemberStatus, setReceiptMemberStatus] = useState("idle");
  const [receiptMemberMessage, setReceiptMemberMessage] = useState("");
  const [walletAccount, setWalletAccount] = useState("");
  const [walletChainId, setWalletChainId] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [notUSPerson, setNotUSPerson] = useState(false);
  const [eligibility, setEligibility] = useState({
    status: "unverified",
    reason: "",
    countryCode: "",
    expiresAt: null,
  });
  const [shareLabel, setShareLabel] = useState("SHARE THE BAD PLAN");
  const submitLockRef = useRef(false);
  const activeOperationRef = useRef(null);
  const flowWalletRef = useRef("");
  const expectedChainRef = useRef("");
  const submittedHashRef = useRef("");
  const receiptVerificationRef = useRef(null);
  const buyDialogRef = useRef(null);
  const buyTriggerRef = useRef(null);
  const isBusyRef = useRef(false);
  const actionStateRef = useRef("idle");
  const isBusy = BUSY_ACTION_STATES.has(actionState);
  const runtimeReady = MARKET.bootstrapConfigured && runtime.ready;
  const officialTokenAddress = runtime.canonical?.officialTokenAddress || "";
  const previewFeeBps = runtime.canonical?.explicitFeeBps ?? MARKET.explicitFeeBps ?? 0;
  const showMemberTicket = runtimeReady
    && ["ready", "empty", "stale"].includes(stats.status)
    && stats.memberCount !== null;
  const amountValidation = useMemo(
    () => validateAmount(amount, runtime.limits),
    [amount, runtime.limits],
  );
  const hasAmount = amount !== "";
  const grossAmount = hasAmount ? Number(amount) : 0;
  const feeAmount = grossAmount * (previewFeeBps / 10_000);
  const netAmount = Math.max(0, grossAmount - feeAmount);
  const canBuy = runtimeReady
    && amountValidation.valid
    && termsAccepted
    && notUSPerson
    && !isBusy;
  const receiptFailed = Boolean(submittedHash) && actionState === "error";

  const closeBuyDialog = () => {
    if (actionStateRef.current === "submitting") return;
    if (isBusyRef.current && !submittedHashRef.current) {
      activeOperationRef.current?.abort();
      activeOperationRef.current = null;
      submitLockRef.current = false;
    }
    setIsBuySheetOpen(false);
  };
  useDialogA11y({
    open: isBuySheetOpen,
    dialogRef: buyDialogRef,
    triggerRef: buyTriggerRef,
    onClose: closeBuyDialog,
  });
  useEffect(() => {
    document.title = "DEGEN PENSION - 99% APE. 1% ADULT.";
  }, []);

  useEffect(() => {
    isBusyRef.current = isBusy;
    actionStateRef.current = actionState;
  }, [actionState, isBusy]);

  useEffect(() => {
    const ethereum = window.ethereum;
    if (!ethereum?.request) return undefined;
    let disposed = false;

    const interruptOperation = (message) => {
      activeOperationRef.current?.abort();
      activeOperationRef.current = null;
      expectedChainRef.current = "";
      flowWalletRef.current = "";
      submitLockRef.current = false;
      setEligibility({ status: "unverified", reason: "", countryCode: "", expiresAt: null });
      if (submittedHashRef.current) {
        setActionState("pending");
        setActionMessage(`${message} THE SUBMITTED RECEIPT REMAINS AVAILABLE IN THE EXPLORER.`);
      } else {
        setActionState("error");
        setActionMessage(message);
      }
    };

    const onAccountsChanged = (accounts) => {
      const nextAccount = Array.isArray(accounts) && accounts[0] ? String(accounts[0]) : "";
      setWalletAccount(nextAccount);
      setEligibility({ status: "unverified", reason: "", countryCode: "", expiresAt: null });
      if (
        flowWalletRef.current
        && (!nextAccount || nextAccount.toLowerCase() !== flowWalletRef.current)
      ) {
        interruptOperation("WALLET ACCOUNT CHANGED. THE ACTIVE QUOTE WAS DISCARDED.");
      }
    };

    const onChainChanged = (nextChainId) => {
      const normalized = String(nextChainId || "").toLowerCase();
      setWalletChainId(normalized);
      if (expectedChainRef.current && normalized === expectedChainRef.current) {
        expectedChainRef.current = "";
        return;
      }
      if (flowWalletRef.current && normalized !== CHAIN.chainId) {
        interruptOperation("WALLET NETWORK CHANGED. THE ACTIVE QUOTE WAS DISCARDED.");
      }
    };

    const onDisconnect = () => {
      setWalletAccount("");
      setWalletChainId("");
      interruptOperation("WALLET DISCONNECTED. NO NEW TRANSACTION WAS REQUESTED.");
    };

    Promise.all([
      ethereum.request({ method: "eth_accounts" }),
      ethereum.request({ method: "eth_chainId" }),
    ]).then(([accounts, chainId]) => {
      if (disposed) return;
      setWalletAccount(accounts?.[0] || "");
      setWalletChainId(String(chainId || "").toLowerCase());
    }).catch(() => {});

    ethereum.on?.("accountsChanged", onAccountsChanged);
    ethereum.on?.("chainChanged", onChainChanged);
    ethereum.on?.("disconnect", onDisconnect);
    return () => {
      disposed = true;
      activeOperationRef.current?.abort();
      ethereum.removeListener?.("accountsChanged", onAccountsChanged);
      ethereum.removeListener?.("chainChanged", onChainChanged);
      ethereum.removeListener?.("disconnect", onDisconnect);
    };
  }, []);

  useEffect(() => {
    const onOffline = () => {
      if (!submitLockRef.current) return;
      activeOperationRef.current?.abort();
      activeOperationRef.current = null;
      submitLockRef.current = false;
      if (submittedHashRef.current) {
        setActionState("pending");
        setActionMessage("YOU ARE OFFLINE. THE TRANSACTION WAS SUBMITTED; CHECK THE EXPLORER WHEN CONNECTION RETURNS.");
      } else {
        setActionState("error");
        setActionMessage("YOU ARE OFFLINE. ELIGIBILITY AND QUOTE REQUESTS WERE CANCELLED.");
      }
    };
    window.addEventListener("offline", onOffline);
    return () => window.removeEventListener("offline", onOffline);
  }, []);

  useEffect(() => {
    if (
      actionState !== "success"
      || !receiptWallet
      || !receiptGateway
      || !Number.isSafeInteger(receiptConfirmedBlock)
      || !submittedHash
    ) return undefined;
    const controller = new AbortController();
    let interval;
    const refreshMemberRecord = async () => {
      try {
        const next = await loadMemberStats({
          signal: controller.signal,
          recipient: receiptWallet,
          gatewayAddress: receiptGateway,
        });
        if (next.memberNumber && next.asOfBlock >= receiptConfirmedBlock) {
          setReceiptMemberNumber(next.memberNumber);
          setReceiptMemberStatus("ready");
          setReceiptMemberMessage(`CANONICAL MEMBER INDEX VERIFIED THROUGH BLOCK ${next.asOfBlock}.`);
          if (interval) window.clearInterval(interval);
          return;
        }
        setReceiptMemberNumber(null);
        setReceiptMemberStatus("indexing");
        setReceiptMemberMessage(
          next.asOfBlock < receiptConfirmedBlock
            ? `MEMBER INDEX IS AT BLOCK ${next.asOfBlock}; RECEIPT CONFIRMED AT ${receiptConfirmedBlock}.`
            : "CONFIRMED RECEIPT FOUND. CANONICAL MEMBER NUMBER HAS NOT BEEN INDEXED YET.",
        );
      } catch (error) {
        if (error?.name !== "AbortError") {
          setReceiptMemberNumber(null);
          setReceiptMemberStatus("unavailable");
          setReceiptMemberMessage("MEMBER INDEX UNAVAILABLE. THE CONFIRMED ONCHAIN RECEIPT REMAINS VERIFIABLE.");
        }
      }
    };
    setReceiptMemberStatus("indexing");
    setReceiptMemberMessage("WAITING FOR THE CONFIRMED MEMBER INDEX TO REACH THIS RECEIPT.");
    void refreshMemberRecord();
    interval = window.setInterval(refreshMemberRecord, 15_000);
    return () => {
      controller.abort();
      if (interval) window.clearInterval(interval);
    };
  }, [actionState, receiptConfirmedBlock, receiptGateway, receiptWallet, submittedHash]);

  const acceptConfirmedReceipt = (confirmedReceipt, transactionHash) => {
    let confirmedBlock;
    try {
      confirmedBlock = Number(BigInt(confirmedReceipt.blockNumber));
    } catch {
      confirmedBlock = null;
    }
    if (!Number.isSafeInteger(confirmedBlock) || confirmedBlock <= 0) {
      const invalidReceipt = new Error("Confirmed receipt block is invalid.");
      invalidReceipt.code = "INVALID_RECEIPT";
      throw invalidReceipt;
    }
    setReceiptConfirmedBlock(confirmedBlock);
    setReceiptMemberStatus("indexing");
    setReceiptMemberMessage("WAITING FOR THE CONFIRMED MEMBER INDEX TO REACH THIS RECEIPT.");
    setActionState("success");
    setActionMessage(`CONFIRMED ${shortAddress(transactionHash)}. BOTH LEGS SETTLED OR NEITHER.`);
    setStatsRefreshToken((value) => value + 1);
    void runtime.refresh({ quiet: true });
  };

  const buy = async () => {
    if (!canBuy || submitLockRef.current) return;
    setActionMessage("");
    if (!window.ethereum?.request) {
      setActionState("error");
      setActionMessage("NO BROWSER WALLET FOUND. THE PAGE NEVER CONNECTS UNTIL YOU PRESS BUY.");
      return;
    }
    if (navigator.onLine === false) {
      setActionState("error");
      setActionMessage("YOU ARE OFFLINE. MARKET, ELIGIBILITY, AND QUOTE CHECKS CANNOT RUN.");
      return;
    }

    submitLockRef.current = true;
    submittedHashRef.current = "";
    setSubmittedHash("");
    setReceiptWallet("");
    setReceiptGateway("");
    setReceiptConfirmedBlock(null);
    setReceiptMemberNumber(null);
    setReceiptMemberStatus("idle");
    setReceiptMemberMessage("");
    receiptVerificationRef.current = null;
    const controller = new AbortController();
    activeOperationRef.current?.abort();
    activeOperationRef.current = controller;
    const throwIfInterrupted = () => {
      if (controller.signal.aborted || activeOperationRef.current !== controller) {
        const error = new Error("Purchase was interrupted before wallet submission.");
        error.code = "ABORTED";
        throw error;
      }
    };
    try {
      setActionState("connecting");
      const liveRuntime = await runtime.refresh();
      throwIfInterrupted();
      if (!liveRuntime?.ready) {
        throw new Error(liveRuntime?.reason || "One or more production checks are not ready.");
      }

      const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
      throwIfInterrupted();
      const wallet = normalizeAddress(accounts?.[0], "Connected wallet");
      if (!wallet) throw new Error("Wallet connection was cancelled.");
      flowWalletRef.current = wallet;
      setWalletAccount(wallet);

      setActionState("checking-eligibility");
      setEligibility({ status: "checking", reason: "", countryCode: "", expiresAt: null });
      const eligibilityResult = await requestEligibility({
        market: MARKET,
        chain: CHAIN,
        wallet,
        termsAccepted,
        notUSPerson,
        signal: controller.signal,
      });
      throwIfInterrupted();
      if (!eligibilityResult.eligible) {
        setEligibility({
          status: "ineligible",
          reason: eligibilityResult.reason,
          countryCode: eligibilityResult.countryCode,
          expiresAt: eligibilityResult.expiresAt,
        });
        throw new Error(eligibilityResult.reason || "This wallet is not eligible for the stock-token route.");
      }
      setEligibility({
        status: "eligible",
        reason: eligibilityResult.reason,
        countryCode: eligibilityResult.countryCode,
        expiresAt: eligibilityResult.expiresAt,
      });

      const currentChain = await window.ethereum.request({ method: "eth_chainId" });
      if (normalizeChainId(currentChain) !== CHAIN.chainIdDecimal) {
        setActionState("switching-chain");
        expectedChainRef.current = CHAIN.chainId;
        try {
          await window.ethereum.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: CHAIN.chainId }],
          });
        } catch (switchError) {
          if (switchError?.code !== 4902) throw switchError;
          await window.ethereum.request({ method: "wallet_addEthereumChain", params: [CHAIN] });
          const addedChain = await window.ethereum.request({ method: "eth_chainId" });
          if (normalizeChainId(addedChain) !== CHAIN.chainIdDecimal) {
            await window.ethereum.request({
              method: "wallet_switchEthereumChain",
              params: [{ chainId: CHAIN.chainId }],
            });
          }
        } finally {
          expectedChainRef.current = "";
        }
      }
      throwIfInterrupted();

      const [accountsBeforeQuote, chainBeforeQuote] = await Promise.all([
        window.ethereum.request({ method: "eth_accounts" }),
        window.ethereum.request({ method: "eth_chainId" }),
      ]);
      throwIfInterrupted();
      if (
        normalizeAddress(accountsBeforeQuote?.[0], "Active wallet") !== wallet
        || normalizeChainId(chainBeforeQuote) !== CHAIN.chainIdDecimal
      ) {
        throw new Error("Wallet account or network changed before quote.");
      }

      setActionState("quoting");
      const executableQuote = await requestAndValidateQuote({
        market: MARKET,
        chain: CHAIN,
        wallet,
        amountEth: amount,
        runtime: liveRuntime,
        termsAccepted,
        notUSPerson,
        signal: controller.signal,
      });
      throwIfInterrupted();
      const [accountsBeforeSend, chainBeforeSend] = await Promise.all([
        window.ethereum.request({ method: "eth_accounts" }),
        window.ethereum.request({ method: "eth_chainId" }),
      ]);
      throwIfInterrupted();
      const now = Date.now();
      if (
        normalizeAddress(accountsBeforeSend?.[0], "Active wallet") !== wallet
        || normalizeChainId(chainBeforeSend) !== CHAIN.chainIdDecimal
        || eligibilityResult.expiresAt <= now + 5_000
        || liveRuntime.expiresAt <= now + 5_000
        || executableQuote.expiresAt <= now + 5_000
      ) {
        throw new Error("Wallet, eligibility, runtime, or quote changed before submission.");
      }

      throwIfInterrupted();
      setActionState("submitting");
      actionStateRef.current = "submitting";
      const transactionHash = await window.ethereum.request({
        method: "eth_sendTransaction",
        params: [{
          from: wallet,
          to: executableQuote.transaction.to,
          data: executableQuote.transaction.data,
          value: executableQuote.transaction.value,
        }],
      });
      if (!/^0x[a-fA-F0-9]{64}$/.test(String(transactionHash || ""))) {
        throw new Error("Wallet returned an invalid transaction hash.");
      }
      submittedHashRef.current = transactionHash;
      const receiptConfirmations = liveRuntime.limits?.confirmations || MARKET.confirmations || 1;
      receiptVerificationRef.current = {
        wallet,
        gatewayAddress: liveRuntime.canonical.gatewayAddress,
        transaction: executableQuote.transaction,
        confirmations: receiptConfirmations,
      };
      setSubmittedHash(transactionHash);
      setReceiptWallet(wallet);
      setReceiptGateway(liveRuntime.canonical.gatewayAddress);
      setActionState("confirming");
      actionStateRef.current = "confirming";
      setActionMessage(`SUBMITTED ${shortAddress(transactionHash)}. WAITING FOR THE ATOMIC RECEIPT.`);

      const confirmedReceipt = await waitForTransactionReceipt({
        rpcUrl: CHAIN.rpcUrls[0],
        hash: transactionHash,
        gatewayAddress: liveRuntime.canonical.gatewayAddress,
        wallet,
        transaction: executableQuote.transaction,
        confirmations: receiptConfirmations,
        signal: controller.signal,
        timeoutMs: MARKET.receiptTimeoutMs,
      });
      acceptConfirmedReceipt(confirmedReceipt, transactionHash);
    } catch (error) {
      const confirmedFailure = ["TRANSACTION_REVERTED", "INVALID_RECEIPT", "INVALID_HASH"]
        .includes(error?.code);
      const pending = Boolean(submittedHashRef.current) && !confirmedFailure;
      setActionState(pending ? "pending" : "error");
      const fallback = error?.code === 4001
        ? "Wallet request was cancelled."
        : error?.message || "Transaction cancelled.";
      setActionMessage(
        pending
          ? `${String(fallback).toUpperCase()} THE SUBMITTED HASH IS STILL AVAILABLE BELOW.`
          : String(fallback).toUpperCase(),
      );
    } finally {
      if (activeOperationRef.current === controller) activeOperationRef.current = null;
      expectedChainRef.current = "";
      flowWalletRef.current = "";
      submitLockRef.current = false;
    }
  };

  const recheckReceipt = async () => {
    if (actionState !== "pending" || submitLockRef.current || !submittedHash) return;
    const binding = receiptVerificationRef.current;
    if (!binding) {
      setActionState("error");
      setActionMessage("THE ORIGINAL QUOTE BINDING IS UNAVAILABLE. THIS HASH CANNOT UNLOCK A RECEIPT.");
      return;
    }
    if (navigator.onLine === false) {
      setActionMessage("YOU ARE OFFLINE. THE HASH REMAINS PENDING UNTIL THE STRICT RECEIPT CHECK CAN RUN AGAIN.");
      return;
    }

    submitLockRef.current = true;
    const controller = new AbortController();
    activeOperationRef.current?.abort();
    activeOperationRef.current = controller;
    setActionState("confirming");
    setActionMessage(`RECHECKING ${shortAddress(submittedHash)} AGAINST THE ORIGINAL WALLET AND EXACT QUOTE.`);
    try {
      const confirmedReceipt = await waitForTransactionReceipt({
        rpcUrl: CHAIN.rpcUrls[0],
        hash: submittedHash,
        gatewayAddress: binding.gatewayAddress,
        wallet: binding.wallet,
        transaction: binding.transaction,
        confirmations: binding.confirmations,
        signal: controller.signal,
        timeoutMs: MARKET.receiptTimeoutMs,
      });
      acceptConfirmedReceipt(confirmedReceipt, submittedHash);
    } catch (error) {
      const confirmedFailure = ["TRANSACTION_REVERTED", "INVALID_RECEIPT", "INVALID_HASH"]
        .includes(error?.code);
      setActionState(confirmedFailure ? "error" : "pending");
      setActionMessage(
        confirmedFailure
          ? String(error?.message || "THE SUBMITTED HASH FAILED STRICT RECEIPT VERIFICATION.").toUpperCase()
          : `${String(error?.message || "CONFIRMATION IS STILL PENDING.").toUpperCase()} CHECK AGAIN WITHOUT RESUBMITTING.`,
      );
    } finally {
      if (activeOperationRef.current === controller) activeOperationRef.current = null;
      submitLockRef.current = false;
    }
  };

  const shareReceipt = async () => {
    if (!submittedHash) return;
    if (actionState !== "success") {
      setActionMessage("SHARING UNLOCKS ONLY AFTER THE OFFICIAL GATEWAY RECEIPT REACHES THE REQUIRED CONFIRMATIONS.");
      return;
    }
    const explorerUrl = `${CHAIN.blockExplorerUrls[0]}/tx/${submittedHash}`;
    const memberText = receiptMemberStatus === "ready" && receiptMemberNumber
      ? ` Official member #${receiptMemberNumber}.`
      : "";
    const receiptText = `My confirmed 99/1 pension receipt: 99% $401KEK, 1% QQQ.${memberText} ${explorerUrl}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: "DEGEN PENSION RECEIPT", text: receiptText });
      } else {
        await navigator.clipboard.writeText(receiptText);
      }
      setActionMessage(
        receiptMemberStatus === "ready" && receiptMemberNumber
          ? `CONFIRMED RECEIPT #${receiptMemberNumber} SHARED.`
          : "CONFIRMED RECEIPT SHARED. NO MEMBER NUMBER WAS PRINTED WITHOUT A CURRENT CANONICAL INDEX.",
      );
    } catch (error) {
      if (error?.name !== "AbortError") setActionMessage("COULD NOT SHARE. THE EXPLORER LINK IS STILL AVAILABLE BELOW.");
    }
  };

  const sharePlan = async () => {
    const text = runtimeReady
      ? "A retirement plan for people who buy meme coins: 99% $401KEK, 1% QQQ. 99% APE. 1% ADULT."
      : MARKET.releaseManifestActive
        ? "The 99/1 market is recorded onchain, but public release gates are still blocked: 99% $401KEK, 1% QQQ."
        : "A pre-launch 99/1 split-buy idea: 99% $401KEK, 1% QQQ. Market not active. 99% APE. 1% ADULT.";
    const shareData = {
      title: "DEGEN PENSION",
      text,
      url: window.location.origin,
    };

    try {
      if (navigator.share) {
        await navigator.share(shareData);
        setShareLabel("PLAN SHARED");
      } else {
        await navigator.clipboard.writeText(`${shareData.text} ${shareData.url}`);
        setShareLabel("PLAN COPIED");
      }
    } catch (error) {
      if (error?.name !== "AbortError") setShareLabel("COPY FAILED");
    }

    window.setTimeout(() => setShareLabel("SHARE THE BAD PLAN"), 1800);
  };

  const defaultActionMessage = `${runtimeMessage(runtime)} ${eligibilityMessage(eligibility)}`;

  return (
    <div className={`home-page stage-${stage.key}`}>
      <header className="home-header">
        <Brand />
        <div className="home-header-right"><NetworkLabel /></div>
      </header>

      <main className="home-main">
        <section className="reaction-stage" aria-live="polite">
          <h1>
            {stage.headline.map((line) => <span key={line}>{line}</span>)}
            <em>{stage.accent}</em>
          </h1>
          <p className="stage-subline">{stage.subline}</p>
          <div className={`hero-ca${officialTokenAddress ? " hero-ca-live" : ""}`}>
            <span>CA:</span>
            <code>{officialTokenAddress || "PENDING"}</code>
          </div>
          <div className="raccoon-media">
            <img className="raccoon-art" src={stage.art} alt="The tired deadpan office raccoon reacting to the current official member stage" />
            <span className="raccoon-form">{stage.form}</span>
          </div>
        </section>

        <div className="buy-stack">
          <section className={`buy-panel buy-panel-preview${showMemberTicket ? "" : " buy-panel-prelaunch"}`} aria-labelledby="buy-panel-title">
            <div className="buy-panel-title" id="buy-panel-title">
              <span>YOUR 99/1 RECEIPT</span>
              <b>{runtimeReady
                ? "ONCHAIN"
                : MARKET.releaseManifestActive
                  ? "BUY ROUTE BLOCKED"
                  : "MARKET NOT ACTIVE"}</b>
            </div>

            {showMemberTicket ? (
              <div className="member-ticket">
                <span>OFFICIAL MEMBERS</span>
                <strong>{stats.memberCount.toLocaleString("en-US")}</strong>
                <small>
                  CANONICAL UNIQUE RECIPIENTS IN CONFIRMED OFFICIAL SPLITBUY EVENTS
                  {stats.status === "stale" ? " · DATA STALE" : ""}
                </small>
              </div>
            ) : null}

            <div className="allocation allocation-project">
              <div><strong>99%</strong><span>$401KEK</span></div>
              <img src="/assets/badge-401kek-v1.webp" alt="401KEK black circle badge" />
              <small>{runtimeReady
                ? "OF NET INPUT BUYS THE OFFICIAL MEME"
                : MARKET.releaseManifestActive
                  ? "PROJECT LEG · LIVE RELEASE GATES BLOCKED"
                  : "PLANNED PROJECT LEG · MARKET NOT ACTIVE"}</small>
            </div>

            <div className="allocation allocation-stock">
              <div><strong>1%</strong><span>QQQ STOCK BASKET</span></div>
              <div className="qqq-basket" role="img" aria-label="QQQ with representative Nasdaq-100 holdings Apple, Nvidia, Microsoft, and Amazon">
                <img src="/assets/badge-qqq-v1.webp" alt="QQQ black circle badge" />
                <span>HOLDS 100 NASDAQ STOCKS</span>
                <div className="qqq-holdings" aria-hidden="true">
                  <i><DeviceMobile weight="fill" /><b>AAPL</b></i>
                  <i><Cpu weight="fill" /><b>NVDA</b></i>
                  <i><ChartLineUp weight="bold" /><b>MSFT</b></i>
                  <i><Cloud weight="fill" /><b>AMZN</b></i>
                </div>
              </div>
              <small>{runtimeReady ? "OF NET INPUT BUYS THE CANONICAL QQQ STOCK BASKET" : "PLANNED QQQ LEG · ROUTE AND ELIGIBILITY PENDING"}</small>
            </div>
          </section>

          <div className="home-actions">
            {runtimeReady ? (
              <button
                ref={buyTriggerRef}
                className="buy-button"
                type="button"
                onClick={() => {
                  setActionState("idle");
                  setActionMessage("");
                  setSubmittedHash("");
                  setReceiptWallet("");
                  setReceiptGateway("");
                  setReceiptConfirmedBlock(null);
                  setReceiptMemberNumber(null);
                  setReceiptMemberStatus("idle");
                  setReceiptMemberMessage("");
                  submittedHashRef.current = "";
                  receiptVerificationRef.current = null;
                  setIsBuySheetOpen(true);
                }}
                disabled={isBusy}
              >
                BUY 99/1 <Wallet size={25} weight="fill" />
              </button>
            ) : (
              <a
                ref={buyTriggerRef}
                className="buy-button"
                href="/flow"
                onClick={(event) => {
                  event.preventDefault();
                  window.location.assign("/flow");
                }}
              >
                SEE THE 3-BEAT TRICK <ArrowRight size={25} weight="bold" />
              </a>
            )}
            <button className="share-button" type="button" onClick={sharePlan}>
              <ShareNetwork size={20} weight="bold" /> {shareLabel}
            </button>
          </div>

          <p
            className={`action-message${actionState === "error" ? " action-error" : ""}`}
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            {actionMessage || defaultActionMessage}
          </p>
        </div>
      </main>

      {isBuySheetOpen && (
        <div className="buy-dialog-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget) closeBuyDialog();
        }}>
          <section
            ref={buyDialogRef}
            className="buy-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="buy-dialog-title"
            aria-describedby="buy-dialog-message"
            tabIndex={-1}
          >
            <div className="buy-dialog-head">
              <div><span id="buy-dialog-title">MAKE THE BAD DECISION</span><small>FEES FIRST. THEN 99/1.</small></div>
              <button
                type="button"
                aria-label={actionState === "submitting" ? "Waiting for wallet submission" : "Close buy dialog"}
                onClick={closeBuyDialog}
                disabled={actionState === "submitting"}
              >
                <X size={24} weight="bold" />
              </button>
            </div>

            <div className="launch-gates" aria-live="polite">
              <span>
                MARKET <b>{runtime.status === "checking" ? "CHECKING" : runtime.ready ? "READY" : "BLOCKED"}</b>
              </span>
              <span>
                QUOTE SERVICE <b>{runtime.ready && runtime.checks?.quote ? "ROUTE READY" : runtime.checks?.quote ? "CHECK PASSED · MARKET BLOCKED" : runtime.status === "checking" ? "CHECKING" : "BLOCKED"}</b>
              </span>
              <span>
                ELIGIBILITY <b>{eligibility.status === "eligible" && runtime.ready ? "WALLET PASSED" : runtime.checks?.eligibility ? "CHECK PASSED · MARKET BLOCKED" : runtime.status === "checking" ? "CHECKING" : "BLOCKED"}</b>
              </span>
              <span>
                OPERATIONS <b>{runtime.ready && runtime.checks?.operations ? "READY" : runtime.checks?.operations ? "CHECK PASSED · MARKET BLOCKED" : runtime.status === "checking" ? "CHECKING" : "BLOCKED"}</b>
              </span>
              <span>
                AUDIT <b>{runtime.checks?.audit ? "RECORDED" : runtime.status === "checking" ? "CHECKING" : "BLOCKED"}</b>
              </span>
              <small>
                {walletAccount
                  ? `${shortAddress(walletAccount)} · ${walletChainId === CHAIN.chainId ? "ROBINHOOD CHAIN" : "NETWORK SWITCH REQUIRED"}`
                  : "NO WALLET CONNECTED · WALLET-SPECIFIC ELIGIBILITY HAS NOT BEEN CHECKED"}
              </small>
            </div>

            <label className="amount-input amount-input-dialog">
              <span>YOU PAY</span>
              <div>
                <input
                  autoFocus
                  value={amount}
                  onChange={(event) => setAmount(sanitizeAmount(event.target.value))}
                  inputMode="decimal"
                  placeholder="0.00"
                  aria-label="ETH amount"
                  disabled={isBusy || Boolean(submittedHash)}
                />
                <b>ETH</b>
              </div>
              <small className={`amount-validation${hasAmount && !amountValidation.valid ? " action-error" : ""}`}>
                {hasAmount
                  ? amountValidation.valid
                    ? runtimeReady && runtime.limits
                      ? "AMOUNT IS WITHIN THE VERIFIED RUNTIME LIMITS."
                      : "AMOUNT FORMAT IS VALID. MARKET LIMITS ARE NOT CURRENTLY VERIFIED."
                    : amountValidation.message
                  : "ENTER AN AMOUNT BEFORE THE WALLET CHECK STARTS."}
              </small>
            </label>

            <div className="dialog-fee-summary" aria-label={`Gross input, explicit fee ${previewFeeBps} basis points, and net input`}>
              <span>GROSS <b>{hasAmount ? formatEthAmount(grossAmount) : "-"} ETH</b></span>
              <span>EXPLICIT FEE ({previewFeeBps} BPS) <b>{hasAmount ? formatEthAmount(feeAmount) : "-"} ETH</b></span>
              <span>NET FOR 99/1 <b>{hasAmount ? formatEthAmount(netAmount) : "-"} ETH</b></span>
            </div>

            <div className="dialog-split">
              <div><b>99%</b><span>{amountValidation.valid ? `${splitAmount(amount, 0.99, previewFeeBps)} ETH` : "-"}<small>$401KEK ROUTE</small></span></div>
              <div><b>1%</b><span>{amountValidation.valid ? `${splitAmount(amount, 0.01, previewFeeBps)} ETH` : "-"}<small>QQQ ROUTE</small></span></div>
            </div>

            {!submittedHash && (
              <div className="launch-attestations">
                <label>
                  <input
                    type="checkbox"
                    checked={termsAccepted}
                    onChange={(event) => setTermsAccepted(event.target.checked)}
                    disabled={isBusy}
                  />
                  <span>I ACCEPT THE TERMS AND UNDERSTAND THIS IS NOT INVESTMENT OR RETIREMENT ADVICE.</span>
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={notUSPerson}
                    onChange={(event) => setNotUSPerson(event.target.checked)}
                    disabled={isBusy}
                  />
                  <span>I ATTEST I AM NOT A US PERSON; STOCK-TOKEN ACCESS MAY STILL BE RESTRICTED.</span>
                </label>
              </div>
            )}

            {submittedHash ? (
              <div className={`dialog-receipt-success${receiptFailed ? " dialog-receipt-failed" : ""}`}>
                <div>
                  <span>
                    {actionState === "success"
                      ? "CONFIRMED 99/1 RECEIPT"
                      : receiptFailed
                        ? "FAILED 99/1 TRANSACTION"
                        : "PENDING 99/1 RECEIPT"}
                  </span>
                  <strong>{shortAddress(submittedHash)}</strong>
                  <small>
                    {actionState === "success"
                      ? "BOTH LEGS REACHED THE REQUIRED CONFIRMATION DEPTH."
                      : receiptFailed
                        ? "THIS HASH DID NOT PRODUCE A CONFIRMED OFFICIAL RECEIPT. REVIEW IT IN THE EXPLORER."
                        : "DO NOT RESUBMIT AUTOMATICALLY. VERIFY THIS HASH IN THE EXPLORER."}
                  </small>
                  {actionState === "success" ? (
                    <>
                      <dl className="receipt-proof-bindings">
                        <div><dt>CONFIRMED BLOCK</dt><dd>{receiptConfirmedBlock}</dd></div>
                        <div><dt>RECIPIENT</dt><dd>{shortAddress(receiptWallet)}</dd></div>
                        <div><dt>CANONICAL GATEWAY</dt><dd>{shortAddress(receiptGateway)}</dd></div>
                      </dl>
                      <b className={`receipt-member-number receipt-member-${receiptMemberStatus}`}>
                        {receiptMemberStatus === "ready" && receiptMemberNumber
                          ? `OFFICIAL MEMBER #${String(receiptMemberNumber).padStart(4, "0")}`
                          : receiptMemberStatus === "unavailable"
                            ? "MEMBER INDEX UNAVAILABLE · NO NUMBER PRINTED"
                            : "MEMBER NUMBER INDEXING AFTER REQUIRED CONFIRMATIONS"}
                      </b>
                      <small className="receipt-member-message">{receiptMemberMessage}</small>
                    </>
                  ) : null}
                </div>
                <div className={receiptFailed ? "dialog-receipt-actions-single" : ""}>
                  {!receiptFailed ? (
                    <button
                      type="button"
                      onClick={actionState === "pending" ? recheckReceipt : shareReceipt}
                      disabled={!['success', 'pending'].includes(actionState)}
                    >
                      {actionState === "pending"
                        ? <ArrowClockwise size={19} weight="bold" />
                        : <ShareNetwork size={19} weight="bold" />}
                      {actionState === "success"
                        ? "SHARE CONFIRMED RECEIPT"
                        : actionState === "pending"
                          ? "CHECK RECEIPT AGAIN"
                          : "SHARE AFTER CONFIRMATION"}
                    </button>
                  ) : null}
                  <a href={`${CHAIN.blockExplorerUrls[0]}/tx/${submittedHash}`} target="_blank" rel="noreferrer">VIEW ONCHAIN <ArrowRight size={18} weight="bold" /></a>
                </div>
              </div>
            ) : (
              <button className="dialog-buy-button" type="button" onClick={buy} disabled={!canBuy}>
                {actionLabel(actionState, hasAmount)}
                <Wallet size={23} weight="fill" />
              </button>
            )}
            <p
              id="buy-dialog-message"
              className={`dialog-message${actionState === "error" ? " action-error" : ""}`}
              role="status"
              aria-live="polite"
              aria-atomic="true"
            >
              {actionMessage || `${runtimeMessage(runtime)} ${eligibilityMessage(eligibility)}`}
            </p>
          </section>
        </div>
      )}

      <footer className="home-footer">
        <div className="footer-slogan"><span><b>99%</b> APE.</span><span><b>1%</b> ADULT.</span></div>
        <nav className="footer-links" aria-label="Project information">
          <a className="footer-proof" href="/flow">HOW IT WORKS</a>
          <a className="footer-proof" href="/sandbox">RUN SANDBOX</a>
          <a className="footer-proof" href="/code">VERIFY THE CODE</a>
          <a className="footer-proof foundation-proof-link" href="/deploy">
            {MARKET.releaseManifestActive
              ? "V2 MARKET RECORDED · LIVE GATES APPLY"
              : "V2 PREAUTHORIZED · MARKET NOT ACTIVE"}
          </a>
        </nav>
      </footer>
    </div>
  );
}

export function App() {
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  if (path === "/deploy") {
    return <Suspense fallback={<RouteFallback />}><DeployPage /></Suspense>;
  }
  if (path === "/flow") {
    return <Suspense fallback={<RouteFallback />}><FlowPage /></Suspense>;
  }
  if (path === "/sandbox") {
    return <Suspense fallback={<RouteFallback />}><SandboxPage /></Suspense>;
  }
  if (path === "/code" || path === "/proof") {
    return <Suspense fallback={<RouteFallback />}><CodePage /></Suspense>;
  }
  return <HomePage />;
}
