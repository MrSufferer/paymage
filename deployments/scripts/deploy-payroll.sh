#!/usr/bin/env bash
# Deploy payroll contract to testnet/futurenet with embedded payroll_10_10 VK.
#
# IMPORTANT: The payroll contract requires its own Groth16 verifier instance
# compiled with the PAYROLL circuit's verification key. Do NOT reuse the pool
# verifier — it embeds a different VK (policy_tx_2_2) and will reject all
# payroll proofs.
#
# Prerequisites:
#   - stellar CLI 27.0.0+
#   - Demo circuits and keys built when circuit sources changed:
#     BUILD_TESTS=1 REGEN_KEYS=1 ONLY_KEY_CIRCUITS=payroll_10_10,payrollWithdraw_10 cargo build -p circuits
#
# Usage:
#   deployments/scripts/deploy-payroll.sh <network> --deployer <name> --token <address> [--admin <address>] [--budget-cap <stroops>]
#
# Networks: testnet, futurenet

set -euo pipefail

die() { echo "deploy-payroll.sh: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null || die "missing '$1'"; }
step() { echo "==> $*" >&2; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
WASM_DIR="$ROOT_DIR/target/stellar"

NETWORK="${1:-}"
shift || true

DEPLOYER=""
ADMIN=""
TOKEN=""
BUDGET_CAP="100000000000"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --deployer) DEPLOYER="$2"; shift 2 ;;
    --admin) ADMIN="$2"; shift 2 ;;
    --token) TOKEN="$2"; shift 2 ;;
    --budget-cap) BUDGET_CAP="$2"; shift 2 ;;
    *) die "unknown option: $1" ;;
  esac
done

[[ -n "$NETWORK" ]] || die "usage: deploy-payroll.sh <network> --deployer <name> --token <address>"
[[ -n "$DEPLOYER" ]] || die "--deployer required"
[[ -n "$TOKEN" ]] || die "--token required"
need stellar

resolve_address() {
  local input="$1"
  if [[ "$input" =~ ^[GC][A-Z0-9]{55}$ ]]; then
    echo "$input"
    return
  fi
  if addr="$(stellar keys address "$input" 2>/dev/null)"; then
    echo "$addr"
    return
  fi
  echo "$input"
}

DEPLOYER_ADDR="$(resolve_address "$DEPLOYER")"
ADMIN_ADDR="${ADMIN:-$(resolve_address "$DEPLOYER")}"

VERIFIER_WASM="$WASM_DIR/circom_groth16_verifier.wasm"
PAYROLL_WASM="$WASM_DIR/payroll.wasm"

step "building payroll contract..."
stellar contract build \
  --manifest-path "$ROOT_DIR/Cargo.toml" \
  --out-dir "$WASM_DIR" \
  --optimize \
  --package payroll >/dev/null

[[ -f "$PAYROLL_WASM" ]] || die "missing payroll WASM: $PAYROLL_WASM"

PAYROLL_VK_JSON="$ROOT_DIR/testdata/payroll_10_10_vk.json"
WITHDRAW_VK_JSON="$ROOT_DIR/testdata/payrollWithdraw_10_vk.json"
[[ -f "$PAYROLL_VK_JSON" ]] || die "missing VK JSON: $PAYROLL_VK_JSON (run BUILD_TESTS=1 REGEN_KEYS=1 cargo build -p circuits first)"
[[ -f "$WITHDRAW_VK_JSON" ]] || die "missing VK JSON: $WITHDRAW_VK_JSON (run BUILD_TESTS=1 REGEN_KEYS=1 cargo build -p circuits first)"

step "building circom-groth16-verifier with payroll_10_10 VK..."
VERIFIER_VK_JSON="$PAYROLL_VK_JSON" stellar contract build \
  --manifest-path "$ROOT_DIR/Cargo.toml" \
  --out-dir "$WASM_DIR" \
  --optimize \
  --package circom-groth16-verifier >/dev/null

step "deploying payroll verifier..."
PAYROLL_VERIFIER_OUTPUT="$(stellar contract deploy \
  --wasm "$WASM_DIR/circom_groth16_verifier.wasm" \
  --source-account "$DEPLOYER" \
  --network "$NETWORK" 2>&1)"
