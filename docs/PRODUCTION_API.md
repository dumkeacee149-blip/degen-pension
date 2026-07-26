# Production API and launch configuration

The five endpoints in `api/` are Vercel Functions. They are intentionally
fail-closed: missing configuration, an unknown jurisdiction, a provider outage,
a mismatched onchain binding, a stale quote, or a reverting simulation never
returns a sendable transaction.

## Public endpoints

### `GET /api/runtime`

Reads Robinhood Chain mainnet and verifies:

- chain ID `4663`;
- Production registry identity/version, authority, implementation and `isMarket(gateway)`;
- Registry, implementation, Gateway, Adapter, Quoter and EligibilityChecker
  bytecode;
- Gateway CA, QQQ, input token, Adapter, fee and eligibility bindings;
- Adapter input/output tokens, registry, Router, Quoter and exact onchain paths;
- Eligibility authority and policy hash; and
- activation block and the server signing key's public address.

`ready` is true only when every `checks` field is true. The endpoint never
returns a private key.

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
denied. The default low-cost mode combines that trusted country with explicit
user attestations. It is regional access control, not identity-level KYC or
legal advice. Set `ELIGIBILITY_PROVIDER_MODE=external` to require an independent
sanctions/KYC provider. A positive decision is cached briefly and receives a
server-HMAC proof; that proof is not the onchain proof and cannot move funds.

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

1. re-runs or uses a fresh cached provider decision;
2. reads the current CA, Gateway and both paths from the onchain registry;
3. applies the immutable explicit fee and 99/1 split;
4. asks the configured onchain Quoter V2 for both exact paths;
5. derives nonzero `minProjectOut` and `minStockOut`;
6. signs the frozen Eligibility EIP-712 payload with the server eligibility
   key, after confirming its address matches the onchain checker;
7. encodes `buyNative(minProjectOut,minStockOut,recipient,deadline,
   eligibilityDeadline,signature)`; and
8. runs the complete transaction with `eth_call`, using the real payer and
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
`stockAmountOut > 0`. A bounded RPC scan is suitable for launch. Once the log
range exceeds `MEMBER_MAX_SCAN_BLOCKS`, it fails with
`MEMBER_INDEX_REQUIRED`; deploy a durable event indexer instead of increasing
an unbounded serverless scan.

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
   ```

4. Do not compile CA, Gateway or route addresses into production. Set only the
   server-side `REGISTRY_ADDRESS`; the browser receives verified current values
   from `/api/runtime`.
5. Put rate limits in Vercel Firewall or a shared rate-limit store as well.
   The code-level limiter is per warm function instance and is defense in
   depth, not a global quota.
6. Store `ELIGIBILITY_SIGNER_PRIVATE_KEY` and provider credentials as encrypted
   server-only Vercel secrets. `policyAdmin` can atomically rotate the proof
   signer and policy hash; never reuse a deployer or treasury key.
7. Run `npm run verify`, deploy Preview, call all five endpoints, execute a
   representative `eth_call`, then promote that exact immutable deployment.

## Go / no-go

The frontend may be public while runtime is `NOT_CONFIGURED`. At launch the
operator submits only `activatePonsMarket(officialCA)`; the contract validates
the active Pons record and canonical 1% V3 pool, creates the CA-specific Adapter
and Gateway clone, registers them and unpauses the market atomically. Real buying is
allowed only when `/api/runtime` is `READY`, eligibility returns an eligible
decision, `/api/quote` returns a non-expired transaction, the client decodes
and checks every field, and a small mainnet canary settles both output balances.
