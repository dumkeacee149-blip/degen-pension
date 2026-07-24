#!/usr/bin/env bash
set -Eeuo pipefail

# Default mode is a signed eth_call simulation. Only --broadcast sends a transaction.

ZERO_ADDRESS=0x0000000000000000000000000000000000000000
SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)

RPC_URL=${RPC_URL:-}
FACTORY_ADDRESS=${FACTORY_ADDRESS:-}
OFFICIAL_TOKEN_CA=${OFFICIAL_TOKEN_CA:-${OFFICIAL_TOKEN:-}}
STOCK_TOKEN=${STOCK_TOKEN:-}
EXPECTED_STOCK_TOKEN=${EXPECTED_STOCK_TOKEN:-}
PROJECT_ADAPTER=${PROJECT_ADAPTER:-}
STOCK_ADAPTER=${STOCK_ADAPTER:-}
AUTHORITY_ADDRESS=${AUTHORITY_ADDRESS:-}
OPERATOR_ADDRESS=${OPERATOR_ADDRESS:-}
FEE_BPS=${FEE_BPS:-0}
FEE_RECIPIENT=${FEE_RECIPIENT:-$ZERO_ADDRESS}
ADOPTION_NONCE=${ADOPTION_NONCE:-${NONCE:-}}
ADOPTION_DEADLINE=${ADOPTION_DEADLINE:-${DEADLINE:-}}

AUTHORITY_ACCOUNT=${AUTHORITY_ACCOUNT:-}
AUTHORITY_KEYSTORE=${AUTHORITY_KEYSTORE:-}
AUTHORITY_PASSWORD_FILE=${AUTHORITY_PASSWORD_FILE:-}
OPERATOR_ACCOUNT=${OPERATOR_ACCOUNT:-}
OPERATOR_KEYSTORE=${OPERATOR_KEYSTORE:-}
OPERATOR_PASSWORD_FILE=${OPERATOR_PASSWORD_FILE:-}

BROADCAST=false
ALLOW_NONZERO_FEE=false

usage() {
  cat <<'USAGE'
Usage:
  ./ops/adopt-market.sh [options]
  ./ops/adopt-market.sh [options] --broadcast

Default behavior:
  1. Run the read-only preflight.
  2. Read Factory.hashAdoptMarket for the EIP-712 digest.
  3. Sign that digest with an explicitly selected Foundry EOA keystore/account.
  4. Verify the signer locally.
  5. Simulate createMarket with eth_call.
  6. Exit without broadcasting.

Required market options (or matching environment variables):
  --rpc-url URL                    RPC_URL
  --factory ADDRESS               FACTORY_ADDRESS
  --official-token ADDRESS        OFFICIAL_TOKEN_CA
  --stock-token ADDRESS           STOCK_TOKEN
  --expected-stock-token ADDRESS  EXPECTED_STOCK_TOKEN
  --project-adapter ADDRESS       PROJECT_ADAPTER
  --stock-adapter ADDRESS         STOCK_ADAPTER
  --authority ADDRESS             AUTHORITY_ADDRESS
  --operator ADDRESS              OPERATOR_ADDRESS
  --nonce UINT256                 ADOPTION_NONCE
  --deadline UNIX_SECONDS         ADOPTION_DEADLINE

Fee options:
  --fee-bps NUMBER                FEE_BPS (default: 0)
  --fee-recipient ADDRESS         FEE_RECIPIENT (default: zero address)
  --allow-nonzero-fee             Required guardrail if fee-bps is not zero

Authority signer (choose exactly one):
  --authority-account NAME        AUTHORITY_ACCOUNT
  --authority-keystore PATH       AUTHORITY_KEYSTORE
  --authority-password-file PATH  AUTHORITY_PASSWORD_FILE (optional; otherwise prompt)

Operator signer, required only with --broadcast (choose exactly one):
  --operator-account NAME         OPERATOR_ACCOUNT
  --operator-keystore PATH        OPERATOR_KEYSTORE
  --operator-password-file PATH   OPERATOR_PASSWORD_FILE (optional; otherwise prompt)

Mutation control:
  --broadcast                     Explicitly send createMarket
  -h, --help

Raw private-key and mnemonic flags are deliberately unsupported.
USAGE
}

