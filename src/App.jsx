import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Calculator,
  CheckCircle,
  Code,
  Hexagon,
  LockKey,
  UsersThree,
  Wallet,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { MARKET, ROBINHOOD_CHAIN as CHAIN } from "./config.js";
import { loadMemberStats } from "./memberStats.js";

const EMPTY_STATS = MARKET.marketReady
  ? { status: "loading", memberCount: null, buyCount: null, asOfBlock: null, source: "none" }
  : { status: "prelaunch", memberCount: null, buyCount: null, asOfBlock: null, source: "none" };

const CALCULATION_SOURCE = `function _calculateAmounts(uint256 grossAmountIn)
  private view returns (BuyAmounts memory amounts)
{
  amounts.explicitFeeAmount =
    grossAmountIn * explicitFeeBps / BPS_DENOMINATOR;
  amounts.netAmountIn = grossAmountIn - amounts.explicitFeeAmount;
  amounts.projectAmountIn =
    amounts.netAmountIn * PROJECT_BPS / BPS_DENOMINATOR;
  amounts.stockAmountIn =
    amounts.netAmountIn - amounts.projectAmountIn;
}`;

const SETTLEMENT_SOURCE = `BuyAmounts memory amounts =
  _calculateAmounts(grossAmountIn);
if (amounts.projectAmountIn == 0 ||
    amounts.stockAmountIn == 0) revert InvalidAmount();

if (amounts.explicitFeeAmount != 0) {
  IERC20(inputToken).safeTransfer(
    feeRecipient,
    amounts.explicitFeeAmount
  );
}

projectAmountOut = _executeLeg(
  officialToken, projectAdapter,
  amounts.projectAmountIn, minProjectOut, recipient
);
stockAmountOut = _executeLeg(
  stockToken, stockAdapter,
  amounts.stockAmountIn, minStockOut, recipient
);

_emitSplitBuy(
  recipient, grossAmountIn,
  amounts, projectAmountOut, stockAmountOut
);`;

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
      status: "STATUS: CA LOADING",
      headline: ["I CAN’T JUDGE", "YOUR BAG UNTIL"],
      accent: "THE 1% LANDS.",
      subline: "MEMBERS START AT THE FIRST 1%.",
      art: "/assets/raccoon-deadpan-v2.png",
    };
  }
  if (stats.status === "loading") {
    return {
      key: "loading",
      status: "PENSION MEMBERS: COUNTING",
      headline: ["THE RACCOON IS", "COUNTING BAD"],
      accent: "DECISIONS.",
      subline: "READING OFFICIAL 99/1 EVENTS.",
      art: "/assets/raccoon-deadpan-v2.png",
    };
  }
  if (stats.status === "error") {
    return {
      key: "error",
      status: "PENSION MEMBERS: UNAVAILABLE",
      headline: ["THE CHAIN LEFT", "MY CALL ON"],
      accent: "READ.",
      subline: "COUNT UNKNOWN. FUNDS UNTOUCHED.",
      art: "/assets/raccoon-deadpan-v2.png",
    };
  }

  const count = stats.memberCount || 0;
  if (count === 0) {
    return {
      key: "empty",
      status: "PENSION MEMBERS: 0",
      headline: ["ZERO MEMBERS.", "A BEAUTIFUL"],
      accent: "DISASTER.",
      subline: "BE THE FIRST BAD RETIREMENT DECISION.",
      art: "/assets/raccoon-deadpan-v2.png",
    };
  }
  if (count < 100) {
    return {
      key: "growing",
      status: `PENSION MEMBERS: ${count.toLocaleString("en-US")}`,
      headline: [`${count.toLocaleString("en-US")} DEGENS.`, "ONE ADULT"],
      accent: "PERCENT.",
      subline: "THE RACCOON HAS STARTED A SPREADSHEET.",
      art: "/assets/raccoon-alert-v2.png",
    };
  }
  return {
    key: "crowded",
    status: `PENSION MEMBERS: ${count.toLocaleString("en-US")}`,
    headline: ["THIS IS SOMEHOW", "A PENSION FUND"],
    accent: "NOW.",
    subline: `${count.toLocaleString("en-US")} UNIQUE 1% QQQ RECIPIENTS.`,
    art: "/assets/raccoon-employed-v2.png",
  };
}

