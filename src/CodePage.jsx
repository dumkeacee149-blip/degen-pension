import { useEffect } from "react";
import {
  ArrowLeft,
  ArrowSquareOut,
  Calculator,
  CheckCircle,
  Code,
  Coins,
  ShieldCheck,
  UsersThree,
} from "@phosphor-icons/react";
import { STOCK_TOKEN } from "./config.js";
import "./code-page.css";

const CALCULATION_SOURCE = `function _calculateAmounts(uint256 grossAmountIn) private view returns (BuyAmounts memory amounts) {
    amounts.explicitFeeAmount = grossAmountIn * explicitFeeBps / BPS_DENOMINATOR;
    amounts.netAmountIn = grossAmountIn - amounts.explicitFeeAmount;
    amounts.projectAmountIn = amounts.netAmountIn * PROJECT_BPS / BPS_DENOMINATOR;
    amounts.stockAmountIn = amounts.netAmountIn - amounts.projectAmountIn;
}`;

const SETTLEMENT_SOURCE = `function _settleBuy(
    uint256 grossAmountIn,
    uint256 minProjectOut,
    uint256 minStockOut,
    address recipient
) private returns (uint256 projectAmountOut, uint256 stockAmountOut) {
    BuyAmounts memory amounts = _calculateAmounts(grossAmountIn);
    if (amounts.projectAmountIn == 0 || amounts.stockAmountIn == 0) revert InvalidAmount();

    if (amounts.explicitFeeAmount != 0) {
        IERC20(inputToken).safeTransfer(feeRecipient, amounts.explicitFeeAmount);
    }
    projectAmountOut = _executeLeg(
        officialToken, projectAdapter, amounts.projectAmountIn, minProjectOut, recipient
    );
    stockAmountOut = _executeLeg(
        stockToken, stockAdapter, amounts.stockAmountIn, minStockOut, recipient
    );

    emit SplitBuy(
        msg.sender,
        recipient,
        grossAmountIn,
        amounts.explicitFeeAmount,
        amounts.netAmountIn,
        amounts.projectAmountIn,
        amounts.stockAmountIn,
        projectAmountOut,
        stockAmountOut
    );
}`;

const MEMBER_INDEX_SOURCE = `if (isStatsIndexerConfigured(config)) {
  const bindings = {
    gatewayAddress,
    officialTokenAddress,
    stockTokenAddress: config.stockTokenAddress,
    activatedBlock,
  };
  const payload = await loadIndexedStatsSnapshot(config, {
    ...bindings,
    recipient,
    fetchImpl,
  });
  return indexedMemberSnapshot(config, payload, bindings, recipient);
}

if (!canUseBoundedStatsFallback(config)) {
  throw new ApiError(503, "STATS_INDEXER_REQUIRED");
}

// Explicit non-production fallback only; still confirmation-safe and bounded.
if (scanBlocks > BigInt(config.memberMaxScanBlocks)) {
  throw new ApiError(503, "MEMBER_INDEX_REQUIRED");
}`;

const QQQ_DELIVERY_SOURCE = `function _executeLeg(
    address output,
    address adapter,
    uint256 amountIn,
    uint256 minimumOut,
    address recipient
) private returns (uint256 amountOut) {
    uint256 balanceBefore = IERC20(output).balanceOf(recipient);
    IERC20(inputToken).safeTransfer(adapter, amountIn);
    uint256 reportedOut = ISwapAdapter(adapter).swapExactInput(
        amountIn, minimumOut, recipient
    );
    amountOut = IERC20(output).balanceOf(recipient) - balanceBefore;

    if (amountOut < minimumOut || amountOut != reportedOut) {
        revert InvalidAdapterOutput(adapter, reportedOut, amountOut, minimumOut);
    }
}`;

const CODE_BLOCKS = [
  {
    number: "01",
    title: "FEE-FIRST SPLIT",
    tag: "9,900 / 100 BPS",
    source: "contracts/src/SplitBuyGatewayV2.sol",
    code: CALCULATION_SOURCE,
  },
  {
    number: "02",
    title: "ATOMIC SETTLEMENT",
    tag: "BOTH OR NEITHER",
    source: "contracts/src/SplitBuyGatewayV2.sol",
    code: SETTLEMENT_SOURCE,
  },
  {
    number: "03",
    title: "COUNT MEMBERS",
    tag: "CANONICAL EVENTS",
    source: "server/stats.js",
    code: MEMBER_INDEX_SOURCE,
  },
];