PAYROLL_VERIFIER_ID="$(grep -Eo 'C[A-Z0-9]{55}' <<<"$PAYROLL_VERIFIER_OUTPUT" | head -1)"
[[ -n "$PAYROLL_VERIFIER_ID" ]] || die "failed to parse payroll verifier contract id"
step "payroll verifier: $PAYROLL_VERIFIER_ID"

step "building circom-groth16-verifier with payrollWithdraw_10 VK..."
VERIFIER_VK_JSON="$WITHDRAW_VK_JSON" stellar contract build \
  --manifest-path "$ROOT_DIR/Cargo.toml" \
  --out-dir "$WASM_DIR" \
  --optimize \
  --package circom-groth16-verifier >/dev/null

step "deploying withdraw verifier..."
WITHDRAW_VERIFIER_OUTPUT="$(stellar contract deploy \
  --wasm "$WASM_DIR/circom_groth16_verifier.wasm" \
  --source-account "$DEPLOYER" \
  --network "$NETWORK" 2>&1)"
WITHDRAW_VERIFIER_ID="$(grep -Eo 'C[A-Z0-9]{55}' <<<"$WITHDRAW_VERIFIER_OUTPUT" | head -1)"
[[ -n "$WITHDRAW_VERIFIER_ID" ]] || die "failed to parse withdraw verifier contract id"
step "withdraw verifier: $WITHDRAW_VERIFIER_ID"

step "deploying payroll with __constructor args..."
PAYROLL_OUTPUT="$(stellar contract deploy \
  --wasm "$PAYROLL_WASM" \
  --source-account "$DEPLOYER" \
  --network "$NETWORK" \
  -- \
  --admin "$ADMIN_ADDR" \
  --token "$TOKEN" \
  --verifier "$PAYROLL_VERIFIER_ID" \
  --employee-root "0" \
  --budget-cap "$BUDGET_CAP" 2>&1)"
PAYROLL_ID="$(grep -Eo 'C[A-Z0-9]{55}' <<<"$PAYROLL_OUTPUT" | head -1)"
[[ -n "$PAYROLL_ID" ]] || die "failed to parse payroll contract id"
step "payroll: $PAYROLL_ID"

step "wiring withdraw verifier..."
stellar contract invoke \
  --id "$PAYROLL_ID" \
  --source-account "$DEPLOYER" \
  --network "$NETWORK" \
  --send yes \
  -- \
  set_withdraw_verifier \
  --verifier "$WITHDRAW_VERIFIER_ID" >/dev/null

PAYROLL_DEPLOY_JSON="{\"network\":\"$NETWORK\",\"deployer\":\"$DEPLOYER_ADDR\",\"admin\":\"$ADMIN_ADDR\",\"payroll_verifier\":\"$PAYROLL_VERIFIER_ID\",\"withdraw_verifier\":\"$WITHDRAW_VERIFIER_ID\",\"payroll\":\"$PAYROLL_ID\",\"token\":\"$TOKEN\",\"budget_cap\":\"$BUDGET_CAP\",\"vk\":\"payroll_10_10 + payrollWithdraw_10\"}"

DEPLOYMENTS_DIR="$ROOT_DIR/deployments/$NETWORK"
mkdir -p "$DEPLOYMENTS_DIR"
echo "$PAYROLL_DEPLOY_JSON" >> "$DEPLOYMENTS_DIR/deployments.json"

echo ""
echo "┌─────────────────────────────────────────────────────────────┐"
echo "│                 PAYROLL DEPLOYMENT SUCCESS                   │"
echo "└─────────────────────────────────────────────────────────────┘"
echo "  Network:        $NETWORK"
echo "  Deployer:       $DEPLOYER_ADDR"
echo "  Admin:          $ADMIN_ADDR"
echo "  Payroll Verifier:  $PAYROLL_VERIFIER_ID"
echo "  Withdraw Verifier: $WITHDRAW_VERIFIER_ID"
echo "  Payroll:        $PAYROLL_ID"
echo "  Token:          $TOKEN"
echo "  Budget Cap:     $BUDGET_CAP"
echo ""
echo "  Add to zk-payroll-dashboard .env:"
echo "  NEXT_PUBLIC_PAYROLL_CONTRACT=$PAYROLL_ID"
echo "  NEXT_PUBLIC_VERIFIER_CONTRACT=$PAYROLL_VERIFIER_ID"
echo "  NEXT_PUBLIC_WITHDRAW_VERIFIER_CONTRACT=$WITHDRAW_VERIFIER_ID"
