# DEGEN PENSION 99/1 contracts MVP

This directory contains a Foundry MVP for an authority-adopted, atomic split-buy market.

## Official market adoption

`MarketFactory` has one immutable `projectAuthority`. A market can only be created with a valid EIP-712 `AdoptMarket` authorization from that authority. The authorization binds:

- the chain ID and factory address through the EIP-712 domain;
- the official token and Stock Token;
- both fixed swap adapters;
- the explicit fee rate and recipient; and
- a one-time nonce and deadline.

This lets any relayer deploy the market without making the relayer or token deployer the project authority. A nonce cannot be replayed, an expired authorization fails, and a signature for one factory or chain cannot authorize another. The factory deploys an EIP-1167 clone and initializes it in the same transaction.

## Fee-first 99/1 settlement

Each market permanently binds its input token, output tokens, adapters, `explicitFeeBps`, and `feeRecipient`. A buy:

1. receives the gross input;
2. transfers the explicit platform fee;
3. sends 99% of the remaining net input through the project-token adapter; and
4. sends the remaining 1%, including integer rounding dust, through the Stock Token adapter.

For a gross input of `10,000` and a 1% explicit fee, the fee is `100`, net input is `9,900`, the project-token leg receives `9,801`, and the Stock Token leg receives `99`.

The explicit fee is capped at 500 bps. A zero fee permits a zero fee recipient. If the production AMM or adapter already embeds its own swap fee in the quote/output, initialize `explicitFeeBps` to zero to avoid charging users twice.

Both adapters must deliver their configured output directly to the requested recipient. The gateway verifies the recipient's real balance increase against the adapter's reported output and the user's minimum. A failure or invalid output on either leg reverts the fee, both legs, and the full transaction.

`buy` accepts the bound ERC-20 input. `buyNative` wraps all `msg.value` and runs the same settlement, so it is usable only when the bound input implements the WETH `deposit()` interface.

The implementation has no owner, upgrade hook, generic call function, ratio setter, fee setter, or reinitializer. The implementation contract locks its own initializer in its constructor; factory clones are initialized atomically.

Run the tests:

```sh
forge test
```

This is an unaudited MVP. The mock tokens and adapters are test fixtures, not production swap integrations. No mainnet deployment is included.
