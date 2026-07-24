# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.

## Durable product and design decisions

- Product: DEGEN PENSION, a Robinhood Chain split-buy gateway. Every official gateway purchase routes the post-fee net amount 99% to the adopted project token and 1% to canonical QQQ Stock Token in one atomic transaction.
- Brand: 401KEK is the meme/editorial series, not a claim about the US 401(k) retirement product. Characters are manic raccoon “99哥” and tiny deadpan accountant “1仔”. Core line: “99% APE. 1% ADULT.”
- Selected visual source: `/Users/a7/Documents/Codex/2026-07-24/ni/.design-options/midnight-office.png`. Match its black, old-ledger cream, toxic green and rust palette; vintage financial-office editorial tone; sharp rules; dense mono labels; and oversized condensed headlines.
- UX truthfulness: this remains clearly marked as a pre-launch prototype until an official token CA and immutable gateway exist. Never fake wallet connection, quotes, transaction hashes, MarketReady status, audits, liquidity, or live deployment.
