# Production API and launch configuration

The six endpoints in `api/` are Vercel Functions. They are intentionally
fail-closed: missing configuration, an unknown jurisdiction, a provider outage,
a mismatched onchain binding, a stale quote, or a reverting simulation never
returns a sendable transaction.

## Public endpoints

### `GET /api/runtime`

Reads Robinhood Chain mainnet and verifies:

- the checked-in `contracts/deployments/robinhood-mainnet.json` release manifest;
- chain ID `4663`;
- Production registry identity/version, authority, implementation and `isMarket(gateway)`;
- Registry, implementation, Gateway, Adapter, Quoter and EligibilityChecker
  bytecode;
- Gateway CA, QQQ, input token, Adapter, fee and eligibility bindings;
- Adapter input/output tokens, registry, Router, Quoter and exact onchain paths;
- Eligibility authority and policy hash;
- activation block and the server signing key's public address;
- a healthy signed durable-statistics indexer;
- a shared signed rate-limit service and signed monitoring sink; and
- a downloadable independent-audit PDF whose SHA-256 matches the pinned digest;
  and
- the live Robinhood asset-registry entry for canonical QQQ.

`checks.releaseManifest` is mandatory in Production. The checked-in manifest is
the sole release authorization: environment values are only consistency checks,
and a live Registry cannot authorize itself. While `tradingActive=false`, runtime
never becomes `READY` even if the Registry has already been activated. The
inactive gate is evaluated before external provider, indexer, limiter, monitor,
audit, and asset-registry health probes, so pre-launch refreshes remain closed
without hammering those services.

When `tradingActive=true`, the manifest's Registry, current CA, current Gateway,
activation block, implementation and runtime code hash, EligibilityChecker and
eligibility authority, policy hash, Stock Adapter, maximum input, chain ID, and
protocol version must all match the onchain snapshot exactly. Any mismatch keeps
`checks.releaseManifest=false`.

The public response reports only safe release metadata:
`releaseManifest = { required, manifestId, tradingActive, bound }`. It never
accepts a manifest path or manifest body from an environment variable or request.

`ready` is true only when every `checks` field is true. The endpoint never
returns a private key. `operations` exposes only boolean/configuration state;
credentials and service URLs are not returned. `/api/runtime` stays readable
with a local defensive limiter so missing controls can be diagnosed, but those
missing checks keep buying locked.

`stockAssetRegistry` reads the fixed official
`https://api.robinhood.com/rhj/assets` endpoint with redirect, timeout, and body
size limits. Exactly one deployment must match chain `4663` plus canonical QQQ;
its `tokenSymbol` must be `QQQ`, status `ASSET_STATUS_ACTIVE`, and both
`tradingCapabilities.market.whole` and `.fractional` must be
`TRADING_STATUS_TRADABLE`. Any outage, duplicate, schema change, halt, or status
change makes runtime `NOT_READY`. The official endpoint cannot be replaced by a
Production environment variable.

### `POST /api/eligibility`

Request:

```json
{
  "wallet": "0x...",
  "termsAccepted": true,
  "notUSPerson": true
}
```

The country is taken from Vercel's trusted `x-vercel-ip-country` header, never
from the body. Unknown countries, US persons, the default blocked list
(`US,CA,GB,CH`), missing terms, provider errors and malformed responses are
denied. Production requires `ELIGIBILITY_PROVIDER_MODE=external`; the built-in
geo-attestation mode is development-only and is not identity-level KYC.
Provider requests use a timestamped HMAC. A response must be at most 32 KiB,
have a fresh `x-degen-provider-timestamp`, and carry
`x-degen-provider-signature: sha256=<HMAC(timestamp + "." + rawBody)>` using
`ELIGIBILITY_PROVIDER_REQUEST_SECRET`. Missing, stale, unsigned, oversized, or
expired positive decisions are rejected rather than extended. A valid positive
decision receives a separate server-HMAC proof; that proof is not the onchain
proof and cannot move funds.

The signed provider body must echo the canonical request bindings and include
auditable identifiers:

```json
{
  "schemaVersion": 1,
  "eligible": true,
  "reason": "PROVIDER_ELIGIBLE",
  "decisionId": "provider-decision-id",
  "provider": "independent-provider-name",
  "wallet": "0x...",
  "chainId": 4663,
  "stockTokenAddress": "0x...",
  "countryCode": "SG",
  "expiresAt": "2026-07-27T00:05:00.000Z"
}
```

Wallet, chain, Stock Token, and country must match the request exactly.
Production never invents a missing `decisionId`, provider name, or expiry.

### `POST /api/quote`

Request:

```json
{
  "wallet": "0x...",
  "recipient": "0x...",
  "amountInWei": "10000000000000000",
  "slippageBps": 200,
  "termsAccepted": true,
  "notUSPerson": true
}
```

For the initial production policy, `wallet` and `recipient` must match. The
service:

1. requires the checked-in manifest to be active and revalidates the returned
   runtime against it;