die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

ok() {
  printf 'OK: %s\n' "$*"
}

warn() {
  printf 'WARN: %s\n' "$*" >&2
}

need_option_value() {
  [[ $# -ge 2 && -n ${2:-} ]] || die "missing value after $1"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --rpc-url)
      need_option_value "$@"
      RPC_URL=$2
      shift 2
      ;;
    --factory)
      need_option_value "$@"
      FACTORY_ADDRESS=$2
      shift 2
      ;;
    --official-token)
      need_option_value "$@"
      OFFICIAL_TOKEN_CA=$2
      shift 2
      ;;
    --stock-token)
      need_option_value "$@"
      STOCK_TOKEN=$2
      shift 2
      ;;
    --expected-stock-token)
      need_option_value "$@"
      EXPECTED_STOCK_TOKEN=$2
      shift 2
      ;;
    --project-adapter)
      need_option_value "$@"
      PROJECT_ADAPTER=$2
      shift 2
      ;;
    --stock-adapter)
      need_option_value "$@"
      STOCK_ADAPTER=$2
      shift 2
      ;;
    --authority)
      need_option_value "$@"
      AUTHORITY_ADDRESS=$2
      shift 2
      ;;
    --operator)
      need_option_value "$@"
      OPERATOR_ADDRESS=$2
      shift 2
      ;;
    --nonce)
      need_option_value "$@"
      ADOPTION_NONCE=$2
      shift 2
      ;;
    --deadline)
      need_option_value "$@"
      ADOPTION_DEADLINE=$2
      shift 2
      ;;
    --fee-bps)
      need_option_value "$@"
      FEE_BPS=$2
      shift 2
      ;;
    --fee-recipient)
      need_option_value "$@"
      FEE_RECIPIENT=$2
      shift 2
      ;;
    --authority-account)
      need_option_value "$@"
      AUTHORITY_ACCOUNT=$2
      shift 2
      ;;
    --authority-keystore)
      need_option_value "$@"
      AUTHORITY_KEYSTORE=$2
      shift 2
      ;;
    --authority-password-file)
      need_option_value "$@"
      AUTHORITY_PASSWORD_FILE=$2
      shift 2
      ;;
    --operator-account)
      need_option_value "$@"
      OPERATOR_ACCOUNT=$2
      shift 2
      ;;
    --operator-keystore)
      need_option_value "$@"
      OPERATOR_KEYSTORE=$2
      shift 2
      ;;
    --operator-password-file)
      need_option_value "$@"
      OPERATOR_PASSWORD_FILE=$2
      shift 2
      ;;
    --allow-nonzero-fee)
      ALLOW_NONZERO_FEE=true
      shift
      ;;
    --broadcast)
      BROADCAST=true
      shift
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      die "unknown option: $1"
      ;;
  esac
done

require_nonempty() {
  local name=$1
  local value=$2
  [[ -n $value ]] || die "$name is required"
}

require_address() {
  local name=$1
  local value=$2
  [[ $value =~ ^0x[0-9a-fA-F]{40}$ ]] || die "$name is not a 20-byte hex address"
}

lower_address() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]'
}

same_address() {
  [[ $(lower_address "$1") == "$(lower_address "$2")" ]]
}

for tool in cast curl jq; do
  command -v "$tool" >/dev/null 2>&1 || die "required command not found: $tool"
done

require_nonempty RPC_URL "$RPC_URL"
require_nonempty FACTORY_ADDRESS "$FACTORY_ADDRESS"
require_nonempty OFFICIAL_TOKEN_CA "$OFFICIAL_TOKEN_CA"
require_nonempty STOCK_TOKEN "$STOCK_TOKEN"
require_nonempty EXPECTED_STOCK_TOKEN "$EXPECTED_STOCK_TOKEN"
require_nonempty PROJECT_ADAPTER "$PROJECT_ADAPTER"
require_nonempty STOCK_ADAPTER "$STOCK_ADAPTER"
require_nonempty AUTHORITY_ADDRESS "$AUTHORITY_ADDRESS"
require_nonempty OPERATOR_ADDRESS "$OPERATOR_ADDRESS"
require_nonempty ADOPTION_NONCE "$ADOPTION_NONCE"
require_nonempty ADOPTION_DEADLINE "$ADOPTION_DEADLINE"