const CODE_CHECKS = [
  ["SPLIT FORMULA", "PASSED"],
  ["ATOMIC SETTLEMENT", "PASSED"],
  ["DIRECT QQQ DELIVERY", "PASSED"],
  ["CANONICAL MEMBER INDEX", "PASSED"],
  ["FAIL-CLOSED STATS", "PASSED"],
];

function FormulaRow({ label, children, accent = false }) {
  return (
    <div className={`code-page-formula-row${accent ? " code-page-formula-row-accent" : ""}`}>
      <span>{label}</span>
      <code>{children}</code>
    </div>
  );
}

function CodeBrand() {
  return (
    <a className="code-page-brand" href="/" aria-label="Degen Pension home">
      <img src="/brand/mark-99-1-v2.webp" alt="" />
      <span>DEGEN PENSION</span>
      <b>401KEK</b>
    </a>
  );
}

export function CodePage() {
  useEffect(() => {
    document.title = "PROJECT CODE - DEGEN PENSION";
  }, []);

  return (
    <div className="project-code-page">
      <a className="code-page-skip-link" href="#code-page-main">SKIP TO CODE</a>
      <header className="code-page-header">
        <CodeBrand />
        <div className="code-page-header-actions">
          <a className="code-page-back" href="/flow">HOW IT WORKS</a>
          <a className="code-page-back" href="/"><ArrowLeft size={17} weight="bold" /> BACK TO HOME</a>
        </div>
      </header>

      <main className="code-page-main" id="code-page-main" tabIndex={-1}>
        <section className="code-page-intro">
          <span className="code-page-kicker">PUBLIC LOGIC · REPOSITORY TESTS · CODE ONLY</span>
          <h1>THE MEME IS LOUD.<br /><em>THE CODE IS PUBLIC.</em></h1>
          <div className="code-page-intro-copy">
            <p>Source-matched excerpts. Repository-tested paths. No account details, signing controls, or live transaction interface.</p>
            <nav aria-label="Runtime code sections">
              <a href="#qqq-delivery"><b>QQQ</b>DIRECT DELIVERY</a>
              {CODE_BLOCKS.map((block) => (
                <a key={block.number} href={`#runtime-${block.number}`}><b>{block.number}</b>{block.title}</a>
              ))}
            </nav>
          </div>
        </section>

        <section className="code-page-review" id="code-review" aria-labelledby="code-review-heading">
          <div className="code-page-section-label">
            <ShieldCheck size={23} weight="fill" />
            <span id="code-review-heading">CODE REVIEW · PUBLIC IMPLEMENTATION</span>
          </div>
          <div className="code-page-review-status">
            <div><b>REVIEW RESULT</b><strong>ALL PASSED</strong></div>
            <p>Every status below maps to implementation visible on this page and repository test coverage. Operational release status is outside this code-only view.</p>
          </div>
          <div className="code-page-checks" aria-label="Public code checks">
            <div className="code-page-checks-heading">
              <span>PUBLIC CODE CHECKS</span>
              <strong>5 / 5 PASSED</strong>
            </div>
            <dl>
              {CODE_CHECKS.map(([label, result]) => (
                <div key={label}><dt>{label}</dt><dd><CheckCircle size={16} weight="fill" /> {result}</dd></div>
              ))}
            </dl>
            <p>PASS means the code path is implemented and covered by repository verification. It is not a live-market claim.</p>
          </div>
        </section>

        <section className="code-page-qqq" id="qqq-delivery" aria-labelledby="qqq-delivery-heading">
          <div className="code-page-section-label">
            <Coins size={23} weight="fill" />
            <span id="qqq-delivery-heading">QQQ DELIVERY · IMPLEMENTED GUARANTEES</span>
          </div>
          <div className="code-page-qqq-summary">
            <div>
              <span>STOCK LEG TARGET</span>
              <strong>ROBINHOOD QQQ</strong>
              <div className="code-page-qqq-links">
                <a href={STOCK_TOKEN.registryUrl} target="_blank" rel="noreferrer">OFFICIAL ASSET REGISTRY <ArrowSquareOut weight="bold" /></a>
              </div>
            </div>
            <div>
              <span>DELIVERY MODEL</span>
              <strong>BOUGHT, NOT AIRDROPPED.</strong>
              <p>
                The Gateway implementation requires the 1% stock leg to reach the buyer in the
                same transaction and rejects adapter reports that do not match the measured output.
              </p>
            </div>
          </div>
          <div className="code-page-qqq-detail">
            <pre aria-label="QQQ direct-delivery contract code"><code>{QQQ_DELIVERY_SOURCE}</code></pre>
            <div className="code-page-readiness" aria-label="QQQ implementation checks">
              <div className="is-implemented"><b>PASS</b><p>Canonical Robinhood QQQ is mapped from the chain-4663 asset registry.</p></div>
              <div className="is-implemented"><b>PASS</b><p>The output-token balance delta is measured after every adapter call.</p></div>
              <div className="is-implemented"><b>PASS</b><p>The measured output must equal the adapter&apos;s reported output.</p></div>
              <div className="is-implemented"><b>PASS</b><p>Minimum output is enforced against the measured delivery amount.</p></div>
              <div className="is-implemented"><b>PASS</b><p>Either leg failing unwinds the complete 99/1 settlement.</p></div>
            </div>
          </div>
          <p className="code-page-qqq-note">CODE SCOPE ONLY · The implementation proof above does not assert live liquidity, market activation, or release readiness.</p>
        </section>

        <section className="code-page-formula" aria-labelledby="code-formula-heading">
          <div className="code-page-section-label">
            <Calculator size={23} weight="fill" />
            <span id="code-formula-heading">FEE FIRST. THEN 99 / 1.</span>
          </div>
          <FormulaRow label="EXPLICIT FEE">fee = floor(gross × feeBps ÷ 10,000)</FormulaRow>
          <FormulaRow label="NET INPUT">net = gross − fee</FormulaRow>
          <FormulaRow label="MEME LEG" accent>memeIn = floor(net × 9,900 ÷ 10,000)</FormulaRow>
          <FormulaRow label="STOCK LEG">stockIn = net − memeIn</FormulaRow>
          <p className="code-page-formula-note">The stock leg receives the integer remainder. The 99/1 ratio describes net input allocation, not output-token quantity, post-trade value, or gas.</p>
        </section>

        <section className="code-page-members" aria-labelledby="code-members-heading">
          <div className="code-page-section-label">
            <UsersThree size={23} weight="fill" />
            <span id="code-members-heading">WHAT “PENSION MEMBERS” COUNTS</span>
          </div>
          <div className="code-page-member-equation">
            <code>COUNT(UNIQUE SplitBuy.recipient)</code>
            <strong>WHERE stockAmountOut &gt; 0</strong>
          </div>
          <p>Only successful <code>SplitBuy</code> events emitted by the configured canonical Gateway qualify. Recipients are deduplicated. Token holders, QQQ holders, transfers, airdrops, and direct DEX buys are excluded.</p>
        </section>

        <section className="code-page-runtime" aria-labelledby="code-runtime-heading">
          <div className="code-page-section-label">
            <Code size={23} weight="fill" />
            <span id="code-runtime-heading">THREE IMPLEMENTATION PATHS · SOURCE-MATCHED</span>
          </div>
          <div className="code-page-grid">
            {CODE_BLOCKS.map((block) => (
              <article id={`runtime-${block.number}`} key={block.number}>
                <header>
                  <div><b>{block.number}</b><span>{block.title}</span></div>
                  <strong>{block.tag}</strong>
                </header>
                <p>{block.source}</p>
                <pre><code>{block.code}</code></pre>
              </article>
            ))}
          </div>
        </section>

        <section className="code-page-truths" aria-label="Implemented guarantees">
          <div><CheckCircle size={25} weight="fill" /><p><b>DIRECT · TESTED</b>The Gateway implementation measures both output-token balance changes at the recipient.</p></div>
          <div><CheckCircle size={25} weight="fill" /><p><b>ATOMIC · TESTED</b>The Gateway implementation unwinds the transaction if the fee transfer or either adapter call reverts.</p></div>
          <div><CheckCircle size={25} weight="fill" /><p><b>FAIL-CLOSED · TESTED</b>Production statistics require a signed durable index; the bounded scan stays development-only.</p></div>
          <div><CheckCircle size={25} weight="fill" /><p><b>CANONICAL · TESTED</b>Member totals count unique qualifying SplitBuy recipients from the configured Gateway.</p></div>
        </section>
      </main>

      <footer className="code-page-footer">
        <span><b>99%</b> APE. <b>1%</b> ADULT.</span>
        <nav aria-label="Code page footer links"><a href="/flow">HOW IT WORKS</a><a href="/"><ArrowLeft size={16} weight="bold" /> RETURN HOME</a></nav>
      </footer>
    </div>
  );
}

export default CodePage;
