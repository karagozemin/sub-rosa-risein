#!/usr/bin/env bash
# Read-only mainnet proof — no secrets required.
set -euo pipefail
cd "$(dirname "$0")/../../.."
pnpm --filter @sub-rosa/sdk exec tsx scripts/mainnet-verify.ts "$@"