function useMemberStats() {
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

function Brand({ compact = false }) {
  return (
    <a className={`brand${compact ? " brand-compact" : ""}`} href="/" aria-label="Degen Pension home">
      <img src="/brand/mark-99-1.png" alt="" />
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
  const numericAmount = useMemo(() => Number(amount), [amount]);
  const hasAmount = amount !== "" && Number.isFinite(numericAmount) && numericAmount > 0;
  const canBuy = MARKET.marketReady && hasAmount;

  useEffect(() => {
    document.title = "DEGEN PENSION — 99% APE. 1% ADULT.";
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
      setActionState("success");
      setActionMessage(`SUBMITTED ${shortAddress(transactionHash)} · BOTH LEGS OR NEITHER.`);
    } catch (error) {
      setActionState("error");
      setActionMessage(String(error?.message || "Transaction cancelled.").toUpperCase());
    }
  };

  const buttonLabel = !MARKET.marketReady
    ? "CA LOADING"
    : "BUY 99/1";

  const defaultActionMessage = !MARKET.marketReady
    ? "NO CA. NO WALLET REQUEST. NO FAKE ORDER."
    : "CLICK BUY. ENTER AMOUNT. THEN THE WALLET OPENS.";

  return (
    <div className={`home-page stage-${stage.key}`}>
      <header className="home-header">
        <Brand />
        <div className="home-header-right">
          <NetworkLabel />
        </div>
      </header>

      <main className="home-main">
        <section className="reaction-stage" aria-live="polite">
          <h1>
            {stage.headline.map((line) => <span key={line}>{line}</span>)}
            <em>{stage.accent}</em>
          </h1>
          <div className="member-status"><UsersThree size={19} weight="fill" />{stage.status}</div>
          <p className="stage-subline">{stage.subline}</p>
          <div className="raccoon-media">
            <img className="raccoon-art" src={stage.art} alt="A tired cartoon raccoon in a cheap green tie holding an empty coffee cup" />
          </div>
        </section>

        <div className="buy-stack">
          <section className="buy-panel buy-panel-preview" aria-labelledby="buy-panel-title">
            <div className="buy-panel-title" id="buy-panel-title">
              <span>99/1 BUY PREVIEW</span>
              <b>{MARKET.marketReady ? "LIVE ROUTE" : "PRE-LAUNCH"}</b>
            </div>

            <div className="allocation allocation-project">
              <div><strong>99%</strong><span>$401KEK</span></div>
              <img src="/brand/mark-99-1.png" alt="401KEK" />
              <small>99% OF NET INPUT</small>
            </div>

            <div className="allocation allocation-stock">
              <div><strong>1%</strong><span>QQQ</span></div>
              <img src="/assets/qqq-stock-token.png" alt="QQQ Robinhood Stock Token" />
              <small>1% OF NET INPUT</small>
            </div>

            <div className="panel-state">
              {MARKET.marketReady
                ? <CheckCircle size={28} weight="fill" />
                : <LockKey size={28} weight="bold" />}
              <span>{MARKET.marketReady ? "BOTH LEGS OR NEITHER" : "OFFICIAL GATEWAY NOT LIVE"}</span>
            </div>
          </section>

          <button
            className="buy-button"
            type="button"
            onClick={() => {
              setActionState("idle");
              setActionMessage("");
              setIsBuySheetOpen(true);
            }}
            disabled={!MARKET.marketReady || actionState === "working"}
          >
            {buttonLabel}
            {MARKET.marketReady ? <Wallet size={25} weight="fill" /> : <LockKey size={25} weight="fill" />}
          </button>

          <p className={`action-message${actionState === "error" ? " action-error" : ""}`}>
            {actionMessage || defaultActionMessage}
          </p>
        </div>
      </main>

      {isBuySheetOpen && (
        <div
          className="buy-dialog-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && actionState !== "working") setIsBuySheetOpen(false);
          }}
        >
          <section className="buy-dialog" role="dialog" aria-modal="true" aria-labelledby="buy-dialog-title">
            <div className="buy-dialog-head">
              <div>
                <span id="buy-dialog-title">MAKE THE BAD DECISION</span>
                <small>FEES FIRST. THEN 99/1.</small>
              </div>
              <button type="button" aria-label="Close buy dialog" onClick={() => setIsBuySheetOpen(false)} disabled={actionState === "working"}>
                <X size={24} weight="bold" />
              </button>
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
                />
                <b>ETH</b>
              </div>
            </label>

            <div className="dialog-split">
              <div><b>99%</b><span>{hasAmount ? `${splitAmount(amount, 0.99)} ETH` : "—"}<small>$401KEK ROUTE</small></span></div>
              <div><b>1%</b><span>{hasAmount ? `${splitAmount(amount, 0.01)} ETH` : "—"}<small>QQQ ROUTE</small></span></div>
            </div>

            <button className="dialog-buy-button" type="button" onClick={buy} disabled={!canBuy || actionState === "working"}>
              {actionState === "working" ? "OPENING WALLET…" : hasAmount ? "CONFIRM 99/1" : "ENTER AMOUNT"}
              <Wallet size={23} weight="fill" />
            </button>
            <p className={`dialog-message${actionState === "error" ? " action-error" : ""}`}>
              {actionMessage || "NO WALLET REQUEST UNTIL CONFIRM. BOTH LEGS OR NEITHER."}
            </p>
          </section>
        </div>
      )}

      <footer className="home-footer">
        <div className="footer-slogan">
          <span><b>99%</b> APE.</span>
          <span><b>1%</b> ADULT.</span>
        </div>
        <a className="footer-proof" href="/proof">VIEW FORMULA →</a>
      </footer>
    </div>
  );
}

