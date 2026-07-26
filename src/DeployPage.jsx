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

const FOUNDATION_RECORDS = [
  {
    label: "MARKETFACTORY",
    value: PRODUCTION_DEPLOYMENT.marketFactoryAddress,
    detail: "DEPLOYED · SOURCE VERIFIED",
    href: explorerAddress(PRODUCTION_DEPLOYMENT.marketFactoryAddress),
  },
  {
    label: "LOCKED SPLITBUYGATEWAY IMPLEMENTATION",
    value: PRODUCTION_DEPLOYMENT.gatewayImplementationAddress,
    detail: "DEPLOYED · SOURCE VERIFIED · INITIALIZED + PAUSED",
    href: explorerAddress(PRODUCTION_DEPLOYMENT.gatewayImplementationAddress),
  },
  {
    label: "IMMUTABLE PROJECT AUTHORITY",
    value: PRODUCTION_DEPLOYMENT.projectAuthority,
    detail: "BOUND IN MARKETFACTORY CONSTRUCTOR",
    href: explorerAddress(PRODUCTION_DEPLOYMENT.projectAuthority),
  },
];

const READINESS_RECORDS = [
  {
    state: "VERIFIED",
    icon: CheckCircle,
    copy: "MarketFactory and the locked Gateway implementation are deployed and source-verified on Blockscout.",
  },
  {
    state: "PENDING",
    icon: WarningCircle,
    copy: "No official project-token CA has been adopted and no live market clone exists.",
  },
  {
    state: "NOT DEPLOYED",
    icon: WarningCircle,
    copy: "A real QQQ adapter, executable liquidity route, quote service and eligibility controls are not production-deployed.",
  },
  {
    state: "DISABLED",
    icon: LockSimple,
    copy: "This public record contains no wallet connection, deployment, authorization or market-activation control.",
  },
];

export default function DeployPage() {
  useEffect(() => {
    document.title = "FOUNDATION DEPLOYMENT RECORD - DEGEN PENSION";
  }, []);

  return (
    <div className="deploy-page">
      <a className="deploy-skip-link" href="#deploy-main">SKIP TO DEPLOYMENT RECORD</a>
      <header className="deploy-header">
        <a href="/"><ArrowLeft weight="bold" /> 99/1 HOME</a>
        <span>PUBLIC DEPLOYMENT RECORD · READ ONLY</span>
      </header>

      <main className="deploy-main" id="deploy-main" tabIndex={-1}>
        <section className="deploy-intro" aria-labelledby="deploy-record-title">
          <p>ROBINHOOD CHAIN · 4663</p>
          <h1 id="deploy-record-title">FOUNDATION<br /><em>VERIFIED.</em></h1>
          <div className="deploy-market-status">
            <ShieldCheck weight="fill" />
            <div>
              <strong>MARKET NOT ACTIVE</strong>
              <span>THE FOUNDATION CONTRACTS EXIST. THE BUY ROUTE DOES NOT.</span>
            </div>
          </div>
          <p className="deploy-intro-copy">
            This page is a public record of the predeployed foundation only. A verified
            MarketFactory and a locked Gateway implementation do not mean an official
            token, executable 99/1 market, quote or eligible buy route is live.
          </p>
        </section>

        <section className="deploy-record" aria-labelledby="foundation-record-heading">
          <div className="deploy-record-title">
            <Code weight="bold" />
            <span id="foundation-record-heading">ONCHAIN FOUNDATION RECORD</span>
            <b>READ ONLY</b>
          </div>

          <dl className="deploy-contracts">
            {FOUNDATION_RECORDS.map((record) => (
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
              href={explorerAddress(PRODUCTION_DEPLOYMENT.marketFactoryAddress)}
              target="_blank"
              rel="noreferrer"
            >
              VERIFY FACTORY SOURCE <ArrowSquareOut weight="bold" />
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
        </section>
      </main>
    </div>
  );
}
