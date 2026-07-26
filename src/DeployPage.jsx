import { useEffect } from "react";
import {
  ArrowLeft,
  ArrowSquareOut,
  CheckCircle,
  Code,
  LockSimple,
  ShieldCheck,
  WarningCircle,
} from "@phosphor-icons/react";
import {
  explorerAddress,
  PRODUCTION_DEPLOYMENT,
} from "./productionDeployment.js";
import "./deploy-page.css";

const PRODUCTION_V2_RECORDS = [
  {
    label: "PRODUCTION V2 REGISTRY",
    value: PRODUCTION_DEPLOYMENT.registryAddress,
    detail: PRODUCTION_DEPLOYMENT.tradingActive
      ? "SOURCE VERIFIED · ACTIVE MARKET RECORDED IN MANIFEST"
      : "PREAUTHORIZED · SOURCE VERIFIED · MARKET INACTIVE",
    href: explorerAddress(PRODUCTION_DEPLOYMENT.registryAddress),
  },
  {
    label: "LOCKED V2 GATEWAY IMPLEMENTATION",
    value: PRODUCTION_DEPLOYMENT.gatewayImplementationAddress,
    detail: "DEPLOYED · SOURCE VERIFIED · IMPLEMENTATION LOCKED",
    href: explorerAddress(PRODUCTION_DEPLOYMENT.gatewayImplementationAddress),
  },
  {
    label: "QQQ STOCK ADAPTER",
    value: PRODUCTION_DEPLOYMENT.stockAdapterAddress,
    detail: PRODUCTION_DEPLOYMENT.tradingActive
      ? "DEPLOYED · SOURCE VERIFIED · ACTIVE MARKET BINDING RECORDED"
      : "DEPLOYED · SOURCE VERIFIED · NOT YET BOUND TO AN ACTIVE MARKET",
    href: explorerAddress(PRODUCTION_DEPLOYMENT.stockAdapterAddress),
  },
  {
    label: "PONS PROJECT ADAPTER FACTORY",
    value: PRODUCTION_DEPLOYMENT.ponsAdapterFactoryAddress,
    detail: PRODUCTION_DEPLOYMENT.tradingActive
      ? "DEPLOYED · SOURCE VERIFIED · OFFICIAL CA ACTIVATED"
      : "DEPLOYED · SOURCE VERIFIED · AWAITS OFFICIAL CA",
    href: explorerAddress(PRODUCTION_DEPLOYMENT.ponsAdapterFactoryAddress),
  },
  {
    label: "SIGNED ELIGIBILITY CHECKER",
    value: PRODUCTION_DEPLOYMENT.eligibilityCheckerAddress,
    detail: "DEPLOYED · SOURCE VERIFIED · SERVICE CONFIGURATION STILL REQUIRED",
    href: explorerAddress(PRODUCTION_DEPLOYMENT.eligibilityCheckerAddress),
  },
  {
    label: "FIXED LAUNCH OPERATOR",
    value: PRODUCTION_DEPLOYMENT.launchOperator,
    detail: "ONCHAIN PREAUTHORIZED · CONTROLS REQUIRED BEFORE CA ACTIVATION",
    href: explorerAddress(PRODUCTION_DEPLOYMENT.launchOperator),
  },
  {
    label: "PROJECT AUTHORITY",
    value: PRODUCTION_DEPLOYMENT.projectAuthority,
    detail: "AUTHORIZED THE FIXED LAUNCH OPERATOR",
    href: explorerAddress(PRODUCTION_DEPLOYMENT.projectAuthority),
  },
  ...(PRODUCTION_DEPLOYMENT.tradingActive ? [
    {
      label: "CURRENT OFFICIAL CA",
      value: PRODUCTION_DEPLOYMENT.officialTokenAddress,
      detail: "RECORDED IN THE REVIEWED V2 MANIFEST",
      href: explorerAddress(PRODUCTION_DEPLOYMENT.officialTokenAddress),
    },
    {
      label: "CURRENT CANONICAL GATEWAY",
      value: PRODUCTION_DEPLOYMENT.activeMarketAddress,
      detail: `ACTIVATED AT BLOCK ${PRODUCTION_DEPLOYMENT.activatedBlock}`,
      href: explorerAddress(PRODUCTION_DEPLOYMENT.activeMarketAddress),
    },
  ] : []),
];

const READINESS_RECORDS = [
  {
    state: "V2 VERIFIED",
    icon: CheckCircle,
    copy: "The ProductionMarketActivator registry and its fixed V2 components are deployed and source-verified.",
  },
  {
    state: "PREAUTHORIZED",
    icon: CheckCircle,
    copy: "The immutable launch operator is authorized onchain. This is authorization, not an active market.",
  },
  PRODUCTION_DEPLOYMENT.tradingActive
    ? {
        state: "MARKET RECORDED",
        icon: CheckCircle,
        copy: "The reviewed manifest records an official CA, canonical Gateway and activation block. Live API, audit and canary gates remain separate.",
      }
    : {
        state: "MARKET INACTIVE",
        icon: WarningCircle,
        copy: "No official CA, current market clone or activation block is recorded in the production manifest.",
      },
  {
    state: "DISABLED",
    icon: LockSimple,
    copy: "This public record contains no wallet connection, deployment, authorization or market-activation control.",
  },
];

