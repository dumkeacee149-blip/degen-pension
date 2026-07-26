import { useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle,
  Code,
  Coins,
  Receipt,
  ShareNetwork,
  ShieldCheck,
  ShoppingCart,
  UsersThree,
} from "@phosphor-icons/react";
import { useMemberStats } from "./useMemberStats.js";
import { useRuntimeReadiness } from "./useRuntimeReadiness.js";
import "./flow-page.css";

const THREE_BEATS = [
  {
    title: "BUY THE MEME",
    Icon: ShoppingCart,
    copy: "When the official market opens, choose one amount on the 99/1 route. The wallet stays closed until you confirm.",
  },
  {
    title: "1% GOES ADULT",
    Icon: Coins,
    copy: "On the active route, the post-fee net amount will buy 99% $401KEK and 1% canonical QQQ atomically.",
  },
  {
    title: "PRINT THE RECEIPT",
    Icon: Receipt,
    copy: "Only a confirmed official SplitBuy event will unlock member status and a shareable retirement receipt.",
  },
];

function FlowBrand() {
  return (
    <a className="flow-brand" href="/" aria-label="Degen Pension home">
      <img src="/brand/mark-99-1-v2.webp" alt="" />
      <span>DEGEN PENSION</span>
      <b>401KEK</b>
    </a>
  );
}

function memberCopy(stats, marketReady) {
  if (!marketReady || stats.status === "prelaunch") {
    return { number: "—", label: "OFFICIAL MEMBERS", line: "FIRST QUALIFYING BUY OPENS THE RECEIPT WALL" };
  }
  if (stats.status === "loading") {
    return { number: "...", label: "COUNTING THE WALL", line: "READING CANONICAL SPLITBUY EVENTS" };
  }
  if (stats.status === "error") {
    return { number: "?", label: "INDEX OFFLINE", line: "THE COUNTER WILL RETURN. THE CHAIN RECEIPTS REMAIN." };
  }
  const count = stats.memberCount || 0;
  return {
    number: count.toLocaleString("en-US"),
    label: count === 1 ? "VERIFIED PENSION MEMBER" : "VERIFIED PENSION MEMBERS",
    line: "COUNTED FROM UNIQUE OFFICIAL 1% QQQ RECIPIENTS",
  };
}

