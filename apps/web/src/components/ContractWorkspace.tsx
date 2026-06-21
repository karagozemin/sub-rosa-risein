import { type FormEvent, useState } from "react";
import {
  CONTRACT_ID,
  createRound,
  getRound,
  isContractConfigured,
  type RoundState,
  sha256Commitment,
  submitCommit,
} from "../lib/contract";
import { readableError, TESTNET_EXPLORER_URL } from "../lib/stellar";

type Props = {
  address: string;
  signXdr: (xdr: string) => Promise<{ signedTxXdr: string }>;
};

type ContractAction = "creating" | "committing" | "syncing" | null;

function parseRoundId(value: string): number {
  if (!/^\d+$/.test(value)) {
    throw new Error("Round ID must be a whole number.");
  }
  const roundId = Number(value);
  if (!Number.isSafeInteger(roundId) || roundId < 0 || roundId > 4_294_967_295) {
    throw new Error("Round ID must be between 0 and 4,294,967,295.");
  }
  return roundId;
}

function short(value: string): string {
  return value.length > 20 ? `${value.slice(0, 10)}…${value.slice(-8)}` : value;
}

export function ContractWorkspace({ address, signXdr }: Props) {
  const [roundId, setRoundId] = useState("1");
  const [title, setTitle] = useState("Rise In builder allocation");
  const [entry, setEntry] = useState("");
  const [round, setRound] = useState<RoundState | null>(null);
  const [action, setAction] = useState<ContractAction>(null);
  const [message, setMessage] = useState("");
  const [transactionHash, setTransactionHash] = useState("");
  const [commitmentHex, setCommitmentHex] = useState("");
  const configured = isContractConfigured();
  const ready = Boolean(address) && configured;

  async function syncState(id = parseRoundId(roundId)) {
    if (!address) throw new Error("Connect Freighter before reading contract state.");
    setAction("syncing");
    setMessage("");
    try {
      const nextRound = await getRound(id, address);
      setRound(nextRound);
      setMessage(
        nextRound
          ? "Round state synchronized from Soroban RPC."
          : "No round exists with this ID yet.",
      );
    } catch (error) {
      setRound(null);
      setMessage(readableError(error));
      throw error;
    } finally {
      setAction(null);
    }
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setTransactionHash("");

    try {
      if (!ready) {
        throw new Error(
          configured
            ? "Connect Freighter before creating a round."
            : "Set VITE_RISEIN_CONTRACT_ID after deploying the contract to testnet.",
        );
      }
      const id = parseRoundId(roundId);
      const cleanTitle = title.trim();
      if (cleanTitle.length < 3 || cleanTitle.length > 64) {
        throw new Error("Round title must be between 3 and 64 characters.");
      }

      setAction("creating");
      const hash = await createRound({
        roundId: id,
        owner: address,
        title: cleanTitle,
        sign: signXdr,
      });
      setTransactionHash(hash);
      await syncState(id);
      setMessage("Round created and synchronized from contract state.");
    } catch (error) {
      setMessage(readableError(error));
      setAction(null);
    }
  }

  async function handleCommit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setTransactionHash("");

    try {
      if (!ready) {
        throw new Error(
          configured
            ? "Connect Freighter before submitting a commitment."
            : "Set VITE_RISEIN_CONTRACT_ID after deploying the contract to testnet.",
        );
      }
      const id = parseRoundId(roundId);
      const cleanEntry = entry.trim();
      if (cleanEntry.length < 3) {
        throw new Error("Enter at least 3 characters to create a commitment.");
      }

      setAction("committing");
      const commitment = await sha256Commitment(cleanEntry);
      const hash = await submitCommit({
        roundId: id,
        participant: address,
        commitment,
        sign: signXdr,
      });

      setCommitmentHex(
        Array.from(commitment, (byte) => byte.toString(16).padStart(2, "0")).join(""),
      );
      setTransactionHash(hash);
      setEntry("");
      await syncState(id);
      setMessage("Commitment stored and round state synchronized.");
    } catch (error) {
      setMessage(readableError(error));
      setAction(null);
    }
  }

  return (
    <section className="contract-section" aria-labelledby="contract-title">
      <div className="section-heading">
        <div>
          <div className="eyebrow"><span>LEVEL 3</span> ORANGE BELT</div>
          <h2 id="contract-title">Sealed allocation mini dApp</h2>
          <p>
            An educational Soroban flow inspired by Sub Rosa—not the production protocol.
            Entries are represented by SHA-256 commitments; only the hash reaches the contract.
          </p>
        </div>
        <div className={configured ? "contract-status configured" : "contract-status"}>
          <span />
          {configured ? short(CONTRACT_ID) : "Contract ID required"}
        </div>
      </div>

      {!configured && (
        <div className="config-notice" role="status">
          <strong>Deployment configuration pending</strong>
          <span>
            Deploy the included contract, then add <code>VITE_RISEIN_CONTRACT_ID=CA…</code> to
            <code> apps/web/.env.local</code>. The frontend will enable automatically.
          </span>
        </div>
      )}

      <div className="contract-grid">
        <article className="panel contract-panel">
          <div className="panel-heading">
            <div><span className="step orange">03</span><h3>Create a round</h3></div>
          </div>
          <form onSubmit={handleCreate} noValidate>
            <label htmlFor="round-id-create">Round ID</label>
            <input
              id="round-id-create"
              value={roundId}
              onChange={(event) => setRoundId(event.target.value)}
              inputMode="numeric"
              disabled={action !== null}
            />
            <label htmlFor="round-title">Round title</label>
            <input
              id="round-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={64}
              disabled={action !== null}
            />
            <button className="button orange-button" type="submit" disabled={!ready || action !== null}>
              {action === "creating" ? <span className="spinner light" /> : <span>＋</span>}
              {action === "creating" ? "Creating round…" : "Create Soroban round"}
            </button>
          </form>
        </article>

        <article className="panel contract-panel">
          <div className="panel-heading">
            <div><span className="step orange">04</span><h3>Submit a commitment</h3></div>
          </div>
          <form onSubmit={handleCommit} noValidate>
            <label htmlFor="round-id-commit">Round ID</label>
            <input
              id="round-id-commit"
              value={roundId}
              onChange={(event) => setRoundId(event.target.value)}
              inputMode="numeric"
              disabled={action !== null}
            />
            <label htmlFor="sealed-entry">Private entry (hashed locally)</label>
            <input
              id="sealed-entry"
              value={entry}
              onChange={(event) => setEntry(event.target.value)}
              placeholder="e.g. Allocate 25 points"
              autoComplete="off"
              disabled={action !== null}
            />
            <button className="button orange-button" type="submit" disabled={!ready || action !== null}>
              {action === "committing" ? <span className="spinner light" /> : <span>◇</span>}
              {action === "committing" ? "Storing commitment…" : "Commit entry hash"}
            </button>
          </form>
        </article>

        <article className="panel contract-panel state-panel">
          <div className="panel-heading">
            <div><span className="step orange">05</span><h3>Contract state</h3></div>
            <span className="safe-label">RPC synced</span>
          </div>
          <div className="state-content">
            {round ? (
              <dl>
                <div><dt>Round</dt><dd>#{roundId}</dd></div>
                <div><dt>Title</dt><dd>{round.title}</dd></div>
                <div><dt>Commitments</dt><dd className="count">{round.commitCount}</dd></div>
                <div><dt>Owner</dt><dd title={round.owner}>{short(round.owner)}</dd></div>
                <div>
                  <dt>Created</dt>
                  <dd>{new Date(round.createdAt * 1000).toLocaleString()}</dd>
                </div>
              </dl>
            ) : (
              <div className="empty-state">
                <span>◎</span>
                <p>Read a deployed round to display live Soroban state.</p>
              </div>
            )}
            <button
              className="button secondary"
              type="button"
              onClick={() => void syncState().catch(() => undefined)}
              disabled={!ready || action !== null}
            >
              {action === "syncing" ? "Synchronizing…" : "Refresh contract state"}
            </button>
          </div>
        </article>
      </div>

      {(message || transactionHash || commitmentHex) && (
        <div className={transactionHash ? "contract-feedback success" : "contract-feedback"} role="status">
          <strong>{transactionHash ? "Contract interaction confirmed" : "Contract status"}</strong>
          {message && <p>{message}</p>}
          {commitmentHex && (
            <div><span>Commitment</span><code>{commitmentHex}</code></div>
          )}
          {transactionHash && (
            <div>
              <span>Transaction hash</span>
              <code>{transactionHash}</code>
              <a href={`${TESTNET_EXPLORER_URL}/tx/${transactionHash}`} target="_blank" rel="noreferrer">
                Verify contract transaction <span>↗</span>
              </a>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