function FormulaRow({ label, children, accent = false }) {
  return (
    <div className={`formula-row${accent ? " formula-row-accent" : ""}`}>
      <span>{label}</span>
      <code>{children}</code>
    </div>
  );
}

function ProofPage() {
  useEffect(() => {
    document.title = "THE 99/1 FORMULA — DEGEN PENSION";
  }, []);

  return (
    <div className="proof-page">
      <header className="proof-header">
        <Brand compact />
        <a className="back-link" href="/"><ArrowLeft size={17} weight="bold" /> BACK TO BUY</a>
      </header>

      <main className="proof-main">
        <section className="proof-intro">
          <span className="proof-kicker">THE RECEIPT, NOT THE PITCH</span>
          <h1>THE JOKE IS PUBLIC.<br /><em>THE SPLIT IS MATH.</em></h1>
          <p>Fees come out first. The remainder is split once. Both swaps settle directly to the same recipient. If either leg fails, the transaction reverts.</p>
        </section>

        <section className="formula-sheet" aria-labelledby="formula-heading">
          <div className="section-label"><Calculator size={23} weight="fill" /><span id="formula-heading">FEE-FIRST FORMULA</span></div>
          <FormulaRow label="EXPLICIT FEE">fee = floor(gross × feeBps ÷ 10,000)</FormulaRow>
          <FormulaRow label="NET INPUT">net = gross − fee</FormulaRow>
          <FormulaRow label="MEME LEG" accent>memeIn = floor(net × 9,900 ÷ 10,000)</FormulaRow>
          <FormulaRow label="STOCK LEG">stockIn = net − memeIn</FormulaRow>
          <p className="formula-note">The stock leg receives the integer remainder, so rounding cannot leave input dust behind. 99/1 is the net input-budget allocation—not the output token quantity or post-trade value ratio. Gas is separate.</p>
        </section>

        <section className="member-proof">
          <div className="section-label"><UsersThree size={23} weight="fill" /><span>WHAT “PENSION MEMBERS” MEANS</span></div>
          <div className="member-equation">
            <code>members = COUNT(UNIQUE SplitBuy.recipient)</code>
            <strong>WHERE stockAmountOut &gt; 0</strong>
          </div>
          <p>We count unique recipients from the official Gateway’s successful <code>SplitBuy</code> events. We do not count every project-token holder, every QQQ holder, transfers, airdrops, or direct DEX buys.</p>
        </section>

        <section className="code-section" aria-labelledby="code-heading">
          <div className="section-label"><Code size={23} weight="fill" /><span id="code-heading">SPLITBUYGATEWAY.SOL</span></div>
          <div className="code-grid">
            <article>
              <div className="code-head"><span>01 · CALCULATE</span><b>9,900 / 100 BPS</b></div>
              <pre><code>{CALCULATION_SOURCE}</code></pre>
            </article>
            <article>
              <div className="code-head"><span>02 · SETTLE</span><b>ATOMIC</b></div>
              <pre><code>{SETTLEMENT_SOURCE}</code></pre>
            </article>
          </div>
        </section>

        <section className="proof-truths">
          <div><CheckCircle size={24} weight="fill" /><p><b>DIRECT</b> Both outputs are measured in and delivered to the recipient wallet.</p></div>
          <div><CheckCircle size={24} weight="fill" /><p><b>ATOMIC</b> A revert on either adapter unwinds fee transfer, wrap, and both legs.</p></div>
          <div><WarningCircle size={24} weight="fill" /><p><b>UNAUDITED MVP</b> Production adapters, quotes, addresses, and deployment still require verification.</p></div>
        </section>
      </main>
    </div>
  );
}

export function App() {
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  return path === "/proof" ? <ProofPage /> : <HomePage />;
}
