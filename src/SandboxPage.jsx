import { useEffect, useRef, useState } from "react";
import {
  ArrowClockwise,
  ArrowLeft,
  CheckCircle,
  Flask,
  Play,
  Receipt,
  ShieldCheck,
  WarningCircle,
} from "@phosphor-icons/react";
import { parseEthToWei } from "./launchRuntime.js";
import { runSandboxSimulation } from "./sandboxSimulation.js";
import "./sandbox-page.css";

const STAGE_COPY = Object.freeze({
  eligibility: ["01", "SANDBOX ELIGIBILITY", "Local policy fixture accepts the sandbox actor."],
  split: ["02", "FEE + NET 99/1", "The disclosed fee is removed before the net amount is split."],
  quote: ["03", "EXECUTABLE QUOTE", "Both deterministic fixture routes return non-zero minimums."],
  callSimulation: ["04", "INDEPENDENT CALL", "A read-only pass checks the same inputs without changing balances."],
  settlement: ["05", "ATOMIC SETTLEMENT", "Both legs commit together, or every balance returns to its start."],
  confirmations: ["06", "12 CONFIRMATIONS", "The receipt stays locked until the sandbox depth is complete."],
  receipt: ["07", "RECEIPT + MEMBER", "Only the confirmed simulated SplitBuy event unlocks the sandbox record."],
});

const TEN_ETH = 10n * 10n ** 18n;

function formatUnits(value, decimals = 18, precision = 4) {
  if (typeof value !== "bigint") return "—";
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const base = 10n ** BigInt(decimals);
  const whole = absolute / base;
  const fraction = String(absolute % base).padStart(decimals, "0").slice(0, precision).replace(/0+$/, "");
  return `${negative ? "−" : ""}${whole.toLocaleString("en-US")}${fraction ? `.${fraction}` : ""}`;
}

function sanitizeAmount(value) {
  const clean = value.replace(/[^0-9.]/g, "");
  const [whole, ...fraction] = clean.split(".");
  return fraction.length ? `${whole}.${fraction.join("").slice(0, 18)}` : whole;
}

function stageClass(stage, index, revealedCount) {
  if (index >= revealedCount) return "is-pending";
  if (["REVERTED", "ROLLED_BACK", "BLOCKED", "LOCKED"].includes(stage.status)) return "is-blocked";
  return "is-pass";
}