require_address FACTORY_ADDRESS "$FACTORY_ADDRESS"
require_address OFFICIAL_TOKEN_CA "$OFFICIAL_TOKEN_CA"
require_address STOCK_TOKEN "$STOCK_TOKEN"
require_address EXPECTED_STOCK_TOKEN "$EXPECTED_STOCK_TOKEN"
require_address PROJECT_ADAPTER "$PROJECT_ADAPTER"
require_address STOCK_ADAPTER "$STOCK_ADAPTER"
require_address AUTHORITY_ADDRESS "$AUTHORITY_ADDRESS"
require_address OPERATOR_ADDRESS "$OPERATOR_ADDRESS"
require_address FEE_RECIPIENT "$FEE_RECIPIENT"

[[ $FEE_BPS =~ ^[0-9]+$ ]] || die "FEE_BPS must be an integer"
[[ $ADOPTION_NONCE =~ ^[0-9]+$ ]] || die "ADOPTION_NONCE must be an unsigned decimal integer"
[[ $ADOPTION_DEADLINE =~ ^[0-9]+$ ]] || die "ADOPTION_DEADLINE must be a UNIX timestamp"
((FEE_BPS <= 500)) || die "FEE_BPS exceeds the gateway maximum of 500"
if ((FEE_BPS != 0)) && [[ $ALLOW_NONZERO_FEE != true ]]; then
  die "nonzero FEE_BPS is locked; use 0 to avoid AMM double-charge, or explicitly add --allow-nonzero-fee"
fi
if ((FEE_BPS != 0)); then
  ! same_address "$FEE_RECIPIENT" "$ZERO_ADDRESS" ||
    die "FEE_RECIPIENT cannot be zero for a nonzero fee"
  warn "nonzero explicit fee override is active"
fi

if [[ -n $AUTHORITY_ACCOUNT && -n $AUTHORITY_KEYSTORE ]]; then
  die "choose one authority signer: AUTHORITY_ACCOUNT or AUTHORITY_KEYSTORE"
fi
if [[ -z $AUTHORITY_ACCOUNT && -z $AUTHORITY_KEYSTORE ]]; then
  die "AUTHORITY_ACCOUNT or AUTHORITY_KEYSTORE is required"
fi
if [[ -n $AUTHORITY_KEYSTORE ]]; then
  [[ -r $AUTHORITY_KEYSTORE ]] || die "AUTHORITY_KEYSTORE is not readable"
fi
if [[ -n $AUTHORITY_PASSWORD_FILE ]]; then
  [[ -r $AUTHORITY_PASSWORD_FILE ]] || die "AUTHORITY_PASSWORD_FILE is not readable"
fi

if [[ $BROADCAST == true ]]; then
  if [[ -n $OPERATOR_ACCOUNT && -n $OPERATOR_KEYSTORE ]]; then
    die "choose one operator signer: OPERATOR_ACCOUNT or OPERATOR_KEYSTORE"
  fi
  if [[ -z $OPERATOR_ACCOUNT && -z $OPERATOR_KEYSTORE ]]; then
    die "broadcast mode requires OPERATOR_ACCOUNT or OPERATOR_KEYSTORE"
  fi
  if [[ -n $OPERATOR_KEYSTORE ]]; then
    [[ -r $OPERATOR_KEYSTORE ]] || die "OPERATOR_KEYSTORE is not readable"
  fi
  if [[ -n $OPERATOR_PASSWORD_FILE ]]; then
    [[ -r $OPERATOR_PASSWORD_FILE ]] || die "OPERATOR_PASSWORD_FILE is not readable"
  fi
fi