2. re-runs or uses a fresh cached provider decision;
3. reads the current CA, Gateway and both paths from the manifest-pinned Registry;
4. applies the immutable explicit fee and 99/1 split;
5. asks the configured onchain Quoter V2 for both exact paths;
6. derives nonzero `minProjectOut` and `minStockOut`;
7. signs the frozen Eligibility EIP-712 payload with the server eligibility
   key, after confirming its address matches the onchain checker;
8. encodes `buyNative(minProjectOut,minStockOut,recipient,deadline,
   eligibilityDeadline,signature)`; and
9. runs the complete transaction with `eth_call`, using the real payer and
   value.

The response contains a short expiry, typed eligibility payload, publicly
verifiable signature and transaction `{to,data,value,chainId}`. It never
accepts a CA, Gateway, Stock Token, route or chain from the request and never
holds a user key.

### `GET /api/holders`

Reads the registry's current official token and then its real `holders_count`
from Blockscout. The response is cached briefly. An inactive registry means `503`.

### `GET /api/members`

Counts unique recipients in confirmed canonical `SplitBuy` events where
`stockAmountOut > 0`. Production reads a fresh HMAC-signed cumulative snapshot
from `STATS_INDEXER_URL`; it never restarts at the activation block on every
serverless invocation. The bounded RPC scanner is development-only and runs
only when `ALLOW_BOUNDED_STATS_FALLBACK=true`. Production disables that fallback
unconditionally.

### `GET /api/holder-stock`

Calculates the Stock Token cash leg for confirmed self-directed official buys
through the **current canonical Gateway, starting at that Gateway's activation
block**. It accepts no CA or Gateway from the request. The service:

1. resolves and cross-checks the canonical official CA, Gateway, QQQ and
   activation block;
2. counts only confirmation-safe `SplitBuy` events where `payer == recipient`
   and `projectAmountIn`, `stockAmountIn`, `projectAmountOut`, and
   `stockAmountOut` are all positive;
3. requires each event to match exactly one earlier, same-transaction Swap emitted by
   the canonical router in the immutable USDG/QQQ pool;
4. requires the pool's QQQ output to equal `SplitBuy.stockAmountOut`; and
5. sums the actual USDG input, returning its nominal dollar equivalent together
   with raw amounts, token decimals, source, checked time and confirmation-safe
   block.

Direct CA buys, sells, transfers, airdrops and unmatched swaps are excluded.
Missing bindings, incomplete scans or mismatched settlement logs fail closed.
The response declares `CURRENT_CANONICAL_GATEWAY_SINCE_ACTIVATION`; it is not
an all-version historical total. The Production indexer must preserve every
canonical activation epoch and its confirmation-safe cursor. The development
fallback retains `MEMBER_MAX_SCAN_BLOCKS` and fails closed rather than attempting
an unbounded serverless scan.

## Trusted statistics indexer contract

The API sends `GET /healthz` and
`GET /v1/canonical-market-snapshot?...` to `STATS_INDEXER_URL`. Requests contain
a bearer key plus `x-degen-request-timestamp` and
`x-degen-request-signature`. Responses must include:

```text
x-degen-indexer-timestamp: <unix seconds>
x-degen-indexer-signature: sha256=<HMAC(timestamp + "." + raw JSON body)>
```

The snapshot JSON contract is:

```json
{
  "schemaVersion": 1,
  "chainId": 4663,
  "gatewayAddress": "0x...",
  "officialTokenAddress": "0x...",
  "stockTokenAddress": "0x...",
  "activatedBlock": "19000000",
  "asOfBlock": "19000100",
  "confirmations": 12,
  "checkedAt": "2026-07-27T00:00:00.000Z",
  "members": {
    "memberCount": 12,
    "buyCount": 20,
    "scope": "ALL_CANONICAL_GATEWAY_EPOCHS",
    "recipient": "0x...",
    "memberNumber": 4
  },
  "holderStock": {
    "status": "ready",
    "selfBuyCount": 18,
    "uniqueBuyerCount": 10,
    "usdgSpentRaw": "725450000",
    "usdgSpent": "725.45",
    "usdgDecimals": 6,
    "qqqAmountOutRaw": "1000000000000000000",
    "qqqAmount": "1",
    "qqqDecimals": 18,
    "approximateUsdValue": "725.45",
    "settlementTokenAddress": "0x...",
    "settlementPoolAddress": "0x...",
    "source": "CONFIRMED_SELF_SPLITBUY_USDG_QQQ_SWAPS",
    "scope": "CURRENT_CANONICAL_GATEWAY_SINCE_ACTIVATION",
    "valuationBasis": "USDG_NOMINAL_DOLLAR",
    "qualification": "PAYER_EQUALS_RECIPIENT_AND_ALL_SPLIT_AMOUNTS_POSITIVE"
  }
}
```

For a lookup without `recipient`, omit `members.recipient` and
`members.memberNumber`. A missing member uses `memberNumber: null`.

