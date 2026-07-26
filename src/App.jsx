import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  ChartLineUp,
  Cloud,
  Cpu,
  DeviceMobile,
  Hexagon,
  ShareNetwork,
  UsersThree,
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
import CodePage from "./CodePage.jsx";
import FlowPage from "./FlowPage.jsx";

const DeployPage = lazy(() => import("./DeployPage.jsx"));

function shortAddress(value) {
  if (!value) return "";
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
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
  return fraction.length ? `${whole}.${fraction.join("").slice(0, 6)}` : whole;
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
    return "MARKET BLOCKED · OFFICIAL RUNTIME, QUOTE, AND ELIGIBILITY CONFIGURATION IS INCOMPLETE.";
  }
  if (runtime.status === "checking") {
    return "MARKET CHECKING · QUOTE CHECKING · ELIGIBILITY SERVICE CHECKING. NO WALLET REQUEST YET.";
  }
  if (!runtime.ready) {
    return `MARKET BLOCKED · ${String(runtime.reason || "A REQUIRED SAFETY CHECK FAILED.").toUpperCase()}`;
  }
  return "MARKET READY · QUOTE READY · ELIGIBILITY SERVICE READY. YOUR WALLET IS CHECKED ONLY AFTER YOU CONNECT.";
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
      status: "TOKEN HOLDERS: WAITING FOR CA",
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
      status: "TOKEN HOLDERS: COUNTING",
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
      status: "TOKEN HOLDERS: DATA UNAVAILABLE",
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
      status: `TOKEN HOLDERS: 0${stats.status === "stale" ? " · STALE" : ""}`,
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
      status: `TOKEN HOLDERS: ${count.toLocaleString("en-US")}${stats.status === "stale" ? " · STALE" : ""}`,
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
    status: `TOKEN HOLDERS: ${count.toLocaleString("en-US")}${stats.status === "stale" ? " · STALE" : ""}`,
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
  const [receiptMemberNumber, setReceiptMemberNumber] = useState(null);
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
  const buyDialogRef = useRef(null);
  const buyTriggerRef = useRef(null);
  const lastFocusedRef = useRef(null);
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

  const closeBuyDialog = () => {
    if (actionStateRef.current === "submitting") return;
    if (isBusyRef.current && !submittedHashRef.current) {
      activeOperationRef.current?.abort();
      activeOperationRef.current = null;
      submitLockRef.current = false;
    }
    setIsBuySheetOpen(false);
  };

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
    if (!isBuySheetOpen) return undefined;
    lastFocusedRef.current = document.activeElement;
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
      buyDialogRef.current?.querySelector(focusableSelector)?.focus();
    });
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeBuyDialog();
        return;
      }
      if (event.key !== "Tab" || !buyDialogRef.current) return;
      const focusable = [...buyDialogRef.current.querySelectorAll(focusableSelector)]
        .filter((element) => !element.hidden && element.getClientRects().length > 0);
      if (!focusable.length) {
        event.preventDefault();
        buyDialogRef.current.focus();
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
      const focusTarget = lastFocusedRef.current || buyTriggerRef.current;
      if (focusTarget?.isConnected) focusTarget.focus();
    };
  }, [isBuySheetOpen]);

  useEffect(() => {
    if (actionState !== "success" || !receiptWallet || !submittedHash) return undefined;
    const controller = new AbortController();
    let interval;
    const refreshMemberRecord = async () => {
      try {
        const next = await loadMemberStats({
          signal: controller.signal,
          recipient: receiptWallet,
          gatewayAddress: runtime.canonical?.gatewayAddress,
        });
        if (next.memberNumber) {
          setReceiptMemberNumber(next.memberNumber);
          if (interval) window.clearInterval(interval);
        }
      } catch (error) {
        if (error?.name !== "AbortError") setReceiptMemberNumber(null);
      }
    };
    refreshMemberRecord();
    interval = window.setInterval(refreshMemberRecord, 15_000);
    return () => {
      controller.abort();
      if (interval) window.clearInterval(interval);
    };
  }, [actionState, receiptWallet, runtime.canonical?.gatewayAddress, submittedHash]);

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
    setReceiptMemberNumber(null);
    const controller = new AbortController();
    activeOperationRef.current?.abort();
    activeOperationRef.current = controller;
    try {
      setActionState("connecting");
      const liveRuntime = await runtime.refresh();
      if (!liveRuntime?.ready) {
        throw new Error(liveRuntime?.reason || "Runtime, quote, and eligibility are not all ready.");
      }

      const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
      const wallet = normalizeAddress(accounts?.[0], "Connected wallet");
      if (!wallet) throw new Error("Wallet connection was cancelled.");
      if (controller.signal.aborted) throw new Error("Purchase was interrupted.");
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

      const [accountsBeforeQuote, chainBeforeQuote] = await Promise.all([
        window.ethereum.request({ method: "eth_accounts" }),
        window.ethereum.request({ method: "eth_chainId" }),
      ]);
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
      const [accountsBeforeSend, chainBeforeSend] = await Promise.all([
        window.ethereum.request({ method: "eth_accounts" }),
        window.ethereum.request({ method: "eth_chainId" }),
      ]);
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

      setActionState("submitting");
      const transactionHash = await window.ethereum.request({
        method: "eth_sendTransaction",
        params: [{
          from: wallet,
          to: executableQuote.transaction.to,
          data: executableQuote.transaction.data,
          value: executableQuote.transaction.value,
        }],
      });
      submittedHashRef.current = transactionHash;
      setSubmittedHash(transactionHash);
      setReceiptWallet(wallet);
      setActionState("confirming");
      setActionMessage(`SUBMITTED ${shortAddress(transactionHash)}. WAITING FOR THE ATOMIC RECEIPT.`);

      await waitForTransactionReceipt({
        ethereum: window.ethereum,
        hash: transactionHash,
        gatewayAddress: liveRuntime.canonical.gatewayAddress,
        confirmations: liveRuntime.limits?.confirmations || MARKET.confirmations || 1,
        signal: controller.signal,
        timeoutMs: MARKET.receiptTimeoutMs,
      });
      setActionState("success");
      setActionMessage(`CONFIRMED ${shortAddress(transactionHash)}. BOTH LEGS SETTLED OR NEITHER.`);
      setStatsRefreshToken((value) => value + 1);
      runtime.refresh({ quiet: true });
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

  const shareReceipt = async () => {
    if (!submittedHash) return;
    if (actionState === "error") {
      setActionMessage("THIS TRANSACTION DID NOT CONFIRM. SHARING AS A 99/1 RECEIPT IS DISABLED.");
      return;
    }
    const explorerUrl = `${CHAIN.blockExplorerUrls[0]}/tx/${submittedHash}`;
    const isConfirmed = actionState === "success";
    const memberText = receiptMemberNumber ? ` Official member #${receiptMemberNumber}.` : "";
    const receiptText = isConfirmed
      ? `My confirmed 99/1 pension receipt: 99% $401KEK, 1% QQQ.${memberText} ${explorerUrl}`
      : `My 99/1 pension receipt is pending confirmation: 99% $401KEK, 1% QQQ. ${explorerUrl}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: "DEGEN PENSION RECEIPT", text: receiptText });
      } else {
        await navigator.clipboard.writeText(receiptText);
      }
      setActionMessage(
        isConfirmed
          ? receiptMemberNumber
            ? `CONFIRMED RECEIPT #${receiptMemberNumber} SHARED.`
            : "CONFIRMED RECEIPT SHARED. MEMBER NUMBER IS STILL INDEXING."
          : "PENDING RECEIPT SHARED. MEMBER NUMBER PRINTS ONLY FROM THE CONFIRMED INDEX.",
      );
    } catch (error) {
      if (error?.name !== "AbortError") setActionMessage("COULD NOT SHARE. THE EXPLORER LINK IS STILL AVAILABLE BELOW.");
    }
  };

  const sharePlan = async () => {
    const shareData = {
      title: "DEGEN PENSION",
      text: "A retirement plan for people who buy meme coins: 99% $401KEK, 1% QQQ. 99% APE. 1% ADULT.",
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
          <div className="member-status"><UsersThree size={19} weight="fill" />{stage.status}</div>
          <p className="stage-subline">{stage.subline}</p>
          <div className={`hero-ca${officialTokenAddress ? " hero-ca-live" : ""}`}>
            <span>CA:</span>
            <code>{officialTokenAddress || "PENDING"}</code>
          </div>
          <aside
            className="holder-stock-snapshot"
            aria-label="Public snapshot: project holders have bought 483,291 dollars of Stock Tokens for themselves. This is not DEGEN PENSION Gateway volume."
          >
            <span className="holder-stock-snapshot-kicker">PUBLIC HOLDER SNAPSHOT</span>
            <div className="holder-stock-snapshot-main">
              <strong>$483,291</strong>
              <span>IN STOCK TOKENS BOUGHT BY PROJECT HOLDERS FOR THEMSELVES</span>
            </div>
            <small>PUBLIC AGGREGATE · NOT 99/1 GATEWAY VOLUME</small>
          </aside>
          <div className="raccoon-media">
            <img className="raccoon-art" src={stage.art} alt="The tired deadpan office raccoon reacting to the current official member stage" />
            <span className="raccoon-form">{stage.form}</span>
          </div>
        </section>

        <div className="buy-stack">
          <section className={`buy-panel buy-panel-preview${showMemberTicket ? "" : " buy-panel-prelaunch"}`} aria-labelledby="buy-panel-title">
            <div className="buy-panel-title" id="buy-panel-title">
              <span>YOUR 99/1 RECEIPT</span>
              <b>{runtimeReady ? "ONCHAIN" : "MARKET NOT ACTIVE"}</b>
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
              <small>{runtimeReady ? "OF NET INPUT BUYS THE OFFICIAL MEME" : "PLANNED PROJECT LEG · MARKET NOT ACTIVE"}</small>
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
                  setReceiptMemberNumber(null);
                  submittedHashRef.current = "";
                  setIsBuySheetOpen(true);
                }}
                disabled={isBusy}
              >
                BUY 99/1 <Wallet size={25} weight="fill" />
              </button>
            ) : (
              <a
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
              <button type="button" aria-label="Close buy dialog" onClick={closeBuyDialog}>
                <X size={24} weight="bold" />
              </button>
            </div>

            <div className="launch-gates" aria-live="polite">
              <span>
                MARKET <b>{runtime.status === "checking" ? "CHECKING" : runtime.ready ? "READY" : "BLOCKED"}</b>
              </span>
              <span>
                QUOTE <b>{runtime.checks?.quote ? "READY" : runtime.status === "checking" ? "CHECKING" : "BLOCKED"}</b>
              </span>
              <span>
                ELIGIBILITY <b>{eligibility.status === "eligible" ? "WALLET PASSED" : runtime.checks?.eligibility ? "SERVICE READY" : runtime.status === "checking" ? "CHECKING" : "BLOCKED"}</b>
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
                    ? "AMOUNT IS WITHIN THE VERIFIED RUNTIME LIMITS."
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
              <div className="dialog-receipt-success">
                <div>
                  <span>{actionState === "success" ? "CONFIRMED 99/1 RECEIPT" : "PENDING 99/1 RECEIPT"}</span>
                  <strong>{shortAddress(submittedHash)}</strong>
                  <small>
                    {actionState === "success"
                      ? "BOTH LEGS CONFIRMED. COUNTERS ARE REFRESHING FROM CANONICAL DATA."
                      : "DO NOT RESUBMIT AUTOMATICALLY. VERIFY THIS HASH IN THE EXPLORER."}
                  </small>
                  {actionState === "success" ? (
                    <b className="receipt-member-number">
                      {receiptMemberNumber
                        ? `OFFICIAL MEMBER #${String(receiptMemberNumber).padStart(4, "0")}`
                        : "MEMBER NUMBER INDEXING AFTER REQUIRED CONFIRMATIONS"}
                    </b>
                  ) : null}
                </div>
                <div>
                  <button type="button" onClick={shareReceipt}><ShareNetwork size={19} weight="bold" /> SHARE RECEIPT</button>
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
          <a className="footer-proof" href="/code">VERIFY THE CODE</a>
          <a className="footer-proof foundation-proof-link" href="/deploy">FOUNDATION VERIFIED · MARKET NOT ACTIVE</a>
        </nav>
      </footer>
    </div>
  );
}

export function App() {
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  if (path === "/deploy") {
    return <Suspense fallback={null}><DeployPage /></Suspense>;
  }
  if (path === "/flow") return <FlowPage />;
  return path === "/code" || path === "/proof" ? <CodePage /> : <HomePage />;
}
