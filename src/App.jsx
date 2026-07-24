import { useEffect, useMemo, useState } from "react";
import {
  ArrowDown, ArrowRight, ArrowSquareOut, Broadcast, Check, CheckCircle, Copy,
  Crosshair, FileText, Lightning, List, LockKey, SealCheck, ShieldCheck, Timer,
  Wallet, WarningCircle, X,
} from "@phosphor-icons/react";
import { ROBINHOOD_CHAIN as CHAIN, STOCK_TOKEN } from "./config.js";

const QQQ_ADDRESS = STOCK_TOKEN.address;

const launchSteps = [
  { id: "01", title: "CA lands", copy: "The token can come from any pre-supported launchpad—and it does not have to be deployed by us.", icon: Broadcast },
  { id: "02", title: "Manifest signed", copy: "Project Authority signs one official-token manifest. A lookalike CA can never inherit the route.", icon: FileText },
  { id: "03", title: "Gateway cloned", copy: "Factory binds the token, stock asset and pre-approved adapter addresses in one deterministic deployment.", icon: Lightning },
  { id: "04", title: "MarketReady", copy: "Only after an executable quote passes do the site and social channel reveal the official gateway.", icon: SealCheck },
];

function shortAddress(value) {
  if (!value) return "";
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function splitAmount(value, ratio) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return "0.0000";
  const result = number * ratio;
  return result < 0.0001 && result > 0 ? "<0.0001" : result.toFixed(4);
}

function CopyButton({ value, label = "Copy" }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };
  return (
    <button className="icon-action" type="button" onClick={copy} aria-label={`${label} address`}>
      {copied ? <Check size={16} weight="bold" /> : <Copy size={16} />}
      <span>{copied ? "Copied" : label}</span>
    </button>
  );
}

