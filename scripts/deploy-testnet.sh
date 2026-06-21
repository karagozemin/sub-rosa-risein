#!/usr/bin/env bash
set -euo pipefail

IDENTITY="${STELLAR_IDENTITY:-risein-deployer}"
WASM="target/wasm32v1-none/release/sub_rosa_risein_contract.wasm"

echo "Building the Rise In mini-contract..."
stellar contract build --package sub-rosa-risein-contract

echo "Deploying to Stellar Testnet with identity: ${IDENTITY}"
CONTRACT_ID="$(stellar contract deploy \
  --wasm "${WASM}" \
  --source-account "${IDENTITY}" \
  --network testnet)"

echo
echo "Contract deployed: ${CONTRACT_ID}"
echo "Add this public value to apps/web/.env.local:"
echo "VITE_RISEIN_CONTRACT_ID=${CONTRACT_ID}"