printf 'Phase 1/5 — fail-closed read-only preflight\n'
RPC_URL=$RPC_URL \
  FACTORY_ADDRESS=$FACTORY_ADDRESS \
  OFFICIAL_TOKEN_CA=$OFFICIAL_TOKEN_CA \
  STOCK_TOKEN=$STOCK_TOKEN \
  EXPECTED_STOCK_TOKEN=$EXPECTED_STOCK_TOKEN \
  PROJECT_ADAPTER=$PROJECT_ADAPTER \
  STOCK_ADAPTER=$STOCK_ADAPTER \
  AUTHORITY_ADDRESS=$AUTHORITY_ADDRESS \
  FEE_BPS=$FEE_BPS \
  FEE_RECIPIENT=$FEE_RECIPIENT \
  bash "$SCRIPT_DIR/preflight.sh"

authority_code=$(cast code "$AUTHORITY_ADDRESS" --rpc-url "$RPC_URL")
if [[ -n $authority_code && $authority_code != "0x" && $authority_code != "0x0" ]]; then
  die "projectAuthority is an ERC-1271 contract; this CLI deliberately signs only EOA authority digests. Use Safe/signature-service approval and submit createMarket separately."
fi

latest_block=$(cast block latest --json --rpc-url "$RPC_URL")
chain_timestamp_raw=$(jq -er '.timestamp' <<<"$latest_block") || die "could not read latest block timestamp"
if [[ $chain_timestamp_raw == 0x* ]]; then
  chain_timestamp=$(cast to-dec "$chain_timestamp_raw")
else
  chain_timestamp=$chain_timestamp_raw
fi
[[ $chain_timestamp =~ ^[0-9]+$ ]] || die "latest block timestamp is not numeric"
((ADOPTION_DEADLINE > chain_timestamp + 60)) ||
  die "authorization deadline must be at least 60 seconds after the latest chain timestamp"

nonce_used=$(
  cast call "$FACTORY_ADDRESS" "usedNonces(uint256)(bool)" "$ADOPTION_NONCE" \
    --rpc-url "$RPC_URL" | tr -d '[:space:]'
)
[[ $nonce_used == "false" ]] || die "ADOPTION_NONCE is already used"
ok "authorization nonce is unused and deadline is live"

AUTHORITY_WALLET_ARGS=()
if [[ -n $AUTHORITY_ACCOUNT ]]; then
  AUTHORITY_WALLET_ARGS+=(--account "$AUTHORITY_ACCOUNT")
else
  AUTHORITY_WALLET_ARGS+=(--keystore "$AUTHORITY_KEYSTORE")
fi
if [[ -n $AUTHORITY_PASSWORD_FILE ]]; then
  AUTHORITY_WALLET_ARGS+=(--password-file "$AUTHORITY_PASSWORD_FILE")
fi

ADOPTION_TUPLE="($OFFICIAL_TOKEN_CA,$STOCK_TOKEN,$PROJECT_ADAPTER,$STOCK_ADAPTER,$FEE_BPS,$FEE_RECIPIENT,$ADOPTION_NONCE,$ADOPTION_DEADLINE)"
HASH_SIGNATURE="hashAdoptMarket((address,address,address,address,uint16,address,uint256,uint256))(bytes32)"
CALL_SIGNATURE="createMarket((address,address,address,address,uint16,address,uint256,uint256),bytes)(address)"
SEND_SIGNATURE="createMarket((address,address,address,address,uint16,address,uint256,uint256),bytes)"

printf '\nPhase 2/5 — obtain the exact on-chain EIP-712 digest\n'
DIGEST=$(
  cast call "$FACTORY_ADDRESS" "$HASH_SIGNATURE" "$ADOPTION_TUPLE" \
    --rpc-url "$RPC_URL" | tr -d '[:space:]'
)
[[ $DIGEST =~ ^0x[0-9a-fA-F]{64}$ ]] || die "Factory returned an invalid adoption digest"
printf 'Authorization digest: %s\n' "$DIGEST"

SIGNATURE=
trap 'unset SIGNATURE 2>/dev/null || true' EXIT

