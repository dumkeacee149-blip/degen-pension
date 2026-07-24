#!/usr/bin/env bash
set -Eeuo pipefail

# Read-only Robinhood Chain launch preflight. This script never signs or broadcasts.

EXPECTED_CHAIN_ID=4663
ZERO_ADDRESS=0x0000000000000000000000000000000000000000

RPC_URL=${RPC_URL:-}
FACTORY_ADDRESS=${FACTORY_ADDRESS:-}
OFFICIAL_TOKEN_CA=${OFFICIAL_TOKEN_CA:-${OFFICIAL_TOKEN:-}}
STOCK_TOKEN=${STOCK_TOKEN:-}
EXPECTED_STOCK_TOKEN=${EXPECTED_STOCK_TOKEN:-}
PROJECT_ADAPTER=${PROJECT_ADAPTER:-}
STOCK_ADAPTER=${STOCK_ADAPTER:-}
AUTHORITY_ADDRESS=${AUTHORITY_ADDRESS:-}
FEE_BPS=${FEE_BPS:-0}
FEE_RECIPIENT=${FEE_RECIPIENT:-$ZERO_ADDRESS}

usage() {
  cat <<'USAGE'
Usage:
  ./ops/preflight.sh [options]

All options can instead be supplied with the matching environment variable.

Required:
  --rpc-url URL
  --factory ADDRESS
  --official-token ADDRESS
  --stock-token ADDRESS
  --expected-stock-token ADDRESS
  --project-adapter ADDRESS
  --stock-adapter ADDRESS
  --authority ADDRESS

Optional:
  --fee-bps NUMBER          Default: 0
  --fee-recipient ADDRESS  Default: zero address
  -h, --help

This command is read-only. It requires Robinhood Chain mainnet chain ID 4663.
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
    -h | --help)
      usage
      exit 0
      ;;
    *)
      die "unknown option: $1"
      ;;
  esac
done

for tool in cast curl jq; do
  command -v "$tool" >/dev/null 2>&1 || die "required command not found: $tool"
done
ok "cast, curl and jq are available"

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

require_nonempty RPC_URL "$RPC_URL"
require_nonempty FACTORY_ADDRESS "$FACTORY_ADDRESS"
require_nonempty OFFICIAL_TOKEN_CA "$OFFICIAL_TOKEN_CA"
require_nonempty STOCK_TOKEN "$STOCK_TOKEN"
require_nonempty EXPECTED_STOCK_TOKEN "$EXPECTED_STOCK_TOKEN"
require_nonempty PROJECT_ADAPTER "$PROJECT_ADAPTER"
require_nonempty STOCK_ADAPTER "$STOCK_ADAPTER"
require_nonempty AUTHORITY_ADDRESS "$AUTHORITY_ADDRESS"

require_address FACTORY_ADDRESS "$FACTORY_ADDRESS"
require_address OFFICIAL_TOKEN_CA "$OFFICIAL_TOKEN_CA"
require_address STOCK_TOKEN "$STOCK_TOKEN"
require_address EXPECTED_STOCK_TOKEN "$EXPECTED_STOCK_TOKEN"
require_address PROJECT_ADAPTER "$PROJECT_ADAPTER"
require_address STOCK_ADAPTER "$STOCK_ADAPTER"
require_address AUTHORITY_ADDRESS "$AUTHORITY_ADDRESS"
require_address FEE_RECIPIENT "$FEE_RECIPIENT"

[[ $FEE_BPS =~ ^[0-9]+$ ]] || die "FEE_BPS must be an integer"
((FEE_BPS <= 500)) || die "FEE_BPS exceeds the gateway maximum of 500"
if ((FEE_BPS > 0)); then
  ! same_address "$FEE_RECIPIENT" "$ZERO_ADDRESS" ||
    die "FEE_RECIPIENT cannot be zero when FEE_BPS is nonzero"
  warn "FEE_BPS is nonzero; confirm this is not double-charging an AMM-embedded fee"
else
  ok "explicit fee is 0 bps (safe default when AMM fees are embedded)"
fi

