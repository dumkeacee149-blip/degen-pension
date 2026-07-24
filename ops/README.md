# 150-second official-market adoption package

This directory turns a newly known official token CA into one immutable
`SplitBuyGateway` market. It does **not** launch the token, discover a route,
deploy a production adapter, or retroactively reward earlier buyers.

The safe launch preset is:

- Robinhood Chain mainnet, chain ID `4663`;
- an already deployed `MarketFactory`;
- an independently verified canonical Stock Token address;
- two already deployed, production-ready adapters with the same input token;
- `explicitFeeBps = 0`, because an AMM's embedded swap fee is already reflected
  in its output; and
- one EOA `projectAuthority` signing the exact EIP-712 digest.

Nothing in this package contains a real deployment address. Do not substitute a
placeholder and do not publish a Gateway until the final on-chain reads pass.

## Files

- `preflight.sh` is read-only. It verifies required tools, chain ID through both
  `curl` and `cast`, deployed bytecode, Factory authority/implementation, the
  independently expected Stock Token address, and both adapter bindings.
- `adopt-market.sh` obtains the digest directly from
  `Factory.hashAdoptMarket`, signs it with an explicitly selected Foundry
  keystore/account, verifies that signature, and simulates `createMarket`.
  This is the default dry run.
- `adopt-market.sh --broadcast` additionally signs and publishes through the
  selected operator keystore/account, waits for a receipt, parses
  `MarketCreated`, and reads every immutable binding back from the new Gateway.

The scripts intentionally do not accept a raw private key or mnemonic argument.
They never print the signature or a password. A signature is held only in the
process memory for the duration of the command.

## Before launch day

The 150-second target is possible only if the long-lead work is already done:

1. Audit and deploy `MarketFactory` with the intended EOA
   `projectAuthority`. Record its address from the deployment receipt.
2. Select the canonical Robinhood Chain Stock Token from an official source.
   Have two people independently record the same address. That address becomes
   both `STOCK_TOKEN` and `EXPECTED_STOCK_TOKEN`; the duplicate variable is an
   intentional mismatch guard.
3. Audit, deploy, and exercise both production swap adapters. Both
   `inputToken()` values must match. The project adapter's `outputToken()` must
   be the official CA and the stock adapter's `outputToken()` must be the
   canonical Stock Token.
4. Fund the operator EOA with native gas. The operator does not need to be the
   token deployer, token owner, token holder, or project authority.
5. Import the two EOAs into encrypted Foundry keystores. Prefer named accounts:

   ```sh
   cast wallet import degen-authority --interactive
   cast wallet import degen-operator --interactive
   ```

   Do not put a private key, mnemonic, or password in shell history, an `.env`
   file, CI logs, or this repository. If a password file is operationally
   necessary, create it outside the repository, limit it to the current user,
   and destroy it after launch.
6. Rehearse the complete dry run on the exact Foundry version used at launch.
   Record the operator balance, RPC latency, and expected response format.
7. Prepare a unique decimal `ADOPTION_NONCE`. Do not reuse it for another
   attempt. At CA time, use a deadline comfortably in the future, normally the
   latest chain time plus at least 10 minutes.
8. Keep the website/buy route closed. The public launch condition is the final
   `MARKET READY` output, not merely a submitted transaction hash.

The contract repository currently contains mock adapters for tests. They are
not production routes. If the two real adapter addresses cannot be known and
verified within the launch window, this package must fail closed; it must not
invent them or claim the market is ready.

## Required variables

| Variable | Meaning |
|---|---|
| `RPC_URL` | Robinhood Chain mainnet HTTP RPC; not printed by the scripts |
| `FACTORY_ADDRESS` | Already deployed `MarketFactory` |
| `OFFICIAL_TOKEN_CA` | Official launch CA received at T+0 |
| `STOCK_TOKEN` | Stock Token that the stock adapter actually outputs |
| `EXPECTED_STOCK_TOKEN` | Same address, copied from the independent launch configuration |
| `PROJECT_ADAPTER` | Deployed adapter from shared input token to official token |
| `STOCK_ADAPTER` | Deployed adapter from shared input token to Stock Token |
| `AUTHORITY_ADDRESS` | Factory's immutable `projectAuthority` EOA |
| `OPERATOR_ADDRESS` | Relayer/operator EOA used as `msg.sender` |
| `ADOPTION_NONCE` | Unique unused unsigned decimal integer |
| `ADOPTION_DEADLINE` | UNIX seconds, at least 60 seconds after latest chain time |
| `FEE_BPS` | Keep `0` when AMM fees are embedded |
| `FEE_RECIPIENT` | Zero address is valid when `FEE_BPS=0` |
| `AUTHORITY_ACCOUNT` | Foundry account name used to sign the digest |
| `OPERATOR_ACCOUNT` | Foundry account name used to broadcast |

Instead of an account name, use `AUTHORITY_KEYSTORE` or `OPERATOR_KEYSTORE` for
an explicit encrypted keystore path. Optional `AUTHORITY_PASSWORD_FILE` and
`OPERATOR_PASSWORD_FILE` are passed directly to Foundry; omit them to receive a
password prompt.

## T-15 minutes: freeze everything except CA

Export values in the launch terminal. Angle-bracket values below are labels,
not addresses and must never be submitted literally.

