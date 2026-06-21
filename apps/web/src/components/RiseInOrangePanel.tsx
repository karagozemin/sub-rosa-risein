import {
  getNetwork,
  isConnected,
  requestAccess,
  signTransaction,
} from "@stellar/freighter-api";
import { Networks } from "@stellar/stellar-sdk";
import { type FormEvent, useCallback, useState } from "react";
import {
  RISEIN_CONTRACT_ID,
  createRiseInRound,
  getRiseInRound,
  isRiseInContractConfigured,
  type RiseInRoundState,
  sha256Commitment,
  submitRiseInCommit,
} from "../lib/risein-contract";
import {
  TESTNET_EXPLORER_URL,
  buildAndSubmitPayment,
  isValidRecipient,
  loadXlmBalance,
  readableError,
  validateAmount,
} from "../lib/risein-stellar";
import { shortAddr } from "../lib/format";

type BusyState = "connecting" | "refreshing" | "sending" | "creating" | "committing" | "syncing" | null;
type Feedback =
  | { kind: "success"; label: string; hash: string }
  | { kind: "error"; label: string; message: string }
  | null;

function freighterMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }
  return "Freighter could not complete the request.";
}

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

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function RiseInOrangePanel() {
  const [address, setAddress] = useState("");
  const [balance, setBalance] = useState<string | null>(null);
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("0.1");
  const [roundId, setRoundId] = useState("1");
  const [title, setTitle] = useState("Rise In builder allocation");
  const [entry, setEntry] = useState("");
  const [round, setRound] = useState<RiseInRoundState | null>(null);
  const [commitmentHex, setCommitmentHex] = useState("");
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [busy, setBusy] = useState<BusyState>(null);
  const configured = isRiseInContractConfigured();
  const readyForContract = Boolean(address) && configured;

  const refreshBalance = useCallback(async (walletAddress: string) => {
    setBusy("refreshing");
    try {
      setBalance(await loadXlmBalance(walletAddress));
    } catch (error) {
      setFeedback({ kind: "error", label: "Balance unavailable", message: readableError(error) });
      setBalance(null);
    } finally {
      setBusy(null);
    }
  }, []);

  async function requireTestnet() {
    const networkResult = await getNetwork();
    if (networkResult.error) {
      throw new Error(freighterMessage(networkResult.error));
    }
    if (
      networkResult.network !== "TESTNET" ||
      networkResult.networkPassphrase !== Networks.TESTNET
    ) {
      throw new Error("Switch Freighter to Stellar Testnet and try again.");
    }
  }

  async function signXdr(xdr: string) {
    await requireTestnet();
    if (!address) {
      throw new Error("Connect Freighter before signing a transaction.");
    }
    const signed = await signTransaction(xdr, {
      networkPassphrase: Networks.TESTNET,
      address,
    });
    if (signed.error) {
      throw new Error(freighterMessage(signed.error));
    }
    if (!signed.signedTxXdr) {
      throw new Error("Freighter did not return a signed transaction.");
    }
    return { signedTxXdr: signed.signedTxXdr };
  }

  async function connectWallet() {
    setBusy("connecting");
    setFeedback(null);

    try {
      const connection = await isConnected();
      if (connection.error) {
        throw new Error(freighterMessage(connection.error));
      }
      if (!connection.isConnected) {
        throw new Error("Freighter is not installed or unlocked.");
      }

      const access = await requestAccess();
      if (access.error) {
        throw new Error(freighterMessage(access.error));
      }
      if (!access.address) {
        throw new Error("Wallet connection was cancelled or no address was returned.");
      }

      await requireTestnet();
      setAddress(access.address);
      setBalance(null);
      await refreshBalance(access.address);
    } catch (error) {
      setFeedback({ kind: "error", label: "Wallet connection failed", message: readableError(error) });
      setBusy(null);
    }
  }

  function disconnectWallet() {
    setAddress("");
    setBalance(null);
    setRecipient("");
    setAmount("0.1");
    setRound(null);
    setCommitmentHex("");
    setFeedback(null);
    setBusy(null);
  }

  async function sendPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback(null);

    const cleanRecipient = recipient.trim();
    const cleanAmount = amount.trim();
    if (!address) {
      setFeedback({ kind: "error", label: "Wallet required", message: "Connect Freighter before sending XLM." });
      return;
    }
    if (!isValidRecipient(cleanRecipient)) {
      setFeedback({ kind: "error", label: "Invalid recipient", message: "Enter a valid Stellar public key beginning with G." });
      return;
    }
    const amountError = validateAmount(cleanAmount);
    if (amountError) {
      setFeedback({ kind: "error", label: "Invalid amount", message: amountError });
      return;
    }

    setBusy("sending");
    try {
      await requireTestnet();
      const hash = await buildAndSubmitPayment({
        sender: address,
        recipient: cleanRecipient,
        amount: cleanAmount,
        sign: signXdr,
      });
      await refreshBalance(address);
      setFeedback({ kind: "success", label: "XLM payment confirmed", hash });
    } catch (error) {
      setFeedback({ kind: "error", label: "Payment failed", message: readableError(error) });
      setBusy(null);
    }
  }

  async function syncState(id = parseRoundId(roundId)) {
    if (!address) throw new Error("Connect Freighter before reading contract state.");
    setBusy("syncing");
    try {
      const nextRound = await getRiseInRound(id, address);
      setRound(nextRound);
      if (!nextRound) {
        setFeedback({ kind: "error", label: "No round found", message: "No Rise In round exists with this ID yet." });
      }
    } finally {
      setBusy(null);
    }
  }

  async function createRound(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback(null);

    try {
      if (!readyForContract) {
        throw new Error(
          configured
            ? "Connect Freighter before creating a Rise In round."
            : "Set VITE_RISEIN_CONTRACT_ID after deploying the Rise In contract to testnet.",
        );
      }
      const id = parseRoundId(roundId);
      const cleanTitle = title.trim();
      if (cleanTitle.length < 3 || cleanTitle.length > 64) {
        throw new Error("Round title must be between 3 and 64 characters.");
      }

      setBusy("creating");
      const hash = await createRiseInRound({
        roundId: id,
        owner: address,
        title: cleanTitle,
        sign: signXdr,
      });
      await syncState(id);
      setFeedback({ kind: "success", label: "Rise In round created", hash });
    } catch (error) {
      setFeedback({ kind: "error", label: "Create round failed", message: readableError(error) });
      setBusy(null);
    }
  }

  async function submitCommit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback(null);

    try {
      if (!readyForContract) {
        throw new Error(
          configured
            ? "Connect Freighter before submitting a commitment."
            : "Set VITE_RISEIN_CONTRACT_ID after deploying the Rise In contract to testnet.",
        );
      }
      const id = parseRoundId(roundId);
      const cleanEntry = entry.trim();
      if (cleanEntry.length < 3) {
        throw new Error("Enter at least 3 characters to create a commitment.");
      }

      setBusy("committing");
      const commitment = await sha256Commitment(cleanEntry);
      const hash = await submitRiseInCommit({
        roundId: id,
        participant: address,
        commitment,
        sign: signXdr,
      });
      setCommitmentHex(hex(commitment));
      setEntry("");
      await syncState(id);
      setFeedback({ kind: "success", label: "Commitment stored", hash });
    } catch (error) {
      setFeedback({ kind: "error", label: "Commit failed", message: readableError(error) });
      setBusy(null);
    }
  }

  const formattedBalance = balance
    ? Number(balance).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 7,
      })
    : "—";

  return (
    <div className="risein-orange">
      <section className="case-hero">
        <div>
          <p className="eyebrow">Rise In Orange Belt</p>
          <h1>Evidence workspace</h1>
          <p className="lede">
            The premium Sub Rosa interface stays intact; this panel restores the White,
            Yellow, and Orange evidence flow for the independent Rise In mini dApp.
          </p>
        </div>
        <div className="round-box">
          <span>contract</span>
          <strong>{configured ? "ready" : "missing"}</strong>
          <small>{configured ? shortAddr(RISEIN_CONTRACT_ID, 6) : "VITE_RISEIN_CONTRACT_ID"}</small>
        </div>
      </section>

      {!configured ? (
        <section className="orange-notice">
          <strong>Deploy configuration pending</strong>
          <p>
            Deploy <code>contracts/rise-in-round</code>, then set{" "}
            <code>VITE_RISEIN_CONTRACT_ID=CA...</code> in <code>apps/web/.env.local</code>.
          </p>
        </section>
      ) : null}

      <section className={`wallet-bar orange-wallet ${address ? "connected" : ""}`}>
        <div>
          <span>Freighter Testnet wallet</span>
          <strong>{address ? shortAddr(address, 6) : "Not connected"}</strong>
          <p>{address ? `Balance: ${formattedBalance} XLM` : "Connect to unlock payment and contract evidence."}</p>
        </div>
        <div className="orange-actions">
          {address ? (
            <button
              type="button"
              className="ghost-action"
              onClick={() => void refreshBalance(address)}
              disabled={busy !== null}
            >
              {busy === "refreshing" ? "Refreshing…" : "Refresh balance"}
            </button>
          ) : null}
          <button
            type="button"
            className="primary-action"
            onClick={address ? disconnectWallet : () => void connectWallet()}
            disabled={busy !== null}
          >
            {busy === "connecting" ? "Connecting…" : address ? "Disconnect" : "Connect Freighter"}
          </button>
        </div>
      </section>

      <div className="orange-grid">
        <form className="orange-card" onSubmit={sendPayment} noValidate>
          <div className="orange-card-head">
            <span>01</span>
            <div>
              <h2>Send testnet XLM</h2>
              <p>White and Yellow Belt evidence: signed testnet payment with a real hash.</p>
            </div>
          </div>
          <label htmlFor="risein-recipient">Recipient public key</label>
          <input
            id="risein-recipient"
            value={recipient}
            onChange={(event) => setRecipient(event.target.value)}
            placeholder="G..."
            autoComplete="off"
            spellCheck={false}
            disabled={!address || busy === "sending"}
          />
          <label htmlFor="risein-amount">Amount</label>
          <div className="orange-inline-input">
            <input
              id="risein-amount"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              inputMode="decimal"
              disabled={!address || busy === "sending"}
            />
            <span>XLM</span>
          </div>
          <button className="primary-action" type="submit" disabled={!address || busy !== null}>
            {busy === "sending" ? "Waiting for approval…" : "Send XLM"}
          </button>
        </form>

        <form className="orange-card" onSubmit={createRound} noValidate>
          <div className="orange-card-head">
            <span>02</span>
            <div>
              <h2>Create Rise In round</h2>
              <p>Calls the educational <code>create_round</code> method.</p>
            </div>
          </div>
          <label htmlFor="risein-round-id-create">Round ID</label>
          <input
            id="risein-round-id-create"
            value={roundId}
            onChange={(event) => setRoundId(event.target.value.replace(/[^0-9]/g, ""))}
            inputMode="numeric"
            disabled={busy !== null}
          />
          <label htmlFor="risein-round-title">Round title</label>
          <input
            id="risein-round-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={64}
            disabled={busy !== null}
          />
          <button className="primary-action" type="submit" disabled={!readyForContract || busy !== null}>
            {busy === "creating" ? "Creating…" : "Create round"}
          </button>
        </form>

        <form className="orange-card" onSubmit={submitCommit} noValidate>
          <div className="orange-card-head">
            <span>03</span>
            <div>
              <h2>Submit commitment</h2>
              <p>Hashes the private entry locally, then stores only 32 bytes on-chain.</p>
            </div>
          </div>
          <label htmlFor="risein-round-id-commit">Round ID</label>
          <input
            id="risein-round-id-commit"
            value={roundId}
            onChange={(event) => setRoundId(event.target.value.replace(/[^0-9]/g, ""))}
            inputMode="numeric"
            disabled={busy !== null}
          />
          <label htmlFor="risein-entry">Private entry</label>
          <input
            id="risein-entry"
            value={entry}
            onChange={(event) => setEntry(event.target.value)}
            placeholder="Allocate 25 points"
            autoComplete="off"
            disabled={busy !== null}
          />
          <button className="primary-action" type="submit" disabled={!readyForContract || busy !== null}>
            {busy === "committing" ? "Committing…" : "Commit hash"}
          </button>
        </form>
      </div>

      <section className="orange-state">
        <div className="orange-card-head">
          <span>04</span>
          <div>
            <h2>Contract state</h2>
            <p>Getter-synchronized round state for screenshot evidence.</p>
          </div>
        </div>
        {round ? (
          <dl>
            <div><dt>Round</dt><dd>#{roundId}</dd></div>
            <div><dt>Title</dt><dd>{round.title}</dd></div>
            <div><dt>Commitments</dt><dd>{round.commitCount}</dd></div>
            <div><dt>Owner</dt><dd title={round.owner}>{shortAddr(round.owner, 6)}</dd></div>
            <div><dt>Created</dt><dd>{new Date(round.createdAt * 1000).toLocaleString()}</dd></div>
          </dl>
        ) : (
          <p className="orange-empty">Create or refresh a Rise In round to display live state.</p>
        )}
        <button
          type="button"
          className="ghost-action"
          onClick={() => void syncState().catch((error) => {
            setFeedback({ kind: "error", label: "Sync failed", message: readableError(error) });
          })}
          disabled={!readyForContract || busy !== null}
        >
          {busy === "syncing" ? "Synchronizing…" : "Refresh state"}
        </button>
      </section>

      {(feedback || commitmentHex) ? (
        <section className={`orange-feedback ${feedback?.kind ?? "success"}`} role={feedback?.kind === "error" ? "alert" : "status"}>
          {feedback ? (
            <>
              <strong>{feedback.label}</strong>
              {feedback.kind === "success" ? (
                <>
                  <code>{feedback.hash}</code>
                  <a href={`${TESTNET_EXPLORER_URL}/tx/${feedback.hash}`} target="_blank" rel="noreferrer">
                    Verify on Stellar Expert
                  </a>
                </>
              ) : (
                <p>{feedback.message}</p>
              )}
            </>
          ) : null}
          {commitmentHex ? (
            <div>
              <span>Latest commitment</span>
              <code>{commitmentHex}</code>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
