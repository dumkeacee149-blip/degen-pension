# DEGEN PENSION 99/1 production contracts

The active design is Production V2. A single `ProductionMarketActivator`
predeploys every CA-independent component on Robinhood Chain mainnet:

- a locked `SplitBuyGatewayV2` implementation;
- a canonical `RobinhoodQqqAdapter` fixed to
  WETH → USDG (100) → QQQ (3000);
- a `PonsProjectAdapterFactory` fixed to the active Pons factory and the
  WETH/project-token 1% Uniswap V3 tier;
- a `SignedEligibilityVerifier` whose signer/policy can only be rotated by the
  fixed project authority; and
- fixed launch operator, guardian and maximum single input.

The earlier `MarketFactory` contracts remain in the repository as V1 history.
They are not the production launch path.

## Settlement

For each Gateway buy:

1. `fee = floor(gross × explicitFeeBps / 10,000)`;
2. `net = gross - fee`;
3. `projectIn = floor(net × 9,900 / 10,000)`;
4. `stockIn = net - projectIn`;
5. the project adapter buys the official token directly to `recipient`; and
6. the QQQ adapter buys canonical QQQ directly to the same `recipient`.

The production activator initializes the Gateway with `explicitFeeBps = 0`, so
the AMM/launch-platform swap fees are reflected in route output without a second
project charge. Both recipient balance deltas must equal the adapters' reported
outputs and exceed the user's minimums. Any failure reverts wrapping, both swaps,
and every transfer.

## Before the CA exists

Set the fixed public values from `.env.deploy.example`, keep signing material in
encrypted wallets/server secrets, and deploy:

```sh
forge script script/DeployProduction.s.sol:DeployProduction \
  --rpc-url "$RH_RPC_URL" \
  --account degen-pension-deployer \
  --broadcast
```

Verify every immutable binding without broadcasting:

```sh
forge script script/VerifyProduction.s.sol:VerifyProduction \
  --rpc-url "$RH_RPC_URL"
```

The fixed `PROJECT_AUTHORITY` then sends the one-way authorization transaction:

```sh
forge script script/AuthorizeLaunchOperator.s.sol:AuthorizeLaunchOperator \
  --rpc-url "$RH_RPC_URL" \
  --account degen-pension-authority \
  --broadcast
```

## Launch day: one market variable, one pinned control stack

`contracts/deployments/robinhood-mainnet.json` is the sole production deployment
manifest. Before signing anything, verify that `REGISTRY_ADDRESS` and the selected
Foundry account resolve to its exact `registry` and immutable `launchOperator`.
The project authority is a different role and cannot activate this Registry.

After Pons has created the official token and canonical 1% WETH pool, set the one
new market value, `OFFICIAL_TOKEN_ADDRESS`, and run the activation through the
team-approved controlled signer:

```sh
forge script script/ActivatePonsMarket.s.sol:ActivatePonsMarket \
  --rpc-url "$RH_RPC_URL" \
  --account <CONTROLLED_MANIFEST_LAUNCH_OPERATOR> \
  --broadcast
```

`activatePonsMarket(CA)` rejects a fake/unregistered CA, a non-WETH pair, a
different fee tier, a mismatched token pool, a second activation, an unauthorized
operator, or a missing pre-authorization. For a valid CA it creates the immutable
project adapter, initializes a Gateway clone, registers it and unpauses it in the
same transaction.

After confirmation, update the same deployment manifest from the activation
Receipt and commit it for review. Activation alone is not a Go decision. The
production release gate must additionally pass Runtime `READY`, eligibility,
quote, an independent `eth_call`, and a confirmed two-leg mainnet canary. See
`docs/LAUNCH_RUNBOOK.md`. The desktop release script never sends the activation
or canary transaction and never deploys a replacement Registry.

## Verification

```sh
forge test
RUN_FORK_TESTS=true forge test --match-contract ProductionForkTest -vv
forge build --sizes --skip script
```

The fork test uses a real active Pons token and the live canonical QQQ route. It
executes an atomic native buy and asserts that both assets reach the user directly.

These contracts are tested but unaudited. Fork success is not a substitute for
an independent smart-contract audit, operations monitoring, or jurisdictional
review of Stock Token distribution.
