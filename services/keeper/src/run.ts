// Keeper CLI entry. Runs one full pass over a round (wait for R → open → reveal
// all) and prints the result. Re-running is safe: completed work is skipped.
//
// Env:
//   ROUND_CONTRACT_ID   deployed Round contract id (C…)
//   ROUND_ID            round to keep (default 1)
//   KEEPER_SECRET       funded signer secret (S…); permissionless role
//   MAX_WAIT_SECONDS    how long to wait for round R (default 0)
//   RPC_URL             default https://soroban-testnet.stellar.org
//   NETWORK_PASSPHRASE  default testnet

import { SubRosaClient } from "@sub-rosa/sdk";
import { quicknet } from "@sub-rosa/tlock";

import { keepRound } from "./keeper.js";

function reqEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing required env var ${name}`);
  return v;
}

async function main() {
  const sdk = new SubRosaClient({
    rpcUrl: process.env.RPC_URL ?? "https://soroban-testnet.stellar.org",
    networkPassphrase:
      process.env.NETWORK_PASSPHRASE ?? "Test SDF Network ; September 2015",
    contractId: reqEnv("ROUND_CONTRACT_ID"),
    secretKey: reqEnv("KEEPER_SECRET"),
  });

  const result = await keepRound(
    {
      sdk,
      drand: quicknet(),
      log: (m) => console.log(`· ${m}`),
      maxWaitSeconds: Number(process.env.MAX_WAIT_SECONDS ?? "0"),
    },
    BigInt(process.env.ROUND_ID ?? "1"),
  );

  console.log("\nkeeper result:", JSON.stringify(result, bigintReplacer, 2));
  if (result.finalStatus === "Open") {
    console.log("round still Open (R not yet published) — re-run later.");
  }
}

function bigintReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

main().catch((err) => {
  console.error("keeper failed:", err);
  process.exit(1);
});