Snapshots are capped at 64 KiB and must match chain ID, canonical CA, Gateway,
QQQ, activation block, minimum confirmation depth, recipient lookup, and
`STATS_INDEXER_MAX_AGE_SECONDS`. Member and Stock-token totals are cross-checked
from raw integer values before return. A bad signature, stale cursor, binding
mismatch, timeout, redirect, oversized response, or outage returns `503`; the
service never silently falls back in Production.

The indexer is an external deployment responsibility. It should consume
Registry activation epochs and confirmation-safe `SplitBuy`/canonical pool
events incrementally, persist cursors and aggregates transactionally, handle
reorg rollback, and expose signed health/snapshot responses. This repository
implements the strict consumer and development fallback, not the durable store.

## Shared rate limiting and monitoring

All Production endpoints except diagnostic `/api/runtime` require a shared
rate-limit decision service. The API sends a pseudonymized HMAC of endpoint and
client IP, never the raw IP. The service returns a fresh signed JSON decision
with `schemaVersion`, `allowed`, `remaining`, and millisecond `resetAt`, using
`x-degen-service-timestamp` and `x-degen-service-signature`. Missing, unavailable,
unsigned, or malformed decisions fail closed. The in-memory limiter remains an
additional per-instance defense.

Rate-limit and monitoring requests contain a random `requestId`; every signed
response must echo it. This prevents a valid response for one health/consume
request from being accepted for another.

Operational 5xx events are sent to the configured signed monitoring webhook
with a request ID; responses also carry `x-request-id` for log correlation.
Missing distributed limiting or monitoring leaves `/api/runtime.ready=false`.
Operational health is cached for `OPERATIONS_HEALTH_CACHE_SECONDS` (15 seconds
by default), independently of fresh onchain runtime reads. This avoids repeating
five external health probes during every short-lived quote while keeping the
45-second quote TTL unchanged. Vercel allows 30 seconds for runtime, quote, and
statistics functions and 15 seconds for eligibility; dependency timeouts remain
far shorter, so an outage returns a controlled `503` instead of an implicit
10-second platform timeout.

## Required production controls

1. Deploy and source-verify `ProductionMarketActivator`; its constructor deploys
   the locked Gateway V2 implementation, mutable-policy EligibilityChecker,
   canonical QQQ Adapter and Pons Adapter Factory.
2. Set all server variables in `.env.example` in the Vercel **Production**
   environment. Never prefix server secrets with `VITE_`.
3. Browser endpoints default to same-origin. Override only when intentionally
   running the API on another trusted HTTPS origin:

   ```text
   VITE_BUY_QUOTE_ENDPOINT=https://degen-pension.vercel.app/api/quote
   VITE_HOLDER_STATS_ENDPOINT=https://degen-pension.vercel.app/api/holders
   VITE_MEMBER_STATS_ENDPOINT=https://degen-pension.vercel.app/api/members
   VITE_HOLDER_STOCK_STATS_ENDPOINT=https://degen-pension.vercel.app/api/holder-stock
   ```

4. Treat `contracts/deployments/robinhood-mainnet.json` as the sole release
   record. Public-address environment values must agree with it and can never
   override it. After onchain activation, record and review the exact CA,
   Gateway and activation block in that manifest and set `tradingActive=true`
   in the release commit before Production can become ready.
5. Configure `STATS_INDEXER_*`, `RATE_LIMIT_PROVIDER_*`, and
   `MONITORING_WEBHOOK_*`. Exercise their signed-response and outage paths before
   launch. Vercel Firewall remains an additional edge control.
6. Store `ELIGIBILITY_SIGNER_PRIVATE_KEY` and provider credentials as encrypted
   server-only Vercel secrets. `policyAdmin` can atomically rotate the proof
   signer and policy hash; never reuse a deployer or treasury key.
7. Obtain an independent contract audit. Publish the final PDF and pin its exact
   SHA-256, auditor, and completion date. Runtime downloads the bounded PDF and
   verifies the digest; metadata alone cannot make this gate green.
8. Run `npm run verify`, deploy Preview, call all six endpoints, execute a
   representative `eth_call`, then promote that exact immutable deployment.
9. Keep `LOG_CONFIRMATIONS >= 1`; Production treats zero or invalid values as
   the safe default of 12.

## Go / no-go

The frontend may be public while runtime is `NOT_CONFIGURED`. The checked-in
manifest currently has `tradingActive=false`, so neither an onchain activation
nor environment variables alone can unlock a quote. At launch the
operator submits only `activatePonsMarket(officialCA)`; the contract validates
the active Pons record and canonical 1% V3 pool, creates the CA-specific Adapter
and Gateway clone, registers them and unpauses the market atomically. The
resulting bindings must then be written to and reviewed in the unique manifest.
Real buying is
allowed only when `/api/runtime` is `READY`, eligibility returns an eligible
decision, `/api/quote` returns a non-expired transaction, the client decodes
and checks every field, and a small mainnet canary settles both output balances.

An independent audit remains an external blocker. Repository tests, fork tests,
source verification, and runtime digest verification do not constitute an audit
and must not be described as one.
