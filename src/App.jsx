import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  CheckCircle,
  Hexagon,
  LockKey,
  ShareNetwork,
  UsersThree,
  Wallet,
  X,
} from "@phosphor-icons/react";
import { MARKET, ROBINHOOD_CHAIN as CHAIN } from "./config.js";
import { useMemberStats } from "./useMemberStats.js";
import CodePage from "./CodePage.jsx";
import FlowPage from "./FlowPage.jsx";

function shortAddress(value) {
  if (!value) return "";
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function splitAmount(value, ratio, explicitFeeBps = MARKET.explicitFeeBps) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return "0.0000";
  const net = number * (1 - explicitFeeBps / 10_000);
  const result = net * ratio;
  return result < 0.0001 ? "<0.0001" : result.toFixed(4);
}

function sanitizeAmount(value) {
  const clean = value.replace(/[^0-9.]/g, "");
  const [whole, ...fraction] = clean.split(".");
  return fraction.length ? `${whole}.${fraction.join("").slice(0, 6)}` : whole;
}

function getPublicStage(stats) {
  if (stats.status === "prelaunch") {
    return {
      key: "prelaunch",
      status: "FIRST OFFICIAL MEMBER: WAITING",
      headline: ["YOUR WORST", "FINANCIAL DECISION"],
      accent: "NEEDS 1% ADULT SUPERVISION.",
      subline: "BUY THE MEME. ROUTE 1% TO QQQ. PRINT THE RECEIPT.",
      form: "CURRENT FORM: UNEMPLOYED ACCOUNTANT",
      milestone: "FIRST OFFICIAL RECEIPT OPENS THE WALL",
      art: "/assets/raccoon-deadpan-v2.png",
    };
  }
  if (stats.status === "loading") {
    return {
      key: "loading",
      status: "PENSION MEMBERS: COUNTING",
      headline: ["YOUR BAD DECISION", "IS BEING"],
      accent: "AUDITED BY A RACCOON.",
      subline: "READING OFFICIAL 99/1 RECEIPTS FROM THE CHAIN.",
      form: "CURRENT FORM: COUNTING THE DAMAGE",
      milestone: "NEXT OFFICE UPGRADE AT 100 MEMBERS",
      art: "/assets/raccoon-ledger-v1.png",
    };
  }
  if (stats.status === "error") {
    return {
      key: "error",
      status: "PENSION MEMBERS: DATA UNAVAILABLE",
      headline: ["THE CHAIN SAID", "BE RIGHT"],
      accent: "BACK.",
      subline: "THE COUNTER IS OFFLINE. THE BUY ROUTE IS SEPARATE.",
      form: "CURRENT FORM: TECH SUPPORT VICTIM",
      milestone: "MEMBER COUNT RETURNS WITH THE INDEX",
      art: "/assets/raccoon-overtime-v1.png",
    };
  }

  const count = stats.memberCount || 0;
  if (count === 0) {
    return {
      key: "empty",
      status: "FIRST OFFICIAL MEMBER: WAITING",
      headline: ["THE PENSION WALL", "IS PAINFULLY"],
      accent: "EMPTY.",
      subline: "THE FIRST OFFICIAL 99/1 RECEIPT GETS THE FIRST FRAME.",
      form: "CURRENT FORM: EMPTY OFFICE",
      milestone: "CLAIM THE FIRST ONCHAIN RECEIPT",
      art: "/assets/raccoon-deadpan-v2.png",
    };
  }
  if (count < 100) {
    return {
      key: "growing",
      status: `PENSION MEMBERS: ${count.toLocaleString("en-US")}`,
      headline: [`${count.toLocaleString("en-US")} BAD DECISIONS.`, "ONE GROWING"],
      accent: "PENSION WALL.",
      subline: "EVERY MEMBER HAS AN OFFICIAL 1% QQQ RECEIPT.",
      form: "CURRENT FORM: JUNIOR BOOKKEEPER",
      milestone: `${100 - count} MORE MEMBERS UNTIL THE OFFICE UPGRADE`,
      art: "/assets/raccoon-watch-chart-v1.png",
    };
  }
  return {
    key: "crowded",
    status: `PENSION MEMBERS: ${count.toLocaleString("en-US")}`,
    headline: ["THE GROUP CHAT", "HAS A PENSION"],
    accent: "DEPARTMENT NOW.",
    subline: `${count.toLocaleString("en-US")} UNIQUE WALLETS WITH OFFICIAL 1% QQQ RECEIPTS.`,
    form: "CURRENT FORM: ABSOLUTELY EMPLOYED",
    milestone: "THE NEXT UPGRADE IS DECIDED BY THE CROWD",
    art: "/assets/raccoon-reluctant-celebration-v1.png",
  };
}

