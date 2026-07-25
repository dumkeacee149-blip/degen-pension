import { useEffect } from "react";
import {
  ArrowLeft,
  Calculator,
  CheckCircle,
  Code,
  UsersThree,
  Wallet,
  WarningCircle,
} from "@phosphor-icons/react";
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

    _emitSplitBuy(recipient, grossAmountIn, amounts, projectAmountOut, stockAmountOut);
}`;

const MEMBER_INDEX_SOURCE = `const recipients = new Set();
let buyCount = 0;

for (let fromBlock = MARKET.activatedBlock; fromBlock <= safeBlock; fromBlock += LOG_BLOCK_CHUNK) {
  const toBlock = Math.min(fromBlock + LOG_BLOCK_CHUNK - 1, safeBlock);
  const logs = await rpc(
    "eth_getLogs",
    [{
      address: MARKET.gatewayAddress,
      fromBlock: toHex(fromBlock),
      toBlock: toHex(toBlock),
      topics: [SPLIT_BUY_TOPIC],
    }],
    signal,
  );

  for (const log of logs) {
    const recipientTopic = log.topics?.[2];
    const stockAmountOutWord = log.data?.slice(-64);
    if (!recipientTopic || !stockAmountOutWord) continue;
    if (BigInt(\`0x\${stockAmountOutWord}\`) === 0n) continue;
    recipients.add(\`0x\${recipientTopic.slice(-40)}\`.toLowerCase());
    buyCount += 1;
  }
}`;

const BUY_CALL_SOURCE = `const quoteResponse = await fetch(MARKET.buyQuoteEndpoint, {
  method: "POST",
  headers: { "content-type": "application/json", accept: "application/json" },
  body: JSON.stringify({ amountEth: amount, recipient: wallet, chainId: CHAIN.chainIdDecimal }),
});
if (!quoteResponse.ok) throw new Error(\`Quote failed (\${quoteResponse.status}).\`);

const quotePayload = await quoteResponse.json();
const transaction = quotePayload.transaction || quotePayload;
if (String(transaction.to || "").toLowerCase() !== MARKET.gatewayAddress.toLowerCase()) {
  throw new Error("Quote target does not match the official Gateway.");
}
if (!transaction.data || !transaction.value) {
  throw new Error("Quote did not include a complete transaction.");
}

const transactionHash = await window.ethereum.request({
  method: "eth_sendTransaction",
  params: [{
    from: wallet,
    to: transaction.to,
    data: transaction.data,
    value: transaction.value,
  }],
});`;

const CODE_BLOCKS = [
  {
    number: "01",
    title: "FEE-FIRST SPLIT",
    tag: "9,900 / 100 BPS",
    source: "contracts/src/SplitBuyGateway.sol",
    code: CALCULATION_SOURCE,
  },
  {
    number: "02",
    title: "ATOMIC SETTLEMENT",
    tag: "BOTH OR NEITHER",
    source: "contracts/src/SplitBuyGateway.sol",
    code: SETTLEMENT_SOURCE,
  },
  {
    number: "03",
    title: "COUNT MEMBERS",
    tag: "CANONICAL EVENTS",
    source: "src/memberStats.js",
    code: MEMBER_INDEX_SOURCE,
  },
  {
    number: "04",
    title: "VALIDATE + SUBMIT",
    tag: "OFFICIAL GATEWAY",
    source: "src/App.jsx",
    code: BUY_CALL_SOURCE,
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
      <img src="/brand/mark-99-1-v2.png" alt="" />
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
      <header className="code-page-header">
        <CodeBrand />
        <div className="code-page-header-actions">
          <span className="code-page-risk"><WarningCircle size={16} weight="fill" /> UNAUDITED MVP</span>
          <a className="code-page-back" href="/flow">HOW IT WORKS</a>
          <a className="code-page-back" href="/"><ArrowLeft size={17} weight="bold" /> BACK TO BUY</a>
        </div>
      </header>

      <main className="code-page-main">
        <section className="code-page-intro">
          <span className="code-page-kicker">PUBLIC LOGIC · REAL RUNTIME PATHS</span>
          <h1>THE MEME IS LOUD.<br /><em>THE CODE IS PUBLIC.</em></h1>
          <div className="code-page-intro-copy">
            <p>These source-matched excerpts are formatted for this page without changing the expressions or calls that calculate the split, execute both legs, count public members, and submit the official Gateway transaction.</p>
            <nav aria-label="Runtime code sections">
              {CODE_BLOCKS.map((block) => (
                <a key={block.number} href={`#runtime-${block.number}`}><b>{block.number}</b>{block.title}</a>
              ))}
            </nav>
          </div>
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
            <span id="code-runtime-heading">THE FOUR RUNTIME PATHS</span>
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

        <section className="code-page-truths" aria-label="Runtime guarantees and limitations">
          <div><CheckCircle size={25} weight="fill" /><p><b>DIRECT</b>Both output-token balances are measured at and delivered to the recipient.</p></div>
          <div><CheckCircle size={25} weight="fill" /><p><b>ATOMIC</b>If the fee transfer or either adapter call reverts, the whole transaction unwinds.</p></div>
          <div><Wallet size={25} weight="fill" /><p><b>DEFERRED WALLET</b>The homepage asks for a wallet only after the buyer confirms an amount.</p></div>
          <div className="code-page-warning"><WarningCircle size={25} weight="fill" /><p><b>UNAUDITED MVP</b>Addresses, adapters, quote service, slippage, and deployment require production verification.</p></div>
        </section>
      </main>

      <footer className="code-page-footer">
        <span><b>99%</b> APE. <b>1%</b> ADULT.</span>
        <nav aria-label="Code page footer links"><a href="/flow">HOW IT WORKS</a><a href="/"><ArrowLeft size={16} weight="bold" /> RETURN TO BUY</a></nav>
      </footer>
    </div>
  );
}

export default CodePage;