```sh
cd /path/to/degen-pension

export RPC_URL='<ROBINHOOD_MAINNET_RPC>'
export FACTORY_ADDRESS='<DEPLOYED_FACTORY>'
export STOCK_TOKEN='<INDEPENDENTLY_VERIFIED_STOCK_TOKEN>'
export EXPECTED_STOCK_TOKEN='<THE_SAME_VERIFIED_STOCK_TOKEN>'
export AUTHORITY_ADDRESS='<FACTORY_PROJECT_AUTHORITY>'
export OPERATOR_ADDRESS='<FUNDED_OPERATOR>'
export AUTHORITY_ACCOUNT='degen-authority'
export OPERATOR_ACCOUNT='degen-operator'
export FEE_BPS=0
export FEE_RECIPIENT=0x0000000000000000000000000000000000000000
export ADOPTION_NONCE='<UNUSED_DECIMAL_NONCE>'
```

Do not export a raw private key. Keep launch logs private until they have been
reviewed for RPC credentials.

## T+0 to T+150 seconds

### T+0–20: paste CA and frozen adapter addresses

```sh
export OFFICIAL_TOKEN_CA='<OFFICIAL_CA>'
export PROJECT_ADAPTER='<DEPLOYED_PROJECT_ADAPTER>'
export STOCK_ADAPTER='<DEPLOYED_STOCK_ADAPTER>'
export ADOPTION_DEADLINE="$(( $(date +%s) + 600 ))"
```

The adapter outputs are checked on-chain. If the project adapter was not
already deployed/configured and verified, stop; the adoption command is not an
adapter deployment system.

### T+20–55: read-only preflight

```sh
./ops/preflight.sh
```

Expected final line:

```text
PREFLIGHT PASSED — read-only checks completed; nothing was signed or broadcast.
```

Any other result closes the launch. Do not skip a failing check.

### T+55–95: signed dry run

```sh
./ops/adopt-market.sh
```

The script:

1. repeats preflight;
2. asks the Factory for the exact EIP-712 digest;
3. signs it through the selected encrypted authority keystore/account;
4. verifies that the signer is `AUTHORITY_ADDRESS`; and
5. executes the exact `createMarket` as `eth_call`.

Expected final line:

```text
DRY RUN COMPLETE — no transaction was broadcast.
```

Compare the printed digest, simulated market, CA, Stock Token, adapters, nonce,
deadline, fee, Factory, chain, authority, and operator with the frozen launch
sheet. The signature bytes are deliberately not printed.

### T+95–135: explicit broadcast

Only after the dry-run review, rerun the exact same environment:

```sh
./ops/adopt-market.sh --broadcast
```

`--broadcast` is the only switch that permits mutation. The command repeats all
checks and simulation before sending. It prints the real transaction hash as
soon as the RPC accepts it.

### T+135–150: MarketReady gate

The command waits for one confirmation and then requires all of the following:

- successful receipt status;
- a `MarketCreated` log emitted by the configured Factory;
- indexed creator equals the operator;
- indexed official token equals the frozen CA;
- emitted Gateway has bytecode;
- `Factory.isMarket(gateway) == true`;
- Gateway official token, Stock Token, both adapters, fee recipient, and
  `explicitFeeBps` all match the frozen values; and
- the authorization nonce is consumed.

Only the final `MARKET READY` block authorizes the team to expose the buy button
or publish the official Gateway. Publish both the official CA and official
Gateway. Direct launchpad/DEX purchases do not pass through the Gateway and
therefore do not receive a 99/1 split.

## Fee rule

Leave `FEE_BPS=0` when the AMM or adapter already charges through its quoted
output. This prevents charging an additional explicit fee before the 99/1
split.

A nonzero value is locked unless the operator adds
`--allow-nonzero-fee`; this deliberate friction prevents an accidental double
charge. Nonzero fees also require a nonzero fee recipient. A production fee
change requires a fresh adoption digest and creates a different immutable
Gateway.

## Failure lock

On any failure:

1. Do not tweet, publish, or route users to the Gateway.
2. Preserve the command output and transaction hash, but never paste RPC
   credentials or keystore material into a public channel.
3. If no transaction was sent, fix the configuration and use a fresh nonce and
   deadline before asking the authority to sign again.
4. If a transaction was sent, inspect its receipt and
   `Factory.usedNonces(nonce)`. Never assume a timed-out client means the
   transaction failed.
5. If a transaction succeeded but verification is incomplete, keep the launch
   closed and independently read the Factory/Gateway state.
6. Never substitute a new Stock Token, adapter, fee, CA, chain, or Factory under
   an old signature. EIP-712 binds every one of those values.

The transaction is atomic: if clone initialization fails, the transaction
reverts. The operational process is also fail-closed: a transaction hash alone
is not MarketReady.

## ERC-1271 / Safe authority

`MarketFactory` supports ERC-1271 contract authorities, but `cast wallet sign`
is an EOA signer. `adopt-market.sh` therefore rejects a contract
`projectAuthority` instead of pretending a local keystore signature will work.

For a Safe or another ERC-1271 authority:

1. obtain `hashAdoptMarket` with the same read-only call;
2. approve/sign the digest through the Safe UI, signing service, or policy
   engine;
3. produce the exact signature bytes expected by that authority contract;
4. simulate `createMarket(adoption, signature)`; and
5. have the operator broadcast and run the same receipt/on-chain verification.

That path should be automated through the organization's Safe/signature
service, not by inserting an owner private key into this script.

## Validation

These scripts were authored against Foundry `cast 1.5.1` syntax. Validate after
any edit:

```sh
bash -n ops/preflight.sh
bash -n ops/adopt-market.sh
./ops/preflight.sh --help
./ops/adopt-market.sh --help
```

No command in this section broadcasts.
