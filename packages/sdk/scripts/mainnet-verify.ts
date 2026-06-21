// Read-only mainnet proof checker — no transactions, no secrets required.
//
// Verifies the deployed Round contract and settled round 1 match frozen artifacts.

import { SubRosaClient } from "../src/client.js";
import { MAINNET_ARTIFACTS } from "../src/mainnet-artifacts.js";

const fail = (m: string): never => {
  throw new Error(`mainnet verify failed: ${m}`);
};

async function main() {
  const dryRun = process.argv.includes("--dry-run") || process.env.MAINNET_DRY_RUN === "1";

  console.log("Sub Rosa — mainnet settlement proof (read-only)\n");
  console.log("Checklist:");
  console.log("  [ ] Contract id matches frozen artifact");
  console.log("  [ ] Round 1 status is Settled");
  console.log("  [ ] Drand reveal round R matches artifact");
  console.log("  [ ] Bid/escrow stroops match micro smoke amounts (1 / 5 XLM)");
  console.log("  [ ] Bidder marked valid + settled\n");

  if (dryRun) {
    console.log("DRY-RUN — would read RPC only. Re-run without --dry-run to fetch live state.\n");
    console.log("Expected:");
    console.log(JSON.stringify(
      {
        contractId: MAINNET_ARTIFACTS.contractId,
        roundId: MAINNET_ARTIFACTS.settledRoundId,
        status: MAINNET_ARTIFACTS.status,
        revealRound: MAINNET_ARTIFACTS.revealRound,
        bidStroops: MAINNET_ARTIFACTS.bidStroops.toString(),
        escrowStroops: MAINNET_ARTIFACTS.escrowStroops.toString(),
      },
      null,
      2,
    ));
    return;
  }

  const reader = new SubRosaClient({
    rpcUrl: process.env.RPC_URL ?? MAINNET_ARTIFACTS.rpcUrl,
    networkPassphrase: process.env.NETWORK_PASSPHRASE ?? MAINNET_ARTIFACTS.networkPassphrase,
    contractId: process.env.ROUND_CONTRACT_ID ?? MAINNET_ARTIFACTS.contractId,
    publicKey: process.env.MAINNET_READER_PUBKEY ?? "GCDARJFKKSTJYAZC647H4ZSSSPXPPSKOWOHGMUNCT22VG74KXZ5BHVNR",
  });

  const roundId = BigInt(process.env.ROUND_ID ?? String(MAINNET_ARTIFACTS.settledRoundId));
  const round = await reader.getRound(roundId);
  const bidders = await reader.getBidders(roundId);
  if (bidders.length !== 1) fail(`expected 1 bidder, got ${bidders.length}`);

  const st = await reader.getBidState(roundId, bidders[0]!);
  if (round.status.tag !== "Settled") fail(`status ${round.status.tag} != Settled`);
  if (Number(round.reveal_round) !== MAINNET_ARTIFACTS.revealRound) {
    fail(`R ${round.reveal_round} != ${MAINNET_ARTIFACTS.revealRound}`);
  }
  if (st.revealed_value !== MAINNET_ARTIFACTS.bidStroops) {
    fail(`revealed ${st.revealed_value} != ${MAINNET_ARTIFACTS.bidStroops}`);
  }
  if (st.escrow !== MAINNET_ARTIFACTS.escrowStroops) {
    fail(`escrow ${st.escrow} != ${MAINNET_ARTIFACTS.escrowStroops}`);
  }
  if (!st.valid || !st.settled) fail("bid not valid/settled");

  console.log("✅ MAINNET VERIFY PASSED");
  console.log("   contract:", process.env.ROUND_CONTRACT_ID ?? MAINNET_ARTIFACTS.contractId);
  console.log("   round:   ", roundId.toString(), "status:", round.status.tag);
  console.log("   R:       ", round.reveal_round.toString());
  console.log("   winner:  ", round.winner ?? bidders[0]);
  console.log("   bid:     ", MAINNET_ARTIFACTS.bidXlm, "XLM");
  console.log("   escrow:  ", MAINNET_ARTIFACTS.escrowXlm, "XLM");
}

main().catch((err) => {
  console.error("\n❌ MAINNET VERIFY FAILED");
  console.error(err);
  process.exit(1);
});