export function SandboxPage() {
  const [amount, setAmount] = useState("0.01");
  const [result, setResult] = useState(null);
  const [revealedCount, setRevealedCount] = useState(0);
  const [runState, setRunState] = useState("idle");
  const [error, setError] = useState("");
  const timersRef = useRef([]);

  const clearTimers = () => {
    timersRef.current.forEach((timer) => window.clearTimeout(timer));
    timersRef.current = [];
  };

  useEffect(() => {
    document.title = "99/1 SANDBOX - DEGEN PENSION";
    return clearTimers;
  }, []);

  const run = (failLeg = null) => {
    clearTimers();
    setError("");
    let grossAmountIn;
    try {
      grossAmountIn = parseEthToWei(amount);
      if (grossAmountIn > TEN_ETH) throw new Error("Sandbox input is capped at 10 ETH.");
    } catch (runError) {
      setRunState("error");
      setResult(null);
      setRevealedCount(0);
      setError(String(runError?.message || "Enter a valid sandbox amount."));
      return;
    }

    const next = runSandboxSimulation({ grossAmountIn, failLeg });
    setResult(next);
    setRevealedCount(0);
    setRunState("running");

    next.stages.forEach((_, index) => {
      const timer = window.setTimeout(() => {
        setRevealedCount(index + 1);
        if (index === next.stages.length - 1) {
          setRunState(next.status === "COMPLETED" ? "complete" : "reverted");
        }
      }, 260 * (index + 1));
      timersRef.current.push(timer);
    });
  };

  const complete = runState === "complete" && result?.receipt.unlocked;
  const reverted = runState === "reverted" && result?.settlement.reverted;
  const running = runState === "running";

  return (
    <div className="sandbox-page">
      <header className="sandbox-header">
        <a className="sandbox-brand" href="/" aria-label="Return to Degen Pension home">
          <img src="/brand/mark-99-1-v2.webp" alt="" />
          <span>DEGEN PENSION</span>
          <b>SANDBOX</b>
        </a>
        <a className="sandbox-back" href="/"><ArrowLeft size={18} weight="bold" /> HOME</a>
      </header>

      <main className="sandbox-main">
        <section className="sandbox-intro" aria-labelledby="sandbox-title">
          <div className="sandbox-kicker"><Flask size={18} weight="fill" /> BROWSER REHEARSAL · DETERMINISTIC</div>
          <h1 id="sandbox-title">RUN THE WHOLE<br /><em>99/1 CHAIN.</em></h1>
          <p>
            A zero-funds replay of eligibility, fee-first math, both quotes, independent call,
            atomic settlement, confirmations, and receipt unlock.
          </p>
          <div className="sandbox-truth">
            <WarningCircle size={22} weight="fill" />
            <p><b>NO WALLET · NO REAL FUNDS · NOT ROBINHOOD MAINNET</b>This browser replay never sends a transaction. The contract path is verified separately in an isolated EVM fork.</p>
          </div>
        </section>

        <section className="sandbox-console" aria-label="99/1 sandbox controls and results">
          <div className="sandbox-controls">
            <label htmlFor="sandbox-amount">SANDBOX GROSS INPUT</label>
            <div className="sandbox-amount">
              <input
                id="sandbox-amount"
                value={amount}
                inputMode="decimal"
                autoComplete="off"
                onChange={(event) => setAmount(sanitizeAmount(event.target.value))}
                disabled={running}
                aria-describedby="sandbox-input-note"
              />
              <span>ETH</span>
            </div>
            <small id="sandbox-input-note">FIXTURE LIMIT 10 ETH · CURRENT V2 SANDBOX FEE 0.00%</small>
            <div className="sandbox-buttons">
              <button type="button" onClick={() => run()} disabled={running}>
                {runState === "complete" ? <ArrowClockwise size={20} weight="bold" /> : <Play size={20} weight="fill" />}
                {runState === "complete" ? "RUN AGAIN" : running ? "RUNNING…" : "RUN FULL SIMULATION"}
              </button>
              <button type="button" onClick={() => run("stock")} disabled={running}>
                PROVE ROLLBACK
              </button>
            </div>
            {error ? <p className="sandbox-error" role="alert">{error.toUpperCase()}</p> : null}
          </div>

          <div className="sandbox-ledger" aria-live="polite" aria-atomic="false">
            <header>
              <span>EXECUTION LEDGER</span>
              <b>{running ? `${revealedCount} / 7` : complete ? "7 / 7 PASS" : reverted ? "ROLLBACK PROVEN" : "READY"}</b>
            </header>
            <ol>
              {(result?.stages || Object.keys(STAGE_COPY).map((key) => ({ key, status: "WAITING" }))).map((stage, index) => {
                const [number, title, copy] = STAGE_COPY[stage.key];
                const visible = index < revealedCount;
                return (
                  <li key={stage.key} className={stageClass(stage, index, revealedCount)}>
                    <span>{number}</span>
                    <div><b>{title}</b><small>{copy}</small></div>
                    <strong>{visible ? stage.status : "WAITING"}</strong>
                  </li>
                );
              })}
            </ol>
          </div>
        </section>

        {result ? (
          <section className="sandbox-evidence" aria-label="Sandbox evidence">
            <article>
              <span>FEE FIRST</span>
              <strong>{formatUnits(result.split.explicitFeeAmount)} ETH</strong>
              <small>{result.split.explicitFeeBps / 100}% DISCLOSED SANDBOX FIXTURE FEE</small>
            </article>
            <article className="is-project">
              <span>99% PROJECT LEG</span>
              <strong>{formatUnits(result.split.projectAmountIn)} ETH</strong>
              <small>QUOTE OUT {formatUnits(result.quote.projectAmountOut)} FIXTURE 401KEK</small>
            </article>
            <article>
              <span>1% QQQ LEG</span>
              <strong>{formatUnits(result.split.stockAmountIn)} ETH</strong>
              <small>QUOTE OUT {formatUnits(result.quote.stockAmountOut)} FIXTURE QQQ</small>
            </article>
            <article>
              <span>GATEWAY RETAINED</span>
              <strong>{formatUnits(result.settlement.balancesAfter.gatewayInput)} ETH</strong>
              <small>{result.settlement.committed ? "BOTH OUTPUTS SENT DIRECTLY" : "ALL BALANCES RESTORED"}</small>
            </article>
          </section>
        ) : null}

        {complete ? (
          <section className="sandbox-receipt" aria-labelledby="sandbox-receipt-title">
            <header><span id="sandbox-receipt-title"><Receipt size={20} weight="fill" /> SANDBOX 99/1 RECEIPT</span><b>CONFIRMED 12 / 12</b></header>
            <div className="sandbox-receipt-main">
              <div><small>SIMULATED MEMBER</small><strong>#0001</strong></div>
              <ShieldCheck size={62} weight="fill" aria-hidden="true" />
            </div>
            <dl>
              <div><dt>SIMULATION</dt><dd>{result.simulationId}</dd></div>
              <div><dt>RECEIPT</dt><dd>{result.receipt.receiptId}</dd></div>
              <div><dt>SETTLEMENT</dt><dd>BOTH LEGS COMMITTED</dd></div>
              <div><dt>CHAIN TX</dt><dd>NONE</dd></div>
            </dl>
            <footer><CheckCircle size={18} weight="fill" /> SANDBOX ONLY · NOT AN ONCHAIN RECEIPT OR REAL MEMBER NUMBER</footer>
          </section>
        ) : null}

        {reverted ? (
          <section className="sandbox-rollback" role="status">
            <WarningCircle size={30} weight="fill" />
            <div><b>STOCK LEG FAILED. THE COMPLETE BUY ROLLED BACK.</b><p>No fee, project output, QQQ output, receipt, or member number survived the failed atomic call.</p></div>
          </section>
        ) : null}
      </main>

      <footer className="sandbox-footer">
        <span>DETERMINISTIC UI REPLAY</span>
        <a href="/code">VERIFY THE CONTRACT CODE</a>
      </footer>
    </div>
  );
}

export default SandboxPage;
