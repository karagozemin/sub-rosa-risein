import {
  getNetwork,
  isConnected,
  requestAccess,
  signTransaction,
} from "@stellar/freighter-api";
import { Networks } from "@stellar/stellar-sdk";
import { type FormEvent, useCallback, useState } from "react";
import { ContractWorkspace } from "./components/ContractWorkspace";
import {
  buildAndSubmitPayment,
  isValidRecipient,
  loadXlmBalance,
  readableError,
  TESTNET_EXPLORER_URL,
  validateAmount,
} from "./lib/stellar";

type BusyState = "connecting" | "refreshing" | "sending" | null;
type Feedback =
  | { kind: "success"; hash: string }
  | { kind: "error"; message: string }
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

function compactAddress(address: string): string {
  return `${address.slice(0, 8)}…${address.slice(-8)}`;
}

export default function App() {
  const [address, setAddress] = useState("");
  const [balance, setBalance] = useState<string | null>(null);
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("0.1");
  const [busy, setBusy] = useState<BusyState>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const refreshBalance = useCallback(async (walletAddress: string) => {
    setBusy("refreshing");
    try {
      setBalance(await loadXlmBalance(walletAddress));
    } catch (error) {
      setFeedback({ kind: "error", message: readableError(error) });
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
      throw new Error(
        "Freighter is not on Stellar Testnet. Switch the active network to Testnet and try again.",
      );
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
        throw new Error(
          "Freighter was not detected. Install the browser extension, unlock it, and refresh this page.",
        );
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
      setFeedback({ kind: "error", message: readableError(error) });
      setBusy(null);
    }
  }

  function disconnectWallet() {
    setAddress("");
    setBalance(null);
    setRecipient("");
    setAmount("0.1");
    setFeedback(null);
    setBusy(null);
  }

  async function sendPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback(null);

    const cleanRecipient = recipient.trim();
    const cleanAmount = amount.trim();
    if (!address) {
      setFeedback({ kind: "error", message: "Connect Freighter before sending XLM." });
      return;
    }
    if (!isValidRecipient(cleanRecipient)) {
      setFeedback({
        kind: "error",
        message: "Enter a valid Stellar public key beginning with G.",
      });
      return;
    }
    const amountError = validateAmount(cleanAmount);
    if (amountError) {
      setFeedback({ kind: "error", message: amountError });
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
      setFeedback({ kind: "success", hash });
    } catch (error) {
      setFeedback({ kind: "error", message: readableError(error) });
      setBusy(null);
    }
  }

  const connected = Boolean(address);
  const formattedBalance = balance
    ? Number(balance).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 7,
      })
    : "—";

  return (
    <main className="app-shell">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />

      <header className="site-header">
        <a className="brand" href="/" aria-label="Sub Rosa Rise In Sprint home">
          <span className="brand-mark">SR</span>
          <span>SUB ROSA <b>/ RISE IN</b></span>
        </a>
        <div className="network-pill">
          <span className="network-dot" />
          Stellar Testnet only
        </div>
      </header>

      <section className="hero">
        <div className="eyebrow"><span>LEVEL 3</span> ORANGE BELT SPRINT</div>
        <h1>Sub Rosa<br /><em>Rise In Sprint</em></h1>
        <p className="subtitle">A Stellar/Soroban sealed allocation mini dApp</p>
        <p className="intro">
          An independent builder-progress app covering wallet fundamentals, testnet
          payments, and a compact Soroban round-and-commit flow. It is inspired by Sub
          Rosa but is not the production frontend under SCF #44 and CV Labs review.
        </p>
      </section>

      <section className="workspace" aria-label="Stellar testnet workspace">
        <article className="panel wallet-panel">
          <div className="panel-heading">
            <div>
              <span className="step">01</span>
              <h2>Wallet status</h2>
            </div>
            <span className={connected ? "status connected" : "status"}>
              <span />
              {connected ? "Connected" : "Disconnected"}
            </span>
          </div>

          {!connected ? (
            <div className="empty-wallet">
              <div className="wallet-glyph" aria-hidden="true"><span /></div>
              <h3>Connect your testnet wallet</h3>
              <p>Freighter will ask permission to share your public key. No secret key ever leaves your wallet.</p>
              <button className="button primary" onClick={connectWallet} disabled={busy !== null}>
                {busy === "connecting" ? <span className="spinner" /> : <span className="button-icon">↗</span>}
                {busy === "connecting" ? "Connecting…" : "Connect Freighter"}
              </button>
              <a className="text-link" href="https://www.freighter.app/" target="_blank" rel="noreferrer">
                Don't have Freighter? Install it <span>↗</span>
              </a>
            </div>
          ) : (
            <div className="wallet-details">
              <div className="detail-label">Connected public key</div>
              <div className="address-row">
                <code title={address}>{compactAddress(address)}</code>
                <button
                  className="copy-button"
                  onClick={() => void navigator.clipboard.writeText(address)}
                  aria-label="Copy public key"
                >
                  Copy
                </button>
              </div>
              <div className="balance-card">
                <span>Available testnet balance</span>
                <strong>{busy === "refreshing" && balance === null ? "Loading…" : formattedBalance}</strong>
                <small>XLM</small>
              </div>
              <div className="wallet-actions">
                <button
                  className="button secondary"
                  onClick={() => void refreshBalance(address)}
                  disabled={busy !== null}
                >
                  {busy === "refreshing" ? "Refreshing…" : "Refresh balance"}
                </button>
                <button className="button ghost" onClick={disconnectWallet} disabled={busy === "sending"}>
                  Disconnect
                </button>
              </div>
            </div>
          )}
        </article>

        <article className="panel payment-panel">
          <div className="panel-heading">
            <div>
              <span className="step">02</span>
              <h2>Send testnet XLM</h2>
            </div>
            <span className="safe-label">No real funds</span>
          </div>

          <form onSubmit={sendPayment} noValidate>
            <label htmlFor="recipient">Recipient public key</label>
            <input
              id="recipient"
              name="recipient"
              value={recipient}
              onChange={(event) => setRecipient(event.target.value)}
              placeholder="G…"
              autoComplete="off"
              spellCheck={false}
              disabled={!connected || busy === "sending"}
            />

            <label htmlFor="amount">Amount</label>
            <div className="amount-input">
              <input
                id="amount"
                name="amount"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                inputMode="decimal"
                placeholder="0.1"
                disabled={!connected || busy === "sending"}
              />
              <span>XLM</span>
            </div>

            <div className="transaction-note">
              <span>i</span>
              Freighter will show the final transaction for your approval before anything is sent.
            </div>

            <button className="button primary send-button" type="submit" disabled={!connected || busy !== null}>
              {busy === "sending" ? <span className="spinner" /> : <span className="button-icon">→</span>}
              {busy === "sending" ? "Waiting for approval…" : "Send testnet XLM"}
            </button>
          </form>
        </article>
      </section>

      {feedback && (
        <section className={`feedback ${feedback.kind}`} role={feedback.kind === "error" ? "alert" : "status"}>
          <div className="feedback-icon">{feedback.kind === "success" ? "✓" : "!"}</div>
          <div>
            <strong>{feedback.kind === "success" ? "Transaction confirmed on testnet" : "Transaction not completed"}</strong>
            {feedback.kind === "success" ? (
              <>
                <p>Your payment was accepted by Stellar Horizon.</p>
                <code>{feedback.hash}</code>
                <a href={`${TESTNET_EXPLORER_URL}/tx/${feedback.hash}`} target="_blank" rel="noreferrer">
                  View transaction on Stellar Expert <span>↗</span>
                </a>
              </>
            ) : (
              <p>{feedback.message}</p>
            )}
          </div>
        </section>
      )}

      <ContractWorkspace
        key={address || "disconnected"}
        address={address}
        signXdr={signXdr}
      />

      <footer>
        <div><span className="footer-mark">SR</span> Independent builder-progress repository</div>
        <div className="footer-checks"><span>✓ Testnet</span><span>✓ Freighter</span><span>✓ Soroban RPC</span></div>
      </footer>
    </main>
  );
}