export function FlowPage() {
  const runtime = useRuntimeReadiness();
  const stats = useMemberStats(runtime);
  const members = memberCopy(stats, runtime.ready);
  const marketActive = runtime.ready === true;
  const [shareLabel, setShareLabel] = useState("SHARE THE PLAN");

  useEffect(() => {
    document.title = "HOW 99/1 WORKS - DEGEN PENSION";
  }, []);

  const sharePlan = async () => {
    const text = marketActive
      ? "I found a retirement plan for people who buy meme coins: 99% $401KEK, 1% QQQ. 99% APE. 1% ADULT."
      : "A pre-launch 99/1 split-buy idea: 99% $401KEK, 1% QQQ. Market not active. 99% APE. 1% ADULT.";
    try {
      if (navigator.share) {
        await navigator.share({ title: "DEGEN PENSION", text, url: window.location.origin });
        setShareLabel("PLAN SHARED");
      } else {
        await navigator.clipboard.writeText(`${text} ${window.location.origin}`);
        setShareLabel("PLAN COPIED");
      }
    } catch (error) {
      if (error?.name !== "AbortError") setShareLabel("COPY FAILED");
    }
    window.setTimeout(() => setShareLabel("SHARE THE PLAN"), 1800);
  };

  return (
    <div className="flow-page">
      <a className="flow-skip-link" href="#flow-main">SKIP TO HOW IT WORKS</a>
      <header className="flow-header">
        <FlowBrand />
        <nav className="flow-header-actions" aria-label="Project page links">
          <a href="/code"><Code size={16} weight="bold" /> CODE</a>
          <a href="/"><ArrowLeft size={17} weight="bold" /> 99/1 HOME</a>
        </nav>
      </header>

      <main className="flow-main" id="flow-main" tabIndex="-1">
        <section className="flow-hero">
          <div className="flow-hero-copy">
            <div className={`flow-market-state ${marketActive ? "is-active" : "is-prelaunch"}`} role="status">
              <span>{marketActive ? "OFFICIAL 99/1 ROUTE" : "PRE-LAUNCH PROTOTYPE"}</span>
              <strong>{marketActive ? "RUNTIME CHECKS PASSED" : "MARKET NOT ACTIVE"}</strong>
            </div>
            <span className="flow-kicker">THE RETIREMENT PLAN YOUR GROUP CHAT DESERVES</span>
            <h1>BUY THE MEME.<br /><em>MAKE 1% GROW UP.</em></h1>
            <p>{marketActive
              ? "The official route buys $401KEK and QQQ together, then prints proof that your wallet joined the worst pension club online."
              : "This page explains the intended 99/1 route. Trading is not active: no wallet, quote, or transaction runs here until the official market opens."}</p>
            <div className="flow-hero-actions">
              <a className="flow-primary" href="/">{marketActive ? "OPEN 99/1" : "RETURN TO PROJECT"} <ArrowRight size={20} weight="bold" /></a>
              <button className="flow-secondary" type="button" onClick={sharePlan}><ShareNetwork size={18} weight="bold" />{shareLabel}</button>
            </div>
          </div>
          <div className="flow-hero-art">
            <img src="/assets/raccoon-deadpan-v2.webp" alt="A tired deadpan cartoon raccoon in a cheap suit and green tie holding an empty coffee cup" />
          </div>
        </section>

        <section className="three-beat" aria-labelledby="three-beat-heading">
          <header>
            <h2 id="three-beat-heading">THE WHOLE TRICK IN THREE BEATS.</h2>
            <p>{marketActive
              ? "No wallet on arrival. No mystery pool. No separate claim."
              : "INTENDED FLOW ONLY · NO ACTIVE MARKET · NO TRANSACTION ON THIS PAGE"}</p>
          </header>
          <div className="beat-grid">
            {THREE_BEATS.map(({ title, Icon, copy }, index) => (
              <article key={title}>
                <div className="beat-icon"><Icon size={29} weight="fill" aria-hidden="true" /></div>
                <h3>{title}</h3>
                <p>{copy}</p>
                {index < THREE_BEATS.length - 1 && <ArrowRight className="beat-arrow" size={26} weight="bold" aria-hidden="true" />}
              </article>
            ))}
          </div>
        </section>

        <section className="why-99-1">
          <div>
            <span>“WHY NOT JUST BUY BOTH MYSELF?”</span>
            <h2>YOU CAN.<br />YOU WON’T GET <em>THE RECEIPT.</em></h2>
          </div>
          <p>99/1 is not pretending to invent QQQ. The intended product is one atomic route plus public proof: member order, receipt art, and a place on the official pension wall after a confirmed qualifying buy.</p>
        </section>

        <section className="receipt-section" id="receipt" aria-labelledby="receipt-heading">
          <div className="receipt-character">
            <img src="/assets/raccoon-deadpan-v2.webp" alt="A tired deadpan cartoon raccoon in a cheap suit and green tie holding an empty coffee cup" />
            <p>THE RACCOON CHANGES JOB TITLE AS THE MEMBER WALL GROWS.</p>
          </div>
          <div className="receipt-copy">
            <h2 id="receipt-heading">THE REAL REWARD IS PROOF YOU WERE HERE.</h2>
            <p>A successful official buy unlocks a social object that is tied to the canonical SplitBuy event, not a screenshot anyone can fake.</p>
            <div className="receipt-preview" aria-label="Retirement receipt preview">
              <header><span>DEGEN PENSION</span><b>OFFICIAL 99/1 RECEIPT</b></header>
              {marketActive && (
                <div className="receipt-number"><small>MEMBER NUMBER</small><strong>{members.number}</strong></div>
              )}
              <div className="receipt-assets">
                <span><img src="/assets/badge-401kek-v1.webp" alt="401KEK badge" /><b>99% MEME</b></span>
                <span><img src="/assets/badge-qqq-v1.webp" alt="QQQ badge" /><b>1% ADULT</b></span>
              </div>
              <footer><span>SOURCE</span><b>CANONICAL SPLITBUY EVENT</b></footer>
            </div>
            <ul className="receipt-unlocks">
              <li><CheckCircle size={20} weight="fill" /><span><b>EVENT PROOF</b> Links back to the official Gateway transaction.</span></li>
              <li><UsersThree size={20} weight="fill" /><span><b>MEMBER ORDER</b> Derived from confirmed qualifying events.</span></li>
              <li><ShareNetwork size={20} weight="fill" /><span><b>SHARE CARD</b> Built to post without exposing a full wallet address.</span></li>
            </ul>
          </div>
        </section>

        <section className="money-truth" aria-labelledby="money-truth-heading">
          <div className="money-truth-head">
            <h2 id="money-truth-heading">THE MONEY TRUTH.</h2>
            <p>The 1% comes from your buy. The social reward comes from the project.</p>
          </div>
          <div className="money-equation">
            <div><span>YOU SEND</span><strong>GROSS INPUT</strong></div>
            <ArrowRight size={25} weight="bold" aria-hidden="true" />
            <div><span>FIRST</span><strong>DISCLOSED FEE</strong></div>
            <ArrowRight size={25} weight="bold" aria-hidden="true" />
            <div className="money-equation-result">
              <span>THEN</span><strong>99% $401KEK + 1% QQQ</strong><small>BOTH SETTLE OR THE WHOLE TRANSACTION REVERTS.</small>
            </div>
          </div>
          <details>
            <summary><ShieldCheck size={20} weight="fill" /> READ THE STRAIGHT ANSWERS</summary>
            <div className="truth-grid">
              <p><b>NOT A FREE STOCK REWARD.</b> The QQQ leg is purchased from your net input.</p>
              <p><b>DIRECT PONS OR DEX BUYS DO NOT COUNT.</b> Only the official Gateway produces the 99/1 receipt.</p>
              <p><b>SELLING $401KEK DOES NOT REMOVE QQQ.</b> The two assets are independent after settlement.</p>
              <p><b>NO WALLET NEEDED TO BROWSE.</b> The wallet opens only after you choose an amount and confirm.</p>
            </div>
          </details>
        </section>

        <section className={`receipt-wall ${marketActive ? "" : "receipt-wall-prelaunch"}`}>
          {marketActive && (
            <div className="wall-count">
              <span>{members.label}</span>
              <strong>{members.number}</strong>
            </div>
          )}
          <div>
            <h2>{marketActive ? "THE WALL IS ONCHAIN." : "THE WALL OPENS WITH THE MARKET."}</h2>
            <p>{marketActive ? "Every number is backed by a unique recipient in confirmed official SplitBuy events." : "No placeholder count, fake avatars, or invented volume. The first member number appears only after a confirmed official SplitBuy event."}</p>
          </div>
          <a href="/">{marketActive ? "BUY 99/1" : "RETURN HOME"}<ArrowRight size={20} weight="bold" /></a>
        </section>
      </main>

      <footer className="flow-footer">
        <span><b>99%</b> APE. <b>1%</b> ADULT.</span>
        <nav aria-label="Project footer links"><a href="/code">VERIFY THE CODE</a><a href="/">RETURN HOME</a></nav>
      </footer>
    </div>
  );
}

export default FlowPage;