function SplitModal({ amount, onClose, onConnect, wallet, connecting }) {
  useEffect(() => {
    const onKeyDown = (event) => event.key === "Escape" && onClose();
    document.body.classList.add("modal-open");
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.classList.remove("modal-open");
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="review-modal" role="dialog" aria-modal="true" aria-labelledby="review-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div><span className="eyebrow">PRE-LAUNCH REVIEW</span><h2 id="review-title">One signature. Two assets.</h2></div>
          <button className="close-button" type="button" onClick={onClose} aria-label="Close review"><X size={22} /></button>
        </div>
        <div className="review-flow">
          <div className="review-amount"><span>You put in</span><strong>{Number(amount || 0).toFixed(4)} ETH</strong></div>
          <ArrowDown size={22} weight="bold" />
          <div className="review-split">
            <div><span className="ratio-large">99%</span><p>{splitAmount(amount, 0.99)} ETH route budget</p><small>buys the official project token</small></div>
            <div><span className="ratio-large ratio-stock">1%</span><p>{splitAmount(amount, 0.01)} ETH route budget</p><small>buys canonical QQQ Stock Token</small></div>
          </div>
        </div>
        <div className="truth-notice">
          <WarningCircle size={22} weight="fill" />
          <p><strong>This is an honest pre-launch prototype.</strong> No official project CA has been adopted yet, so this screen will not request funds or fabricate a transaction. At launch, adapter fees are quoted first and the remaining net amount is split 99/1 atomically.</p>
        </div>
        <ul className="review-checks">
          <li><CheckCircle size={18} weight="fill" />Both token outputs go straight to your wallet.</li>
          <li><CheckCircle size={18} weight="fill" />If either swap fails, the entire transaction reverts.</li>
          <li><CheckCircle size={18} weight="fill" />Selling the meme token never touches your QQQ token.</li>
        </ul>
        <div className="modal-actions">
          <button className="primary-button" type="button" onClick={onConnect} disabled={connecting}>
            <Wallet size={20} weight="bold" />{wallet ? `${shortAddress(wallet)} connected` : connecting ? "Connecting…" : "Connect for launch"}
          </button>
          <button className="text-button" type="button" onClick={onClose}>Back to office</button>
        </div>
      </section>
    </div>
  );
}

export function App() {
  const [amount, setAmount] = useState("0.20");
  const [wallet, setWallet] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [walletError, setWalletError] = useState("");
  const [reviewOpen, setReviewOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const numericAmount = useMemo(() => Math.max(0, Number(amount) || 0), [amount]);

  useEffect(() => {
    const ethereum = window.ethereum;
    if (!ethereum?.request) return undefined;
    const syncAccounts = (accounts) => setWallet(accounts?.[0] || "");
    ethereum.request({ method: "eth_accounts" }).then(syncAccounts).catch(() => {});
    ethereum.on?.("accountsChanged", syncAccounts);
    return () => ethereum.removeListener?.("accountsChanged", syncAccounts);
  }, []);

  const connectWallet = async () => {
    setWalletError("");
    if (!window.ethereum?.request) {
      setWalletError("No browser wallet detected. The product demo still works without one.");
      return;
    }
    setConnecting(true);
    try {
      const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
      setWallet(accounts?.[0] || "");
      const currentChain = await window.ethereum.request({ method: "eth_chainId" });
      if (String(currentChain).toLowerCase() !== CHAIN.chainId) {
        try {
          await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: CHAIN.chainId }] });
        } catch (switchError) {
          if (switchError?.code !== 4902) throw switchError;
          await window.ethereum.request({ method: "wallet_addEthereumChain", params: [CHAIN] });
        }
      }
    } catch (error) {
      setWalletError(error?.message || "Wallet connection was cancelled.");
    } finally {
      setConnecting(false);
    }
  };

  const sanitizeAmount = (value) => {
    const clean = value.replace(/[^0-9.]/g, "");
    const [whole, ...fraction] = clean.split(".");
    setAmount(fraction.length ? `${whole}.${fraction.join("").slice(0, 6)}` : whole);
  };

  return (
    <div className="site-shell">
      <header className="site-header">
        <a className="wordmark" href="#top" aria-label="Degen Pension home"><span className="wordmark-mark">99/1</span><span>DEGEN<br />PENSION</span></a>
        <nav className={menuOpen ? "nav-links nav-links-open" : "nav-links"} aria-label="Primary navigation">
          <a href="#split" onClick={() => setMenuOpen(false)}>Split buy</a>
          <a href="#mechanism" onClick={() => setMenuOpen(false)}>Mechanism</a>
          <a href="#launch" onClick={() => setMenuOpen(false)}>Launch</a>
          <a href="#meme" onClick={() => setMenuOpen(false)}>401KEK</a>
        </nav>
        <div className="header-actions">
          <span className="network-pill"><span /> ROBINHOOD CHAIN</span>
          <button className="wallet-button" type="button" onClick={connectWallet} disabled={connecting}><Wallet size={18} weight="bold" />{wallet ? shortAddress(wallet) : connecting ? "CONNECTING" : "CONNECT WALLET"}</button>
          <button className="menu-button" type="button" aria-label="Toggle navigation" aria-expanded={menuOpen} onClick={() => setMenuOpen((value) => !value)}>{menuOpen ? <X size={23} /> : <List size={23} />}</button>
        </div>
      </header>

      <main id="top">
        <div className="status-ribbon" aria-label="Protocol status">
          <div><span>FACTORY</span><strong><Check size={14} weight="bold" />MVP TESTED</strong></div>
          <div><span>MARKET</span><strong className="status-waiting">AWAITING OFFICIAL CA</strong></div>
          <div><span>ROUTE</span><strong>99 / 1 IMMUTABLE</strong></div>
          <div><span>CUSTODY</span><strong>NONE</strong></div>
        </div>

        <section className="hero" id="split">
          <div className="hero-copy">
            <span className="issue-label">ISSUE № 001 · RETIREMENT FOR DEGENS</span>
            <h1><span>99% APE.</span><br /><em>1% ADULT.</em></h1>
            <p className="hero-deck">Buy the meme coin you came for. Route one honest percent into a real stock token—inside the same transaction, straight to your wallet.</p>
            <div className="split-panel">
              <div className="panel-kicker"><span>THE SPLIT BUY</span><span className="demo-label">PRE-LAUNCH DEMO</span></div>
              <label className="amount-box">
                <span className="field-label">YOU PAY</span>
                <div className="amount-row">
                  <input value={amount} onChange={(event) => sanitizeAmount(event.target.value)} inputMode="decimal" aria-label="ETH amount" />
                  <div className="asset-chip"><span className="eth-glyph">Ξ</span> ETH</div>
                  <button type="button" onClick={() => setAmount("1.00")}>MAX</button>
                </div>
              </label>
              <div className="split-track" aria-label="99 percent meme token, 1 percent stock token">
                <div className="split-track-main"><strong>99%</strong><span>PROJECT TOKEN</span></div><div className="split-track-stock"><strong>1%</strong></div>
              </div>
              <div className="allocation-table">
                <div><span className="token-dot token-dot-main">99</span><div><strong>OFFICIAL PROJECT TOKEN</strong><small>Bound after signed CA adoption</small></div><b>{splitAmount(amount, 0.99)} ETH</b></div>
                <div><span className="token-dot token-dot-stock"><img src="/assets/qqq-stock-token.png" alt="" /></span><div><strong>QQQ STOCK TOKEN</strong><small>Canonical Robinhood Chain asset</small></div><b>{splitAmount(amount, 0.01)} ETH</b></div>
              </div>
              <button className="primary-button split-submit" type="button" onClick={() => setReviewOpen(true)} disabled={!numericAmount}>REVIEW 99/1 SPLIT <ArrowRight size={21} weight="bold" /></button>
              <div className="panel-footnote"><LockKey size={15} /> Route fees are deducted first. The net amount is then split 99/1.</div>
              {walletError && <p className="wallet-error">{walletError}</p>}
            </div>
          </div>

          <div className="hero-art" aria-label="99 Brother and One Junior in the Degen Pension office">
            <div className="art-caption art-caption-top">99哥负责上头</div>
            <img src="/assets/hero-raccoon-office.png" alt="A manic raccoon trader and a tiny deadpan accountant at a vintage retirement desk" />
            <div className="art-caption art-caption-bottom">1仔负责活到退休</div>
            <div className="stamp">401<br /><span>KEK</span></div>
          </div>
        </section>

        <section className="proof-strip">
          <div><ShieldCheck size={25} weight="fill" /><span><strong>ATOMIC</strong>both buys or neither</span></div>
          <div><Wallet size={25} weight="fill" /><span><strong>DIRECT</strong>both assets to you</span></div>
          <div><Crosshair size={25} weight="fill" /><span><strong>OFFICIAL</strong>one CA, one gateway</span></div>
          <div><LockKey size={25} weight="fill" /><span><strong>IMMUTABLE</strong>99/1 cannot drift</span></div>
        </section>

        <section className="mechanism section-frame" id="mechanism">
          <div className="section-heading"><span className="section-number">01</span><div><span className="eyebrow">THE MECHANISM</span><h2>YOUR MONEY DOES THE WORK.<br /><em>NOT OUR TREASURY.</em></h2></div></div>
          <div className="mechanism-grid">
            <div className="big-ratio"><span className="ratio-99">99</span><span className="ratio-slash">/</span><span className="ratio-1">1</span><p>There is no mystery reward pool. Your net purchase is divided at execution.</p></div>
            <div className="mechanism-copy">
              <div className="flow-line"><span>YOUR ETH</span><ArrowRight size={20} /><span>ADAPTER QUOTE</span><ArrowRight size={20} /><span>NET 99/1</span></div>
              <h3>Not an airdrop. Not points. Not a promise.</h3>
              <p>The official gateway receives one payment. Any explicit platform fee is applied, then 99% of the remainder buys the project token and 1% buys QQQ. The swaps settle to the same recipient in one call.</p>
              <div className="plain-truths">
                <div><strong>Buy elsewhere?</strong><span>You get 100/0. Only the official gateway creates the split.</span></div>
                <div><strong>Sell the meme?</strong><span>Your stock token stays untouched in your wallet.</span></div>
                <div><strong>One route fails?</strong><span>The transaction reverts. No half-filled pension.</span></div>
              </div>
            </div>
          </div>
        </section>

        <section className="official-section section-frame">
          <div className="official-copy">
            <span className="eyebrow">OFFICIAL OR NOTHING</span><h2>A CA IS JUST AN ADDRESS.<br /><em>AUTHORITY MAKES IT OURS.</em></h2>
            <p>The token creator can be anyone. Ownership is proven by a signed Project Authority manifest—not by who deployed, bought or held the token. The gateway accepts exactly one adopted CA.</p>
            <a className="inline-link" href="#launch">See the 120-second launch path <ArrowRight size={18} /></a>
          </div>
          <div className="address-ledger">
            <div className="ledger-head"><span>CANONICAL LEDGER</span><span>ROBINHOOD CHAIN · 4663</span></div>
            <div className="ledger-row"><span>PROJECT TOKEN</span><code>WAITING_FOR_OFFICIAL_CA</code><b className="waiting-tag">PENDING</b></div>
            <div className="ledger-row"><span>STOCK TOKEN / QQQ</span><code>{shortAddress(QQQ_ADDRESS)}</code><CopyButton value={QQQ_ADDRESS} /></div>
            <div className="ledger-row"><span>SPLIT GATEWAY</span><code>DEPLOYS_AFTER_CA</code><b className="waiting-tag">PENDING</b></div>
            <div className="ledger-warning"><WarningCircle size={20} />A copied website cannot make a copied CA official.</div>
          </div>
        </section>

        <section className="launch-section section-frame" id="launch">
          <div className="section-heading launch-heading">
            <span className="section-number">02</span><div><span className="eyebrow">THE LAUNCH CLOCK</span><h2>CA TO MARKETREADY.<br /><em>TARGET: 60–120 SECONDS.</em></h2></div>
            <div className="clock-badge"><Timer size={30} weight="fill" /><strong>150s</strong><span>HARD STOP</span></div>
          </div>
          <div className="launch-grid">
            {launchSteps.map((step) => { const Icon = step.icon; return <article className="launch-step" key={step.id}><div className="step-top"><span>{step.id}</span><Icon size={25} weight="fill" /></div><h3>{step.title}</h3><p>{step.copy}</p></article>; })}
          </div>
          <div className="launch-rule"><Broadcast size={22} weight="fill" /><p><strong>The social rule:</strong> never publish the CA alone. Publish CA + verified gateway only after MarketReady.</p></div>
        </section>

        <section className="meme-section" id="meme">
          <div className="meme-title"><span className="eyebrow">THE 401KEK OFFICE</span><h2>TWO IDIOTS.<br /><em>ONE SURVIVAL INSTINCT.</em></h2></div>
          <div className="character-grid">
            <article className="character-card character-99"><div className="character-index">99</div><span className="character-role">CHIEF DEGEN OFFICER</span><h3>99哥</h3><p>Manic raccoon. Zero risk committee. Responsible for buying the thing everyone told you not to buy.</p><blockquote>“Retirement is just a longer time horizon.”</blockquote></article>
            <article className="character-card character-1"><div className="character-index">1</div><span className="character-role">UNPAID RISK DEPARTMENT</span><h3>1仔</h3><p>Tiny accountant. Permanent deadpan. Quietly moves one cent out of every dollar toward adulthood.</p><blockquote>“I kept the receipt.”</blockquote></article>
          </div>
          <div className="meme-banner"><span>梭哈归梭哈</span><span className="banner-divider">/</span><strong>养老归养老</strong></div>
        </section>

        <section className="security-section section-frame">
          <div><span className="eyebrow">NO TRUST-ME BUTTON</span><h2>VERIFY THE JOKE.</h2></div>
          <div className="security-list">
            <div><span>01</span><p><strong>Fixed ratio</strong>9,900 / 100 basis-point constants in gateway bytecode.</p></div>
            <div><span>02</span><p><strong>Fixed targets</strong>Official token, stock token and adapters cannot be swapped by a UI admin.</p></div>
            <div><span>03</span><p><strong>No custody</strong>Outputs route to the buyer; the gateway is not a rewards vault.</p></div>
            <div><span>04</span><p><strong>Public evidence</strong>Manifest, deployment tx and executable quote become the launch receipt.</p></div>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <div className="footer-mark">DEGEN PENSION <span>99/1</span></div><p>99% APE. 1% ADULT. Built for Robinhood Chain.</p>
        <div className="footer-links"><a href="#mechanism">Mechanism</a><a href="#launch">Launch rules</a><a href="https://docs.robinhood.com/chain/" target="_blank" rel="noreferrer">Chain docs <ArrowSquareOut size={14} /></a></div>
        <small>Prototype only. No official CA or live gateway is represented on this page. Stock tokens carry market and smart-contract risk.</small>
      </footer>
      {reviewOpen && <SplitModal amount={numericAmount} onClose={() => setReviewOpen(false)} onConnect={connectWallet} wallet={wallet} connecting={connecting} />}
    </div>
  );
}
