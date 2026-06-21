#!/usr/bin/env bash
# Mainnet micro commit on existing contract — dry-run by default.
#
# Dry-run checklist:
#   pnpm mainnet:micro
#
# Execute (real XLM):
#   MAINNET_CONFIRM=SUB_ROSA_MAINNET OPERATOR_SECRET=S… BIDDER_SECRET=S… \
#     pnpm mainnet:micro -- --execute
set -euo pipefail
cd "$(dirname "$0")/../../.."
pnpm --filter @sub-rosa/sdk exec tsx scripts/mainnet-micro.ts "$@"
