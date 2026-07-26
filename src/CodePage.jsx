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
  Wallet,
  WarningCircle,
} from "@phosphor-icons/react";
import { STOCK_TOKEN } from "./config.js";
import {
  explorerAddress,
  PRODUCTION_DEPLOYMENT,
} from "./productionDeployment.js";
import { useRuntimeReadiness } from "./useRuntimeReadiness.js";
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

const BUY_CALL_SOURCE = `const executableQuote = await requestAndValidateQuote({
  market: MARKET,
  chain: CHAIN,
  wallet,
  amountEth: amount,
  runtime: liveRuntime,
  termsAccepted: true,
  notUSPerson: true,
});

const transactionHash = await window.ethereum.request({
  method: "eth_sendTransaction",
  params: [{
    from: wallet,
    to: executableQuote.transaction.to,
    data: executableQuote.transaction.data,
    value: executableQuote.transaction.value,
  }],
});`;

const ACTIVATION_SOURCE = `function activatePonsMarket(address officialToken)
    external
    returns (address market, address projectAdapter)
{
    if (msg.sender != launchOperator) revert UnauthorizedLaunchOperator(msg.sender);
    if (!operatorAuthorized) revert LaunchOperatorNotAuthorized();
    if (currentMarket != address(0)) revert MarketAlreadyActivated(currentMarket);
    (market, projectAdapter) = _activate(officialToken, false);
}

function _activate(address officialToken, bool replacement)
    private
    returns (address market, address projectAdapter)
{
    projectAdapter = ponsAdapterFactory.adapterFor(officialToken);
    if (projectAdapter == address(0)) {
        projectAdapter = ponsAdapterFactory.createAdapter(officialToken);
    }
    market = address(implementation).clone();
    SplitBuyGatewayV2(payable(market)).initialize(
        officialToken, CANONICAL_QQQ, projectAdapter, address(stockAdapter),
        0, address(0), address(this), address(eligibilityChecker), maxAmountIn
    );
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
  {
    number: "04",
    title: "VALIDATE + SUBMIT",
    tag: "OFFICIAL GATEWAY",
    source: "src/App.jsx",
    code: BUY_CALL_SOURCE,
  },
  {
    number: "05",
    title: "CA-ONLY V2 ACTIVATION",
    tag: "PREAUTHORIZED OPERATOR",
    source: "contracts/src/ProductionMarketActivator.sol",
    code: ACTIVATION_SOURCE,
  },
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

function liveGateLabel(runtime, check, readyLabel = "READY") {
  if (runtime.status === "checking") return "CHECKING";
  if (runtime.ready && runtime.checks?.[check]) return readyLabel;
  if (runtime.checks?.[check]) return "CHECK PASSED · MARKET BLOCKED";
  return "BLOCKED";
}

export function CodePage() {
  const runtime = useRuntimeReadiness();
  const liveMarketStatus = runtime.status === "checking"
    ? "CHECKING"
    : runtime.ready
      ? "READY"
      : "BLOCKED";

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
          <span className="code-page-kicker">PUBLIC LOGIC · REPOSITORY TESTS · LIVE STATUS SEPARATE</span>
          <h1>THE MEME IS LOUD.<br /><em>THE CODE IS PUBLIC.</em></h1>
          <div className="code-page-intro-copy">
            <p>These source-matched excerpts show implemented and repository-tested logic. They are not a production-readiness claim; the live gate below is the authority for whether a buy route is currently usable.</p>
            <nav aria-label="Runtime code sections">
              <a href="#qqq-delivery"><b>QQQ</b>DELIVERY READINESS</a>
              {CODE_BLOCKS.map((block) => (
                <a key={block.number} href={`#runtime-${block.number}`}><b>{block.number}</b>{block.title}</a>
              ))}
            </nav>
          </div>
        </section>

        <section className="code-page-deployment" id="deployment-proof" aria-labelledby="deployment-proof-heading">
          <div className="code-page-section-label">
            <ShieldCheck size={23} weight="fill" />
            <span id="deployment-proof-heading">PRODUCTION V2 · AUTHORITATIVE ONCHAIN RECORD</span>
          </div>
          <div className="code-page-deployment-status">
            <div><b>PRODUCTION V2</b><strong>{PRODUCTION_DEPLOYMENT.tradingActive ? "MARKET RECORDED" : "PREAUTHORIZED"}</strong></div>
            <p>
              The ProductionMarketActivator registry and its fixed V2 components are deployed
              and source-verified. The operator is authorized.
              {PRODUCTION_DEPLOYMENT.tradingActive
                ? " The checked-in manifest pins the current official CA, Gateway and activation block."
                : " The checked-in manifest records no official CA or current market."}
              {" "}A buy route exists only when every live runtime gate below reports READY at the same time.
            </p>
          </div>
          <div className="code-page-live-gates" role="status" aria-live="polite" aria-atomic="true">
            <div className="code-page-live-gates-heading">
              <span>LIVE PRODUCTION GATE</span>
              <strong>{liveMarketStatus}</strong>
            </div>
            <dl>
              <div><dt>ONCHAIN RUNTIME</dt><dd>{liveGateLabel(runtime, "runtime")}</dd></div>
              <div><dt>QUOTE ROUTE / SERVICE</dt><dd>{liveGateLabel(runtime, "quote", "ROUTE READY")}</dd></div>
              <div><dt>ELIGIBILITY SERVICE</dt><dd>{liveGateLabel(runtime, "eligibility")}</dd></div>
              <div><dt>OPERATIONS</dt><dd>{liveGateLabel(runtime, "operations")}</dd></div>
              <div><dt>INDEPENDENT AUDIT</dt><dd>{liveGateLabel(runtime, "audit")}</dd></div>
            </dl>
            <p>
              {runtime.status === "checking"
                ? "Reading the same-origin production runtime. No capability is marked ready while this check is incomplete."
                : runtime.ready
                  ? "All release gates passed against the same canonical market. The homepage still rechecks them immediately before any wallet request."
                  : `Buying remains disabled. ${runtime.reason || "One or more production checks did not pass."}`}
            </p>
          </div>
          <dl className="code-page-deployment-grid">
            <div>
              <dt>PRODUCTION V2 REGISTRY</dt>
              <dd>{PRODUCTION_DEPLOYMENT.registryAddress}</dd>
              <a href={explorerAddress(PRODUCTION_DEPLOYMENT.registryAddress)} target="_blank" rel="noreferrer">SOURCE VERIFIED <ArrowSquareOut weight="bold" /></a>
            </div>
            <div>
              <dt>LOCKED V2 GATEWAY IMPLEMENTATION</dt>
              <dd>{PRODUCTION_DEPLOYMENT.gatewayImplementationAddress}</dd>
              <a href={explorerAddress(PRODUCTION_DEPLOYMENT.gatewayImplementationAddress)} target="_blank" rel="noreferrer">SOURCE VERIFIED <ArrowSquareOut weight="bold" /></a>
            </div>
            <div>
              <dt>FIXED LAUNCH OPERATOR</dt>
              <dd>{PRODUCTION_DEPLOYMENT.launchOperator}</dd>
              <a href={explorerAddress(PRODUCTION_DEPLOYMENT.launchOperator)} target="_blank" rel="noreferrer">PREAUTHORIZED ONCHAIN <ArrowSquareOut weight="bold" /></a>
            </div>
            <div>
              <dt>ADOPTED MARKET</dt>
              <dd>{runtime.ready
                ? runtime.canonical?.gatewayAddress
                : PRODUCTION_DEPLOYMENT.tradingActive
                  ? PRODUCTION_DEPLOYMENT.activeMarketAddress
                  : "NOT ACTIVE"}</dd>
              <span>
                {runtime.ready
                  ? "CANONICAL GATEWAY · ALL LIVE GATES PASSED"
                  : runtime.canonical?.gatewayAddress
                    ? "CANONICAL MARKET DISCOVERED · BUY GATES BLOCKED"
                    : PRODUCTION_DEPLOYMENT.tradingActive
                      ? `MANIFEST MARKET RECORDED · LIVE BUY GATES BLOCKED · ACTIVATION ${PRODUCTION_DEPLOYMENT.activatedBlock}`
                      : "MANIFEST HAS NO OFFICIAL CA OR CURRENT MARKET"}
              </span>
            </div>
          </dl>
          <p className="code-page-legacy-note">
            LEGACY V1 REFERENCE ONLY · The earlier MarketFactory at{" "}
            <a href={explorerAddress(PRODUCTION_DEPLOYMENT.legacyV1Foundation.marketFactoryAddress)} target="_blank" rel="noreferrer">
              {PRODUCTION_DEPLOYMENT.legacyV1Foundation.marketFactoryAddress}
            </a>{" "}
            is not the authoritative Production V2 launch path.
          </p>
          <div className="code-page-hash">
            <span>RUNTIME GATE</span>
            <code>
              {runtime.ready
                ? "LIVE CHECK PASSED · HOMEPAGE RECHECK REQUIRED BEFORE WALLET"
                : `${liveMarketStatus} · ${PRODUCTION_DEPLOYMENT.tradingActive ? "MANIFEST MARKET RECORDED" : "MARKET NOT ACTIVE"} · BUYING DISABLED`}
            </code>
          </div>
        </section>

        <section className="code-page-qqq" id="qqq-delivery" aria-labelledby="qqq-delivery-heading">
          <div className="code-page-section-label">
            <Coins size={23} weight="fill" />
            <span id="qqq-delivery-heading">QQQ DELIVERY · WHAT EXISTS / WHAT IS MISSING</span>
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
                same transaction. The live production gate determines whether a canonical market
                currently binds a real adapter and executable QQQ liquidity route.
              </p>
            </div>
          </div>
          <div className="code-page-qqq-detail">
            <pre aria-label="QQQ direct-delivery contract code"><code>{QQQ_DELIVERY_SOURCE}</code></pre>
            <div className="code-page-readiness" aria-label="QQQ production readiness">
              <div className="is-registered"><b>REGISTRY LIVE</b><p>Canonical Robinhood QQQ CA is identified by the chain-4663 asset registry.</p></div>
              <div className="is-implemented"><b>IMPLEMENTED · TESTED</b><p>Gateway measures the recipient&apos;s output-token balance delta after each adapter call.</p></div>
              <div className="is-implemented"><b>IMPLEMENTED · TESTED</b><p>Missing output, slippage failure or adapter mismatch reverts both 99% and 1% legs.</p></div>
              <div className={runtime.ready ? "is-runtime-ready" : "is-not-deployed"}>
                <b>{runtime.ready ? "LIVE BINDING VERIFIED" : "NOT READY"}</b>
                <p>
                  {runtime.ready
                    ? "The canonical runtime verified the deployed QQQ adapter and executable settlement route."
                    : "No production QQQ adapter and executable WETH → USDG → QQQ route passed the live gate."}
                </p>
              </div>
              <div className={runtime.ready ? "is-runtime-ready" : "is-pending"}>
                <b>{runtime.ready ? "CA ADOPTED" : "PENDING"}</b>
                <p>
                  {runtime.ready
                    ? "The authority-approved official token and project adapter are bound to the canonical Gateway."
                    : "No authority-approved official project token and adapter passed the live gate."}
                </p>
              </div>
              <div className={runtime.ready ? "is-runtime-ready" : "is-not-deployed"}>
                <b>{runtime.ready ? "LIVE CHECKS PASSED" : "BLOCKED"}</b>
                <p>
                  {runtime.ready
                    ? "The quote route/service health, simulation control and eligibility service passed. An amount-bound executable quote is generated only after buyer input and eligibility."
                    : "Quote route/service health, Gateway simulation controls and eligibility are not all production-ready."}
                </p>
              </div>
            </div>
          </div>
          <p className="code-page-qqq-note">Production readiness requires the pinned V2 registry, its preauthorized fixed launch operator, and CA-only <code>activatePonsMarket(officialToken)</code> path to produce a canonical market whose liquidity, quote simulation and eligibility controls all pass the same live check. Otherwise the site must not return a sendable buy transaction.</p>
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
          <p>Only successful <code>SplitBuy</code> events emitted by the configured canonical Gateway qualify. Recipient addresses are deduplicated. Token holders, QQQ holders, transfers, airdrops, and direct DEX buys are excluded.</p>
        </section>

        <section className="code-page-runtime" aria-labelledby="code-runtime-heading">
          <div className="code-page-section-label">
            <Code size={23} weight="fill" />
            <span id="code-runtime-heading">FIVE IMPLEMENTATION PATHS · NOT LIVE-READINESS CLAIMS</span>
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

        <section className="code-page-truths" aria-label="Implemented guarantees and production limitations">
          <div><CheckCircle size={25} weight="fill" /><p><b>DIRECT · TESTED</b>The Gateway implementation measures both output-token balance changes at the recipient.</p></div>
          <div><CheckCircle size={25} weight="fill" /><p><b>ATOMIC · TESTED</b>The Gateway implementation unwinds the transaction if the fee transfer or either adapter call reverts.</p></div>
          <div><Wallet size={25} weight="fill" /><p><b>DEFERRED WALLET</b>The homepage asks for a wallet only after the buyer confirms an amount.</p></div>
          <div className="code-page-warning"><WarningCircle size={25} weight="fill" /><p><b>{runtime.ready ? "LIVE RELEASE GATES VERIFIED" : "UNAUDITED · EXTERNAL PROVIDER REQUIRED"}</b>{runtime.ready
            ? "The live runtime reports that the manifest-bound independent audit and external eligibility gates passed. The homepage still rechecks the complete route before requesting a wallet."
            : "Tests and a real-chain fork are not a substitute for an independent security review. Production stock-token eligibility requires a configured external sanctions/KYC provider; the live runtime does not currently verify that complete control stack, and self-attestation alone is insufficient."}</p></div>
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
