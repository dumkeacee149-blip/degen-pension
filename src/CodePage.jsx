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

const MEMBER_INDEX_SOURCE = `const runtime = await loadRuntime(config);
if (!runtime.ready) throw new ApiError(503, "GATEWAY_NOT_CONFIGURED");

const recipients = new Set();
let buyCount = 0;

for (let fromBlock = BigInt(runtime.activatedBlock); fromBlock <= safeBlock; fromBlock += chunk) {
  const toBlock = Math.min(fromBlock + LOG_BLOCK_CHUNK - 1, safeBlock);
  const logs = await client.getLogs({
    address: runtime.gatewayAddress,
    event: SPLIT_BUY_EVENT,
    fromBlock,
    toBlock,
    strict: true,
  });

  for (const log of logs) {
    if (!log.args.recipient || log.args.stockAmountOut <= 0n) continue;
    recipients.add(log.args.recipient.toLowerCase());
    buyCount += 1;
  }
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

const ACTIVATION_SOURCE = `function createMarket(
    AdoptMarketV2 calldata adoption,
    bytes calldata signature
) external returns (address market) {
    if (block.timestamp > adoption.deadline) revert AuthorizationExpired(adoption.deadline);
    if (usedNonces[adoption.nonce]) revert NonceAlreadyUsed(adoption.nonce);

    bytes32 digest = _hashAdoptMarket(adoption);
    if (!projectAuthority.isValidSignatureNow(digest, signature)) {
        revert InvalidProjectAuthoritySignature();
    }
    usedNonces[adoption.nonce] = true;

    market = address(implementation).clone();
    SplitBuyGatewayV2(market).initialize(
        adoption.officialToken,
        adoption.stockToken,
        adoption.projectAdapter,
        adoption.stockAdapter,
        adoption.explicitFeeBps,
        adoption.feeRecipient,
        adoption.guardian,
        adoption.eligibilityChecker,
        adoption.maxAmountIn
    );
    isMarket[market] = true;
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
    title: "AUTHORIZED ADOPTION",
    tag: "SIGNED + NONCED",
    source: "contracts/src/MarketFactoryV2.sol",
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
          <span className="code-page-risk"><WarningCircle size={16} weight="fill" /> UNAUDITED MVP</span>
          <a className="code-page-back" href="/flow">HOW IT WORKS</a>
          <a className="code-page-back" href="/"><ArrowLeft size={17} weight="bold" /> BACK TO HOME</a>
        </div>
      </header>

      <main className="code-page-main" id="code-page-main" tabIndex={-1}>
        <section className="code-page-intro">
          <span className="code-page-kicker">PUBLIC LOGIC · IMPLEMENTED + TESTED PATHS</span>
          <h1>THE MEME IS LOUD.<br /><em>THE CODE IS PUBLIC.</em></h1>
          <div className="code-page-intro-copy">
            <p>These source-matched excerpts are formatted for this page without changing the expressions or calls that calculate the split, execute both legs, count public members, and submit the official Gateway transaction.</p>
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
            <span id="deployment-proof-heading">FOUNDATION CONTRACTS · ONCHAIN RECORD</span>
          </div>
          <div className="code-page-deployment-status">
            <div><b>FOUNDATION</b><strong>VERIFIED</strong></div>
            <p>
              MarketFactory and its locked SplitBuyGateway implementation are deployed and
              source-verified. This is foundation proof only: there is no adopted official
              token, active market or executable buy route.
            </p>
          </div>
          <dl className="code-page-deployment-grid">
            <div>
              <dt>MARKETFACTORY</dt>
              <dd>{PRODUCTION_DEPLOYMENT.marketFactoryAddress}</dd>
              <a href={explorerAddress(PRODUCTION_DEPLOYMENT.marketFactoryAddress)} target="_blank" rel="noreferrer">SOURCE VERIFIED <ArrowSquareOut weight="bold" /></a>
            </div>
            <div>
              <dt>LOCKED GATEWAY IMPLEMENTATION</dt>
              <dd>{PRODUCTION_DEPLOYMENT.gatewayImplementationAddress}</dd>
              <a href={explorerAddress(PRODUCTION_DEPLOYMENT.gatewayImplementationAddress)} target="_blank" rel="noreferrer">SOURCE VERIFIED <ArrowSquareOut weight="bold" /></a>
            </div>
            <div>
              <dt>IMMUTABLE PROJECT AUTHORITY</dt>
              <dd>{PRODUCTION_DEPLOYMENT.projectAuthority}</dd>
              <a href={explorerAddress(PRODUCTION_DEPLOYMENT.projectAuthority)} target="_blank" rel="noreferrer">READ ONCHAIN <ArrowSquareOut weight="bold" /></a>
            </div>
            <div>
              <dt>ADOPTED MARKET</dt>
              <dd>NOT ACTIVE</dd>
              <span>NO OFFICIAL CA · NO MARKET CLONE</span>
            </div>
          </dl>
          <div className="code-page-hash">
            <span>RUNTIME GATE</span>
            <code>PRE-LAUNCH · MARKET NOT ACTIVE · BUYING DISABLED</code>
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
              <p>The Gateway implementation requires the 1% stock leg to reach the buyer in the same transaction. A future adopted market must bind a real deployed adapter and executable QQQ liquidity route. Neither is production-deployed today.</p>
            </div>
          </div>
          <div className="code-page-qqq-detail">
            <pre aria-label="QQQ direct-delivery contract code"><code>{QQQ_DELIVERY_SOURCE}</code></pre>
            <div className="code-page-readiness" aria-label="QQQ production readiness">
              <div className="is-registered"><b>REGISTRY LIVE</b><p>Canonical Robinhood QQQ CA is identified by the chain-4663 asset registry.</p></div>
              <div className="is-implemented"><b>IMPLEMENTED · TESTED</b><p>Gateway measures the recipient&apos;s output-token balance delta after each adapter call.</p></div>
              <div className="is-implemented"><b>IMPLEMENTED · TESTED</b><p>Missing output, slippage failure or adapter mismatch reverts both 99% and 1% legs.</p></div>
              <div className="is-not-deployed"><b>NOT DEPLOYED</b><p>No production QQQ adapter or executable WETH → USDG → QQQ liquidity route is bound.</p></div>
              <div className="is-pending"><b>PENDING</b><p>The official project token and its authority-approved project adapter have not been adopted.</p></div>
              <div className="is-not-deployed"><b>NOT DEPLOYED</b><p>Executable quote, Gateway simulation and eligibility services are not production-deployed.</p></div>
            </div>
          </div>
          <p className="code-page-qqq-note">Production readiness requires a signed market adoption that binds the official CA, a real project adapter, a real QQQ adapter, executable liquidity, quote simulation and eligibility controls. Until all of them exist and pass live checks, the site must not return a sendable buy transaction.</p>
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
            <span id="code-runtime-heading">FIVE IMPLEMENTED CODE PATHS</span>
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
          <div className="code-page-warning"><WarningCircle size={25} weight="fill" /><p><b>UNAUDITED</b>Tests and a real-chain fork are not a substitute for an independent security review. Regional IP gating and user attestation are technical controls, not legal advice or identity-level KYC.</p></div>
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