function Brand({ compact = false }) {
  return (
    <a className={`brand${compact ? " brand-compact" : ""}`} href="/" aria-label="Degen Pension home">
      <img src="/brand/mark-99-1-v2.png" alt="" />
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
  const stats = useMemberStats();
  const stage = getPublicStage(stats);
  const [amount, setAmount] = useState("");
  const [isBuySheetOpen, setIsBuySheetOpen] = useState(false);
  const [actionState, setActionState] = useState("idle");
  const [actionMessage, setActionMessage] = useState("");
  const [submittedHash, setSubmittedHash] = useState("");
  const [shareLabel, setShareLabel] = useState("SHARE THE BAD PLAN");
  const numericAmount = useMemo(() => Number(amount), [amount]);
  const hasAmount = amount !== "" && Number.isFinite(numericAmount) && numericAmount > 0;
  const canBuy = MARKET.marketReady && hasAmount;

  useEffect(() => {
    document.title = "DEGEN PENSION - 99% APE. 1% ADULT.";
  }, []);

  useEffect(() => {
    if (!isBuySheetOpen) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === "Escape" && actionState !== "working") setIsBuySheetOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [isBuySheetOpen, actionState]);

  const buy = async () => {
    if (!canBuy || actionState === "working") return;
    setActionMessage("");
    if (!window.ethereum?.request) {
      setActionState("error");
      setActionMessage("NO BROWSER WALLET FOUND. THE PAGE NEVER CONNECTS UNTIL YOU PRESS BUY.");
      return;
    }

    setActionState("working");
    try {
      const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
      const wallet = accounts?.[0];
      if (!wallet) throw new Error("Wallet connection was cancelled.");

      const currentChain = await window.ethereum.request({ method: "eth_chainId" });
      if (String(currentChain).toLowerCase() !== CHAIN.chainId) {
        try {
          await window.ethereum.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: CHAIN.chainId }],
          });
        } catch (switchError) {
          if (switchError?.code !== 4902) throw switchError;
          await window.ethereum.request({ method: "wallet_addEthereumChain", params: [CHAIN] });
        }
      }

      if (!MARKET.buyQuoteEndpoint) {
        throw new Error("Market is verified, but the production quote route is not configured.");
      }

      const quoteResponse = await fetch(MARKET.buyQuoteEndpoint, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ amountEth: amount, recipient: wallet, chainId: CHAIN.chainIdDecimal }),
      });
      if (!quoteResponse.ok) throw new Error(`Quote failed (${quoteResponse.status}).`);
      const quotePayload = await quoteResponse.json();
      const transaction = quotePayload.transaction || quotePayload;
      if (String(transaction.to || "").toLowerCase() !== MARKET.gatewayAddress.toLowerCase()) {
        throw new Error("Quote target does not match the official Gateway.");
      }
      if (!transaction.data || !transaction.value) throw new Error("Quote did not include a complete transaction.");

      const transactionHash = await window.ethereum.request({
        method: "eth_sendTransaction",
        params: [{ from: wallet, to: transaction.to, data: transaction.data, value: transaction.value }],
      });
      setSubmittedHash(transactionHash);
      setActionState("success");
      setActionMessage(`SUBMITTED ${shortAddress(transactionHash)}. BOTH LEGS OR NEITHER.`);
    } catch (error) {
      setActionState("error");
      setActionMessage(String(error?.message || "Transaction cancelled.").toUpperCase());
    }
  };

  const shareReceipt = async () => {
    if (!submittedHash) return;
    const explorerUrl = `${CHAIN.blockExplorerUrls[0]}/tx/${submittedHash}`;
    const receiptText = `My 99/1 pension receipt is pending confirmation: 99% $401KEK, 1% QQQ. ${explorerUrl}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: "DEGEN PENSION RECEIPT", text: receiptText });
      } else {
        await navigator.clipboard.writeText(receiptText);
      }
      setActionMessage("PENDING RECEIPT SHARED. MEMBER NUMBER PRINTS AFTER CONFIRMATION.");
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

  const defaultActionMessage = !MARKET.marketReady
    ? "THE OFFICIAL CA AND GATEWAY WILL APPEAR HERE. NO WALLET REQUEST BEFORE THEN."
    : "CLICK BUY. ENTER AMOUNT. THEN THE WALLET OPENS.";

  return (
    <div className={`home-page stage-${stage.key}`}>
      <header className="home-header">
        <Brand />
        <div className="home-header-right"><NetworkLabel /></div>
      </header>

      <main className="home-main">
        <section className="reaction-stage" aria-live="polite">
          <p className="hero-kicker">THE UNOFFICIAL RETIREMENT PLAN FOR PEOPLE WHO BUY MEMECOINS</p>
          <h1>
            {stage.headline.map((line) => <span key={line}>{line}</span>)}
            <em>{stage.accent}</em>
          </h1>
          <div className="member-status"><UsersThree size={19} weight="fill" />{stage.status}</div>
          <p className="stage-subline">{stage.subline}</p>
          <div className="raccoon-media">
            <img className="raccoon-art" src={stage.art} alt="The tired deadpan office raccoon reacting to the current official member stage" />
            <span className="raccoon-form">{stage.form}</span>
          </div>
        </section>

        <div className="buy-stack">
          <section className={`buy-panel buy-panel-preview${MARKET.marketReady ? "" : " buy-panel-prelaunch"}`} aria-labelledby="buy-panel-title">
            <div className="buy-panel-title" id="buy-panel-title">
              <span>YOUR 99/1 RECEIPT</span>
              <b>{MARKET.marketReady ? "ONCHAIN" : "FIRST FRAME OPEN"}</b>
            </div>

            {MARKET.marketReady ? (
              <div className="member-ticket">
                <span>OFFICIAL MEMBERS</span>
                <strong>{stats.memberCount !== null ? stats.memberCount.toLocaleString("en-US") : "…"}</strong>
                <small>{stage.milestone}</small>
              </div>
            ) : null}

            <div className="allocation allocation-project">
              <div><strong>99%</strong><span>$401KEK</span></div>
              <img src="/assets/badge-401kek-v1.png" alt="401KEK black circle badge" />
              <small>OF NET INPUT BUYS THE OFFICIAL MEME</small>
            </div>

            <div className="allocation allocation-stock">
              <div><strong>1%</strong><span>QQQ</span></div>
              <img src="/assets/badge-qqq-v1.png" alt="QQQ black circle badge" />
              <small>OF NET INPUT BUYS CANONICAL QQQ</small>
            </div>

            <div className="panel-state">
              {MARKET.marketReady ? <CheckCircle size={26} weight="fill" /> : <LockKey size={26} weight="bold" />}
              <span>{MARKET.marketReady ? "TWO ASSETS. ONE RECEIPT." : "RECEIPT PRINTS AFTER LAUNCH"}</span>
            </div>
          </section>

          <div className="home-actions">
            {MARKET.marketReady ? (
              <button
                className="buy-button"
                type="button"
                onClick={() => {
                  setActionState("idle");
                  setActionMessage("");
                  setSubmittedHash("");
                  setIsBuySheetOpen(true);
                }}
                disabled={actionState === "working"}
              >
                BUY 99/1 <Wallet size={25} weight="fill" />
              </button>
            ) : (
              <a className="buy-button" href="/flow">SEE THE 3-BEAT TRICK <ArrowRight size={25} weight="bold" /></a>
            )}
            <button className="share-button" type="button" onClick={sharePlan}>
              <ShareNetwork size={20} weight="bold" /> {shareLabel}
            </button>
          </div>

          <p className={`action-message${actionState === "error" ? " action-error" : ""}`}>
            {actionMessage || defaultActionMessage}
          </p>
        </div>
      </main>

      {isBuySheetOpen && (
        <div className="buy-dialog-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget && actionState !== "working") setIsBuySheetOpen(false);
        }}>
          <section className="buy-dialog" role="dialog" aria-modal="true" aria-labelledby="buy-dialog-title">
            <div className="buy-dialog-head">
              <div><span id="buy-dialog-title">MAKE THE BAD DECISION</span><small>FEES FIRST. THEN 99/1.</small></div>
              <button type="button" aria-label="Close buy dialog" onClick={() => setIsBuySheetOpen(false)} disabled={actionState === "working"}>
                <X size={24} weight="bold" />
              </button>
            </div>

            <label className="amount-input amount-input-dialog">
              <span>YOU PAY</span>
              <div>
                <input autoFocus value={amount} onChange={(event) => setAmount(sanitizeAmount(event.target.value))} inputMode="decimal" placeholder="0.00" aria-label="ETH amount" />
                <b>ETH</b>
              </div>
            </label>

            <div className="dialog-split">
              <div><b>99%</b><span>{hasAmount ? `${splitAmount(amount, 0.99)} ETH` : "-"}<small>$401KEK ROUTE</small></span></div>
              <div><b>1%</b><span>{hasAmount ? `${splitAmount(amount, 0.01)} ETH` : "-"}<small>QQQ ROUTE</small></span></div>
            </div>

            {actionState === "success" && submittedHash ? (
              <div className="dialog-receipt-success">
                <div>
                  <span>PENDING 99/1 RECEIPT</span>
                  <strong>{shortAddress(submittedHash)}</strong>
                  <small>MEMBER NUMBER PRINTS AFTER THE EVENT IS CONFIRMED AND INDEXED.</small>
                </div>
                <div>
                  <button type="button" onClick={shareReceipt}><ShareNetwork size={19} weight="bold" /> SHARE RECEIPT</button>
                  <a href={`${CHAIN.blockExplorerUrls[0]}/tx/${submittedHash}`} target="_blank" rel="noreferrer">VIEW ONCHAIN <ArrowRight size={18} weight="bold" /></a>
                </div>
              </div>
            ) : (
              <button className="dialog-buy-button" type="button" onClick={buy} disabled={!canBuy || actionState === "working"}>
                {actionState === "working" ? "OPENING WALLET..." : hasAmount ? "CONFIRM 99/1" : "ENTER AMOUNT"}
                <Wallet size={23} weight="fill" />
              </button>
            )}
            <p className={`dialog-message${actionState === "error" ? " action-error" : ""}`}>
              {actionMessage || "NO WALLET REQUEST UNTIL CONFIRM. BOTH LEGS OR NEITHER."}
            </p>
          </section>
        </div>
      )}

      <footer className="home-footer">
        <div className="footer-slogan"><span><b>99%</b> APE.</span><span><b>1%</b> ADULT.</span></div>
        <nav className="footer-links" aria-label="Project information">
          {MARKET.marketReady && <a className="footer-proof" href="/flow">HOW IT WORKS</a>}
          <a className="footer-proof" href="/code">VERIFY THE CODE</a>
        </nav>
      </footer>
    </div>
  );
}

export function App() {
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  if (path === "/flow") return <FlowPage />;
  return path === "/code" || path === "/proof" ? <CodePage /> : <HomePage />;
}