printf '\nPhase 3/5 — sign with the selected Foundry authority keystore/account\n'
SIGNATURE=$(
  cast wallet sign --no-hash "${AUTHORITY_WALLET_ARGS[@]}" "$DIGEST" |
    tr -d '[:space:]'
)
[[ $SIGNATURE =~ ^0x[0-9a-fA-F]{130}$ ]] ||
  die "authority signer did not return a 65-byte signature"
cast wallet verify --no-hash --address "$AUTHORITY_ADDRESS" "$DIGEST" "$SIGNATURE" >/dev/null
ok "authority signature verifies; signature bytes are intentionally not printed"

printf '\nPhase 4/5 — simulate the exact createMarket call\n'
SIMULATED_MARKET=$(
  cast call "$FACTORY_ADDRESS" "$CALL_SIGNATURE" "$ADOPTION_TUPLE" "$SIGNATURE" \
    --from "$OPERATOR_ADDRESS" --rpc-url "$RPC_URL" | tr -d '[:space:]'
)
require_address "simulated market" "$SIMULATED_MARKET"
printf 'Simulated market address: %s\n' "$SIMULATED_MARKET"
ok "eth_call completed atomically; no state was changed"

if [[ $BROADCAST != true ]]; then
  printf '\nDRY RUN COMPLETE — no transaction was broadcast.\n'
  printf 'Re-run the same frozen inputs with --broadcast only after independent human verification.\n'
  exit 0
fi

OPERATOR_WALLET_ARGS=()
if [[ -n $OPERATOR_ACCOUNT ]]; then
  OPERATOR_WALLET_ARGS+=(--account "$OPERATOR_ACCOUNT")
else
  OPERATOR_WALLET_ARGS+=(--keystore "$OPERATOR_KEYSTORE")
fi
if [[ -n $OPERATOR_PASSWORD_FILE ]]; then
  OPERATOR_WALLET_ARGS+=(--password-file "$OPERATOR_PASSWORD_FILE")
fi

derived_operator=$(
  cast wallet address "${OPERATOR_WALLET_ARGS[@]}" | tail -n 1 | tr -d '[:space:]'
)
require_address "operator keystore address" "$derived_operator"
same_address "$derived_operator" "$OPERATOR_ADDRESS" ||
  die "selected operator keystore/account does not match OPERATOR_ADDRESS"

operator_balance=$(cast balance "$OPERATOR_ADDRESS" --rpc-url "$RPC_URL")
[[ $operator_balance =~ ^[0-9]+$ ]] || die "could not read operator native balance"
((operator_balance > 0)) || die "operator has no native gas balance"
ok "operator signer matches and has a nonzero native gas balance"

printf '\nPhase 5/5 — BROADCAST explicitly enabled\n'
started_at=$(date +%s)
TX_HASH=$(
  cast send --async --rpc-url "$RPC_URL" --from "$OPERATOR_ADDRESS" \
    "${OPERATOR_WALLET_ARGS[@]}" \
    "$FACTORY_ADDRESS" "$SEND_SIGNATURE" "$ADOPTION_TUPLE" "$SIGNATURE" |
    tail -n 1 | tr -d '[:space:]'
)
[[ $TX_HASH =~ ^0x[0-9a-fA-F]{64}$ ]] || die "cast send did not return a transaction hash"
printf 'Transaction hash: %s\n' "$TX_HASH"

receipt=$(cast receipt --json --confirmations 1 --rpc-url "$RPC_URL" "$TX_HASH")
status=$(jq -r '.status // empty' <<<"$receipt")
[[ $status == "0x1" || $status == "1" ]] ||
  die "createMarket transaction reverted or returned an unknown status; keep launch closed and inspect $TX_HASH"