export default function DeployPage() {
  useEffect(() => {
    document.title = "PRODUCTION V2 DEPLOYMENT RECORD - DEGEN PENSION";
  }, []);

  return (
    <div className="deploy-page">
      <a className="deploy-skip-link" href="#deploy-main">SKIP TO DEPLOYMENT RECORD</a>
      <header className="deploy-header">
        <a href="/"><ArrowLeft weight="bold" /> 99/1 HOME</a>
        <span>PRODUCTION V2 MANIFEST · READ ONLY</span>
      </header>

      <main className="deploy-main" id="deploy-main" tabIndex={-1}>
        <section className="deploy-intro" aria-labelledby="deploy-record-title">
          <p>ROBINHOOD CHAIN · 4663 · PROTOCOL V2</p>
          <h1 id="deploy-record-title">
            {PRODUCTION_DEPLOYMENT.tradingActive ? "MARKET RECORDED." : "PREAUTHORIZED."}<br />
            <em>{PRODUCTION_DEPLOYMENT.tradingActive ? "LIVE GATES APPLY." : "NOT ACTIVE."}</em>
          </h1>
          <div className="deploy-market-status">
            <ShieldCheck weight="fill" />
            <div>
              <strong>{PRODUCTION_DEPLOYMENT.tradingActive ? "V2 MARKET RECORDED" : "V2 MARKET INACTIVE"}</strong>
              <span>
                {PRODUCTION_DEPLOYMENT.tradingActive
                  ? "MANIFEST CA, GATEWAY AND ACTIVATION BLOCK ARE PINNED. LIVE RELEASE GATES ARE SEPARATE."
                  : "FIXED COMPONENTS EXIST. NO OFFICIAL CA OR CURRENT MARKET IS RECORDED."}
              </span>
            </div>
          </div>
          <p className="deploy-intro-copy">
            This page reads the checked-in Robinhood mainnet Production V2 manifest. The
            registry and fixed adapters are deployed, and its launch operator is preauthorized.
            {PRODUCTION_DEPLOYMENT.tradingActive
              ? " The manifest records the current CA and Gateway, but that alone does not prove the live API, audit, eligibility, quote or canary gates are ready."
              : " That does not mean an official token, executable 99/1 market, quote, eligibility decision or public buy route is live."}
          </p>
        </section>

        <section className="deploy-record" aria-labelledby="foundation-record-heading">
          <div className="deploy-record-title">
            <Code weight="bold" />
            <span id="foundation-record-heading">AUTHORITATIVE PRODUCTION V2 RECORD</span>
            <b>READ ONLY</b>
          </div>

          <dl className="deploy-contracts">
            {PRODUCTION_V2_RECORDS.map((record) => (
              <div key={record.label}>
                <dt>{record.label}</dt>
                <dd>{record.value}</dd>
                <p>{record.detail}</p>
                <a href={record.href} target="_blank" rel="noreferrer">
                  OPEN BLOCKSCOUT <ArrowSquareOut weight="bold" />
                </a>
              </div>
            ))}
          </dl>

          <div className="deploy-readiness" aria-label="Foundation and market readiness">
            {READINESS_RECORDS.map(({ state, icon: Icon, copy }) => (
              <div key={state} className={`deploy-readiness-item deploy-readiness-${state.toLowerCase().replaceAll(" ", "-")}`}>
                <Icon weight="fill" />
                <strong>{state}</strong>
                <p>{copy}</p>
              </div>
            ))}
          </div>

          <div className="deploy-proof-actions">
            <a
              href={explorerAddress(PRODUCTION_DEPLOYMENT.registryAddress)}
              target="_blank"
              rel="noreferrer"
            >
              VERIFY V2 REGISTRY <ArrowSquareOut weight="bold" />
            </a>
            <a
              href={explorerAddress(PRODUCTION_DEPLOYMENT.gatewayImplementationAddress)}
              target="_blank"
              rel="noreferrer"
            >
              VERIFY GATEWAY SOURCE <ArrowSquareOut weight="bold" />
            </a>
            <a href="/code">
              READ IMPLEMENTATION STATUS <ArrowSquareOut weight="bold" />
            </a>
          </div>

          <aside className="deploy-legacy-record" aria-label="Legacy V1 reference">
            <strong>LEGACY V1 · REFERENCE ONLY</strong>
            <p>
              The earlier MarketFactory and Gateway implementation remain source-verified,
              but they are not the authoritative Production V2 launch path.
            </p>
            <div>
              <a
                href={explorerAddress(PRODUCTION_DEPLOYMENT.legacyV1Foundation.marketFactoryAddress)}
                target="_blank"
                rel="noreferrer"
              >
                V1 MARKETFACTORY <ArrowSquareOut weight="bold" />
              </a>
              <a
                href={explorerAddress(PRODUCTION_DEPLOYMENT.legacyV1Foundation.gatewayImplementationAddress)}
                target="_blank"
                rel="noreferrer"
              >
                V1 GATEWAY IMPLEMENTATION <ArrowSquareOut weight="bold" />
              </a>
            </div>
          </aside>
        </section>
      </main>
    </div>
  );
}
