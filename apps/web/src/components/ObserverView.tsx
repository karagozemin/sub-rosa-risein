import type { DemoTrace } from "../demo/trace";
import { isTraceSettled } from "../demo/trace";
import type { LiveSnapshot } from "../hooks/useLiveRound";
import { shortAddr, usdc } from "../lib/format";

export function ObserverView({
  trace,
  live,
}: {
  trace: DemoTrace;
  live: LiveSnapshot | null;
}) {
  const settled = isTraceSettled(trace);
  const status = live?.round.status.tag ?? trace.meta.roundStatus;
  const winner = live?.round.winner ?? trace.keeper.clearWinner;

  return (
    <section className="panel">
      <header className="panel-head">
        <h2>Observer view</h2>
        <p>Public ledger state — what anyone can see without keys.</p>
      </header>

      <div className="observer-grid">
        <div className="card">
          <h3>Round status</h3>
          <p className="big">{status}</p>
          {winner && (
            <p className="muted">
              Winner: <code>{shortAddr(String(winner), 8)}</code>
            </p>
          )}
        </div>
        <div className="card">
          <h3>Sealed phase</h3>
          <p>
            {settled
              ? "Round complete — bids were sealed until Drand R, then revealed for all."
              : "Commitments H and escrow are public. Ciphertext is on-chain but undecryptable until Drand R."}
          </p>
        </div>
        <div className="card">
          <h3>After reveal</h3>
          <p>Bid values are public. Bidder identities remain auditor-encrypted until opened.</p>
        </div>
      </div>

      <table className="table">
        <thead>
          <tr>
            <th>Bidder</th>
            <th>Escrow</th>
            <th>Revealed bid</th>
            <th>Valid</th>
            <th>Winner</th>
          </tr>
        </thead>
        <tbody>
          {trace.bidders.map((b) => {
            const liveSt = live?.bidStates[b.address];
            const revealed =
              liveSt?.revealed_value != null
                ? Number(liveSt.revealed_value) / 1e7
                : b.bidUsdc;
            return (
              <tr key={b.address}>
                <td>
                  <strong>{b.label}</strong>
                  <br />
                  <code className="tiny">{shortAddr(b.address, 10)}</code>
                </td>
                <td>{usdc(b.escrowUsdc)}</td>
                <td>{revealed != null ? usdc(revealed) : "—"}</td>
                <td>{liveSt ? (liveSt.valid ? "yes" : "no") : b.valid ? "yes" : "no"}</td>
                <td>{b.winner ? "✓" : ""}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