event_topic=$(cast sig-event "MarketCreated(address,address,address,address,address,address,uint16,address,uint256,bytes32)")
factory_lower=$(lower_address "$FACTORY_ADDRESS")
event_topic_lower=$(lower_address "$event_topic")
market_log=$(
  jq -c --arg factory "$factory_lower" --arg topic "$event_topic_lower" '
    first(
      .logs[]?
      | select((.address | ascii_downcase) == $factory)
      | select((.topics[0] | ascii_downcase) == $topic)
    ) // empty
  ' <<<"$receipt"
)
[[ -n $market_log ]] ||
  die "receipt succeeded but MarketCreated was not found; keep launch closed and inspect $TX_HASH"

market_topic=$(jq -r '.topics[1]' <<<"$market_log")
creator_topic=$(jq -r '.topics[2]' <<<"$market_log")
official_topic=$(jq -r '.topics[3]' <<<"$market_log")
[[ $market_topic =~ ^0x[0-9a-fA-F]{64}$ ]] || die "invalid indexed market topic"
[[ $creator_topic =~ ^0x[0-9a-fA-F]{64}$ ]] || die "invalid indexed creator topic"
[[ $official_topic =~ ^0x[0-9a-fA-F]{64}$ ]] || die "invalid indexed official-token topic"

MARKET_ADDRESS="0x${market_topic: -40}"
EVENT_CREATOR="0x${creator_topic: -40}"
EVENT_OFFICIAL_TOKEN="0x${official_topic: -40}"
same_address "$EVENT_CREATOR" "$OPERATOR_ADDRESS" ||
  die "MarketCreated creator does not match OPERATOR_ADDRESS"
same_address "$EVENT_OFFICIAL_TOKEN" "$OFFICIAL_TOKEN_CA" ||
  die "MarketCreated officialToken does not match the frozen CA"

market_code=$(cast code "$MARKET_ADDRESS" --rpc-url "$RPC_URL")
[[ -n $market_code && $market_code != "0x" && $market_code != "0x0" ]] ||
  die "MarketCreated address has no deployed bytecode"

verify_address_call() {
  local signature=$1
  local expected=$2
  local actual
  actual=$(cast call "$MARKET_ADDRESS" "$signature" --rpc-url "$RPC_URL" | tr -d '[:space:]')
  require_address "$signature return value" "$actual"
  same_address "$actual" "$expected" || die "$signature does not match the frozen launch value"
}

registered=$(
  cast call "$FACTORY_ADDRESS" "isMarket(address)(bool)" "$MARKET_ADDRESS" \
    --rpc-url "$RPC_URL" | tr -d '[:space:]'
)
[[ $registered == "true" ]] || die "Factory does not recognize the emitted market"

verify_address_call "officialToken()(address)" "$OFFICIAL_TOKEN_CA"
verify_address_call "stockToken()(address)" "$STOCK_TOKEN"
verify_address_call "projectAdapter()(address)" "$PROJECT_ADAPTER"
verify_address_call "stockAdapter()(address)" "$STOCK_ADAPTER"
verify_address_call "feeRecipient()(address)" "$FEE_RECIPIENT"

onchain_fee_bps=$(
  cast call "$MARKET_ADDRESS" "explicitFeeBps()(uint16)" \
    --rpc-url "$RPC_URL" | tr -d '[:space:]'
)
[[ $onchain_fee_bps == "$FEE_BPS" ]] || die "market explicitFeeBps does not match the frozen launch value"

nonce_used_after=$(
  cast call "$FACTORY_ADDRESS" "usedNonces(uint256)(bool)" "$ADOPTION_NONCE" \
    --rpc-url "$RPC_URL" | tr -d '[:space:]'
)
[[ $nonce_used_after == "true" ]] || die "authorization nonce is not marked used"

unset SIGNATURE
elapsed=$(( $(date +%s) - started_at ))
printf '\nMARKET READY\n'
printf 'Gateway: %s\n' "$MARKET_ADDRESS"
printf 'Official token CA: %s\n' "$OFFICIAL_TOKEN_CA"
printf 'Stock Token: %s\n' "$STOCK_TOKEN"
printf 'Transaction hash: %s\n' "$TX_HASH"
printf 'Broadcast-to-verification time: %ss\n' "$elapsed"
if ((elapsed > 150)); then
  warn "verification exceeded the 150-second operational target"
fi