same_address "$STOCK_TOKEN" "$EXPECTED_STOCK_TOKEN" ||
  die "STOCK_TOKEN does not match EXPECTED_STOCK_TOKEN; refusing ambiguous Stock Token configuration"
ok "Stock Token matches the independently configured expected address"

rpc_response=$(
  curl --silent --show-error --fail --max-time 15 \
    --header 'content-type: application/json' \
    --data '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' \
    "$RPC_URL"
)
rpc_error=$(jq -r '.error.message // empty' <<<"$rpc_response")
[[ -z $rpc_error ]] || die "RPC eth_chainId failed: $rpc_error"
curl_chain_hex=$(jq -er '.result | select(type == "string")' <<<"$rpc_response") ||
  die "RPC returned no chain ID"
curl_chain_id=$(cast to-dec "$curl_chain_hex")
cast_chain_id=$(cast chain-id --rpc-url "$RPC_URL")
[[ $curl_chain_id == "$EXPECTED_CHAIN_ID" ]] ||
  die "curl RPC chain ID is $curl_chain_id, expected $EXPECTED_CHAIN_ID"
[[ $cast_chain_id == "$EXPECTED_CHAIN_ID" ]] ||
  die "cast RPC chain ID is $cast_chain_id, expected $EXPECTED_CHAIN_ID"
ok "RPC independently reports Robinhood Chain mainnet ($EXPECTED_CHAIN_ID) through curl and cast"

require_code() {
  local label=$1
  local address=$2
  local code
  code=$(cast code "$address" --rpc-url "$RPC_URL")
  [[ -n $code && $code != "0x" && $code != "0x0" ]] ||
    die "$label has no deployed bytecode"
  ok "$label has deployed bytecode"
}

read_address() {
  local target=$1
  local signature=$2
  local value
  value=$(cast call "$target" "$signature" --rpc-url "$RPC_URL" | tr -d '[:space:]')
  require_address "$signature return value" "$value"
  printf '%s' "$value"
}

require_code "Factory" "$FACTORY_ADDRESS"
require_code "official token CA" "$OFFICIAL_TOKEN_CA"
require_code "Stock Token" "$STOCK_TOKEN"
require_code "project adapter" "$PROJECT_ADAPTER"
require_code "stock adapter" "$STOCK_ADAPTER"

factory_authority=$(read_address "$FACTORY_ADDRESS" "projectAuthority()(address)")
same_address "$factory_authority" "$AUTHORITY_ADDRESS" ||
  die "Factory projectAuthority does not match AUTHORITY_ADDRESS"
ok "Factory projectAuthority matches the configured authority"

implementation=$(read_address "$FACTORY_ADDRESS" "implementation()(address)")
require_code "Factory gateway implementation" "$implementation"

project_input=$(read_address "$PROJECT_ADAPTER" "inputToken()(address)")
stock_input=$(read_address "$STOCK_ADAPTER" "inputToken()(address)")
same_address "$project_input" "$stock_input" ||
  die "adapter input tokens differ"
require_code "shared adapter input token" "$project_input"
ok "both adapters use the same deployed input token"

project_output=$(read_address "$PROJECT_ADAPTER" "outputToken()(address)")
same_address "$project_output" "$OFFICIAL_TOKEN_CA" ||
  die "project adapter outputToken does not match the official token CA"
ok "project adapter output is the official token CA"

stock_output=$(read_address "$STOCK_ADAPTER" "outputToken()(address)")
same_address "$stock_output" "$STOCK_TOKEN" ||
  die "stock adapter outputToken does not match the configured Stock Token"
ok "stock adapter output is the configured Stock Token"

authority_code=$(cast code "$AUTHORITY_ADDRESS" --rpc-url "$RPC_URL")
if [[ -n $authority_code && $authority_code != "0x" && $authority_code != "0x0" ]]; then
  warn "projectAuthority is a contract (ERC-1271 path); adopt-market.sh intentionally supports EOA signing only"
  warn "use a Safe transaction/signature service, then submit createMarket with the externally produced signature"
else
  ok "projectAuthority is an EOA compatible with the local keystore signing path"
fi

printf '\nPREFLIGHT PASSED — read-only checks completed; nothing was signed or broadcast.\n'
