import { useEffect, useMemo, useState } from "react";
import { Buffer } from "buffer";
import type { CSSProperties } from "react";
import {
  getAddress,
  getNetworkDetails,
  isConnected,
  requestAccess,
  signAuthEntry,
  signTransaction,
} from "@stellar/freighter-api";
import { RoundContract } from "@sub-rosa/sdk";
import {
  fetchRoundSignature,
  generateAuditorKeypair,
  generateNonce,
  openBid,
  quicknet,
  roundInSeconds,
  sealBid,
} from "@sub-rosa/tlock";
import type { BidState, Round } from "@sub-rosa/sdk";
import { DrandCountdownChip } from "./components/DrandCountdownChip";
import { DEMO_TRACE } from "./demo/trace";
import { formatCountdown, useDrandCountdown } from "./hooks/useDrandCountdown";
import { shortAddr } from "./lib/format";

const LOGO_SRC = "/sub-rosa-logo.png";
const RPC_URL = import.meta.env.VITE_RPC_URL ?? "https://soroban-testnet.stellar.org";
const NETWORK =
  import.meta.env.VITE_NETWORK_PASSPHRASE ?? "Test SDF Network ; September 2015";
const CONTRACT_ID = import.meta.env.VITE_CONTRACT_ID;
const ESCROW_TOKEN_LABEL = import.meta.env.VITE_ESCROW_TOKEN_LABEL ?? "token";
const DEFAULT_ROUND_ID = import.meta.env.VITE_ROUND_ID
  ? BigInt(import.meta.env.VITE_ROUND_ID)
  : null;
const LIVE_REVEAL_IN_SECONDS = 20;
const LIVE_COMMIT_CLOSE_BEFORE_REVEAL_SECONDS = 10;
const LIVE_REVEAL_WINDOW_AFTER_REVEAL_SECONDS = 90;

type Page = "landing" | "app";
type UseCaseId = "dao" | "grants" | "bounty" | "allocation";
type ActionStatus = "idle" | "working" | "ok" | "error";
type FlowStepId = "wallet" | "round" | "commit" | "reveal";

interface UseCase {
  id: UseCaseId;
  nav: string;
  title: string;
  oneLine: string;
  inputLabel: string;
  defaultValue: number;
  traditional: string;
  subrosa: string;
  examples: Array<{ name: string; value: number }>;
}

interface LiveRound {
  round: Round;
  bidders: string[];
  bidStates: Record<string, BidState>;
}

interface CaseSession {
  roundId: bigint | null;
  auditorPublicKey: Uint8Array | null;
  commitValue: bigint | null;
  live: LiveRound | null;
  log: string[];
}

const USE_CASES: UseCase[] = [
  {
    id: "dao",
    nav: "DAO Vote",
    title: "Join a sealed DAO vote as the last voter.",
    oneLine: "Votes stay hidden until Drand R, then anyone can open the full result.",
    inputLabel: "your vote weight",
    defaultValue: 72,
    traditional: "Late voters see momentum and can pile onto the visible winner.",
    subrosa: "Your vote is sealed on-chain; the DAO only sees the final opened set.",
    examples: [
      { name: "Member A", value: 61 },
      { name: "Member B", value: 70 },
      { name: "Member C", value: 66 },
    ],
  },
  {
    id: "grants",
    nav: "Grant Scores",
    title: "Score a grant without leaking the jury board.",
    oneLine: "A final judge cannot be influenced by seeing everyone else's score.",
    inputLabel: "your score",
    defaultValue: 87,
    traditional: "The leaderboard leaks early and scoring becomes political.",
    subrosa: "Every judge commits sealed; the keeper opens all scores together.",
    examples: [
      { name: "Judge A", value: 82 },
      { name: "Judge B", value: 91 },
      { name: "Judge C", value: 76 },
    ],
  },
  {
    id: "bounty",
    nav: "Bounty Track",
    title: "Submit a bounty evaluation without tipping the meta.",
    oneLine: "Hackathon teams cannot infer the winning range before close.",
    inputLabel: "your evaluation",
    defaultValue: 94,
    traditional: "Visible evaluations let teams optimize for leaked judging patterns.",
    subrosa: "Submissions and evaluations stay private until the reveal round.",
    examples: [
      { name: "Reviewer 1", value: 89 },
      { name: "Reviewer 2", value: 92 },
      { name: "Reviewer 3", value: 84 },
    ],
  },
  {
    id: "allocation",
    nav: "Token Allocation",
    title: "Enter an allocation round before demand is visible.",
    oneLine: "Early visibility cannot distort participation or pricing.",
    inputLabel: "your allocation signal",
    defaultValue: 120,
    traditional: "Participants see demand forming and change behavior before close.",
    subrosa: "Demand is sealed until R; clearing uses one public reveal set.",
    examples: [
      { name: "Cohort A", value: 104 },
      { name: "Cohort B", value: 133 },
      { name: "Cohort C", value: 118 },
    ],
  },
];

function routeFromHash(): { page: Page; useCase: UseCaseId } {
  const hash = window.location.hash.replace(/^#\/?/, "");
  if (!hash || hash === "landing") return { page: "landing", useCase: "bounty" };
  const [, maybeCase] = hash.split("/");
  const useCase = USE_CASES.some((item) => item.id === maybeCase)
    ? (maybeCase as UseCaseId)
    : "dao";
  return { page: "app", useCase };
}

function emptySession(roundId: bigint | null = null): CaseSession {
  return {
    roundId,
    auditorPublicKey: null,
    commitValue: null,
    live: null,
    log: [],
  };
}

function initialSessions(): Record<UseCaseId, CaseSession> {
  return {
    dao: emptySession(DEFAULT_ROUND_ID),
    grants: emptySession(),
    bounty: emptySession(),
    allocation: emptySession(),
  };
}

async function sha256Bytes(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

function toDemoEscrowAmount(value: number): bigint {
  // Keep the live test affordable: displayed value 100 => 1.00 token unit.
  return BigInt(Math.max(1, Math.round(value * 100_000)));
}

function formatDemoAmount(value: bigint): string {
  return `${(Number(value) / 10_000_000).toFixed(4)} ${ESCROW_TOKEN_LABEL}`;
}

function freighterError(result: { error?: unknown }) {
  if (!result.error) return null;
  return typeof result.error === "string"
    ? result.error
    : JSON.stringify(result.error);
}

function displayError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("Contract, #10")) {
    return "Commit window closed. Create a fresh live round, then commit before the Drand countdown reaches reveal.";
  }
  if (message.includes("got 425") || message.includes("Error response fetching")) {
    return "Drand R is not published yet. Wait for the countdown to reach live, then open + reveal.";
  }
  if (message.includes("trustline entry is missing")) {
    return "Wallet is missing the escrow asset trustline. Use the XLM demo contract or fund/prepare this testnet wallet.";
  }
  return message;
}

function useWalletContract(address: string | null) {
  return useMemo(() => {
    if (!address || !CONTRACT_ID) return null;
    return new RoundContract({
      contractId: CONTRACT_ID,
      networkPassphrase: NETWORK,
      rpcUrl: RPC_URL,
      publicKey: address,
      signTransaction: async (xdr: string, opts?: { networkPassphrase?: string; address?: string }) => {
        const signed = await signTransaction(xdr, {
          networkPassphrase: opts?.networkPassphrase ?? NETWORK,
          address: opts?.address ?? address,
        });
        const error = freighterError(signed);
        if (error) throw new Error(error);
        return {
          signedTxXdr: signed.signedTxXdr,
          signerAddress: signed.signerAddress,
        };
      },
      signAuthEntry: async (entryXdr: string, opts?: { networkPassphrase?: string; address?: string }) => {
        const signed = await signAuthEntry(entryXdr, {
          networkPassphrase: opts?.networkPassphrase ?? NETWORK,
          address: opts?.address ?? address,
        });
        const error = freighterError(signed);
        if (error) throw new Error(error);
        if (!signed.signedAuthEntry) throw new Error("Freighter returned no signed auth entry");
        return {
          signedAuthEntry: signed.signedAuthEntry,
          signerAddress: signed.signerAddress,
        };
      },
    });
  }, [address]);
}

function Landing({ enterApp }: { enterApp: () => void }) {
  return (
    <main className="landing-page">
      <nav className="landing-nav">
        <button type="button" className="brand-link landing-brand" onClick={enterApp}>
          <img src={LOGO_SRC} alt="" />
          <span>Sub Rosa</span>
        </button>
        <div>
          <a href="https://github.com/karagozemin/Sub-Rosa" target="_blank" rel="noreferrer">
            GitHub
          </a>
          <button type="button" className="primary-action compact" onClick={enterApp}>
            Open app
          </button>
        </div>
      </nav>
      <section className="landing-hero">
        <div className="hero-copy">
          <p className="eyebrow">Confidential coordination on Stellar</p>
          <h1>Sealed rounds. Fair reveals.</h1>
          <p className="lede">
            Sub Rosa turns votes, grant scores, bounty reviews, and allocation signals into
            timed on-chain rounds. Commit now; Drand opens everyone at once.
          </p>
          <div className="hero-actions">
            <button type="button" className="primary-action" onClick={enterApp}>
              Run the live round
            </button>
            <a className="secondary-action" href="https://github.com/karagozemin/Sub-Rosa" target="_blank" rel="noreferrer">
              GitHub
            </a>
          </div>
          <div className="hero-metrics" aria-label="Sub Rosa proof points">
            <div>
              <span>Drand gate</span>
              <strong>R {DEMO_TRACE.meta.revealRound.toLocaleString()}</strong>
            </div>
            <div>
              <span>Public proof</span>
              <strong>on-chain</strong>
            </div>
            <div>
              <span>Trust model</span>
              <strong>no operator reveal</strong>
            </div>
          </div>
        </div>
        <div className="hero-console" aria-label="Sub Rosa round preview">
          <div className="console-top">
            <div>
              <span>round status</span>
              <strong>sealed</strong>
            </div>
            <img src={LOGO_SRC} alt="Sub Rosa" />
          </div>
          <div className="seal-visual">
            <span className="seal-node committed">Commit H</span>
            <span className="seal-node encrypted">Ciphertext</span>
            <span className="seal-node reveal">Drand R</span>
            <div className="seal-track">
              <i />
            </div>
          </div>
          <div className="console-events">
            <p><strong>1</strong> Wallet signs commitment</p>
            <p><strong>2</strong> Escrow lands on Stellar</p>
            <p><strong>3</strong> Reveal opens permissionlessly</p>
          </div>
          <div className="proof-strip">
            <span>{shortAddr(DEMO_TRACE.meta.contractId, 5)}</span>
            <span>{DEMO_TRACE.meta.clearingRule}</span>
            <span>{DEMO_TRACE.keeper.contractBalanceFinal} USDC final</span>
          </div>
        </div>
      </section>

      <section className="landing-cases">
        {USE_CASES.map((item) => (
          <article key={item.id}>
            <span>{item.nav}</span>
            <strong>{item.oneLine}</strong>
          </article>
        ))}
      </section>
    </main>
  );
}

function WalletBar({
  address,
  connect,
  status,
}: {
  address: string | null;
  connect: () => void;
  status: string;
}) {
  return (
    <section className="wallet-bar">
      <div>
        <span>Wallet</span>
        <strong>{address ? shortAddr(address, 6) : "Freighter not connected"}</strong>
        <p>{status}</p>
      </div>
      <button type="button" className="primary-action" onClick={connect}>
        {address ? "Reconnect" : "Connect Freighter"}
      </button>
    </section>
  );
}

function PublicVsSealed({ useCase, committed }: { useCase: UseCase; committed: boolean }) {
  return (
    <div className="comparison-grid">
      <article className="comparison-card leaky">
        <span>traditional</span>
        <h3>Visible before close</h3>
        <p>{useCase.traditional}</p>
        <div className="mini-board">
          {useCase.examples.map((entry) => (
            <div key={entry.name}>
              <span>{entry.name}</span>
              <strong>{entry.value}</strong>
            </div>
          ))}
          <div className="you">
            <span>You arrive last</span>
            <strong>can see all</strong>
          </div>
        </div>
      </article>
      <article className="comparison-card sealed">
        <span>Sub Rosa</span>
        <h3>{committed ? "Sealed on-chain" : "Hidden until Drand R"}</h3>
        <p>{useCase.subrosa}</p>
        <div className="mini-board">
          {useCase.examples.map((entry) => (
            <div key={entry.name}>
              <span>{entry.name}</span>
              <strong>sealed</strong>
            </div>
          ))}
          <div className="you">
            <span>You</span>
            <strong>{committed ? "sealed on-chain" : "ready to seal"}</strong>
          </div>
        </div>
      </article>
    </div>
  );
}

function FlowSteps({
  address,
  roundId,
  committed,
  revealed,
  working,
}: {
  address: string | null;
  roundId: bigint | null;
  committed: boolean;
  revealed: boolean;
  working: boolean;
}) {
  const steps: Array<{ id: FlowStepId; label: string; detail: string; done: boolean }> = [
    { id: "wallet", label: "Wallet", detail: address ? shortAddr(address, 6) : "connect Freighter", done: Boolean(address) },
    { id: "round", label: "Round", detail: roundId == null ? "not created" : `#${roundId}`, done: roundId != null },
    { id: "commit", label: "Seal", detail: committed ? "commitment stored" : "waiting for entry", done: committed },
    { id: "reveal", label: "Reveal", detail: revealed ? "values opened" : "gated by Drand R", done: revealed },
  ];
  const activeIndex = steps.findIndex((step) => !step.done);

  return (
    <section className={`flow-steps ${working ? "working" : ""}`}>
      {steps.map((step, index) => {
        const state = step.done ? "done" : index === activeIndex ? "active" : "idle";
        return (
          <div key={step.id} className={`flow-step ${state}`}>
            <span>{index + 1}</span>
            <strong>{step.label}</strong>
            <small>{step.detail}</small>
          </div>
        );
      })}
    </section>
  );
}

function PhaseGuide({
  address,
  canUseContract,
  roundId,
  committed,
  revealedCount,
  commitSecondsRemaining,
  commitClosed,
  drandGate,
  status,
  connect,
  createRound,
  commitEntry,
  openAndReveal,
}: {
  address: string | null;
  canUseContract: boolean;
  roundId: bigint | null;
  committed: boolean;
  revealedCount: number;
  commitSecondsRemaining: number | null;
  commitClosed: boolean;
  drandGate: ReturnType<typeof useDrandCountdown>;
  status: ActionStatus;
  connect: () => void;
  createRound: () => void;
  commitEntry: () => void;
  openAndReveal: () => void;
}) {
  const working = status === "working";
  const commitSeconds = commitSecondsRemaining ?? 0;
  const commitPercent =
    commitSecondsRemaining == null
      ? 0
      : Math.max(0, Math.min(100, (commitSeconds / LIVE_COMMIT_CLOSE_BEFORE_REVEAL_SECONDS) * 100));

  let tone = "idle";
  let eyebrow = "Next move";
  let title = "Connect the wallet to start.";
  let detail = "The live demo needs a funded Stellar testnet wallet before it can create a timed sealed round.";
  let timerLabel = "ready";
  let timerValue = "wallet";
  let ctaLabel = "Connect Freighter";
  let cta = connect;
  let ctaDisabled = working;

  if (address && !canUseContract) {
    tone = "danger";
    eyebrow = "Config missing";
    title = "Contract is not wired yet.";
    detail = "Set VITE_CONTRACT_ID and restart the web app so the buttons can submit live transactions.";
    timerLabel = "env";
    timerValue = "missing";
    ctaLabel = "Set contract env";
    ctaDisabled = true;
  } else if (address && roundId == null) {
    tone = "ready";
    eyebrow = "Start here";
    title = "Create a live round.";
    detail = "Sub Rosa will open a short commit window, then wait for Drand R before reveal becomes available.";
    timerLabel = "commit window";
    timerValue = "~10s";
    ctaLabel = "Create live round";
    cta = createRound;
  } else if (roundId != null && !committed && !commitClosed) {
    tone = commitSeconds <= 4 ? "danger" : "urgent";
    eyebrow = "Commit window open";
    title = "Seal now before this window closes.";
    detail = "This is the part juries should feel: the clock is live, and the next click writes the sealed commitment on-chain.";
    timerLabel = "time left";
    timerValue = formatCountdown(commitSeconds);
    ctaLabel = `Commit now (${formatCountdown(commitSeconds)})`;
    cta = commitEntry;
  } else if (roundId != null && !committed && commitClosed) {
    tone = "danger";
    eyebrow = "Window missed";
    title = "This round can no longer accept your commit.";
    detail = "Create a fresh round and press Commit during the first 10 seconds. The old round is intentionally closed.";
    timerLabel = "commit";
    timerValue = "closed";
    ctaLabel = "Create fresh round";
    cta = createRound;
  } else if (committed && revealedCount > 0) {
    tone = "complete";
    eyebrow = "Round opened";
    title = "Reveal is complete.";
    detail = "The sealed entry was opened after Drand R, and the public state now shows the revealed values.";
    timerLabel = "revealed";
    timerValue = String(revealedCount);
    ctaLabel = "Revealed";
    ctaDisabled = true;
  } else if (committed && !drandGate.published) {
    tone = "wait";
    eyebrow = "Sealed on-chain";
    title = "Now wait for Drand R.";
    detail = "Your commitment is already stored. When this countdown hits zero, the reveal button becomes the main action.";
    timerLabel = "reveal in";
    timerValue = drandGate.loading ? "syncing" : formatCountdown(drandGate.secondsRemaining);
    ctaLabel = drandGate.loading ? "Syncing Drand" : `Wait ${formatCountdown(drandGate.secondsRemaining)}`;
    cta = openAndReveal;
    ctaDisabled = true;
  } else if (committed && drandGate.published) {
    tone = "ready";
    eyebrow = "Reveal ready";
    title = "Drand R is live. Open the round now.";
    detail = "The cryptographic gate is open; anyone can reveal permissionlessly from this point.";
    timerLabel = "Drand R";
    timerValue = "live";
    ctaLabel = "Open + reveal now";
    cta = openAndReveal;
  }

  if (working) {
    ctaDisabled = true;
    ctaLabel = "Sending...";
  }

  return (
    <section
      className={`phase-guide ${tone} ${working ? "working" : ""}`}
      style={{ "--commit-progress": `${commitPercent}%` } as CSSProperties}
      aria-live="polite"
    >
      <div className="phase-copy">
        <span>{eyebrow}</span>
        <strong>{title}</strong>
        <p>{detail}</p>
      </div>
      <div className="phase-meter">
        <small>{timerLabel}</small>
        <b>{timerValue}</b>
        <i aria-hidden="true" />
      </div>
      <button type="button" className="phase-cta primary-action" onClick={cta} disabled={ctaDisabled}>
        {ctaLabel}
      </button>
    </section>
  );
}

function LiveState({ live, fallbackRound }: { live: LiveRound | null; fallbackRound: number }) {
  const revealed = live
    ? Object.values(live.bidStates).filter((s) => s.revealed_value != null).length
    : DEMO_TRACE.bidders.filter((bidder) => bidder.bidUsdc != null).length;
  const status = live?.round.status.tag ?? "Demo trace";
  const round = live ? Number(live.round.reveal_round) : fallbackRound;
  const bidders = live?.bidders.length ?? DEMO_TRACE.bidders.length;

  return (
    <section className="live-state">
      <div>
        <span>Status</span>
        <strong>{status}</strong>
      </div>
      <div>
        <span>Round R</span>
        <strong>{round.toLocaleString()}</strong>
      </div>
      <div>
        <span>Bidders</span>
        <strong>{bidders}</strong>
      </div>
      <div>
        <span>Revealed</span>
        <strong>{revealed}</strong>
      </div>
    </section>
  );
}

function FeedbackPanel({
  status,
  latest,
  roundId,
  commitValue,
}: {
  status: ActionStatus;
  latest: string | null;
  roundId: bigint | null;
  commitValue: bigint | null;
}) {
  const headline =
    status === "working"
      ? "Sending transaction..."
      : status === "ok"
        ? "Proof updated"
        : status === "error"
          ? "Needs attention"
          : "Ready for the next proof";

  return (
    <section className={`feedback-panel ${status}`}>
      <div className="feedback-burst" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
        <i />
      </div>
      <span>Live feedback</span>
      <strong>{headline}</strong>
      <p>{latest ?? "Awaiting the first signed receipt."}</p>
      <div className="receipt-grid">
        <div>
          <small>round</small>
          <b>{roundId == null ? "pending" : `#${roundId}`}</b>
        </div>
        <div>
          <small>sealed value</small>
          <b>{commitValue == null ? "not sealed" : formatDemoAmount(commitValue)}</b>
        </div>
      </div>
    </section>
  );
}

function AppPage({
  active,
  setActive,
  goHome,
}: {
  active: UseCase;
  setActive: (id: UseCaseId) => void;
  goHome: () => void;
}) {
  const [address, setAddress] = useState<string | null>(null);
  const [walletStatus, setWalletStatus] = useState("Connect a funded Stellar testnet wallet.");
  const [entryValue, setEntryValue] = useState(active.defaultValue);
  const [sessions, setSessions] = useState<Record<UseCaseId, CaseSession>>(initialSessions);
  const [status, setStatus] = useState<ActionStatus>("idle");
  const contract = useWalletContract(address);
  const session = sessions[active.id];
  const { auditorPublicKey, commitValue, live, log, roundId } = session;
  const canUseContract = Boolean(CONTRACT_ID && contract);
  const targetRound = live ? Number(live.round.reveal_round) : DEMO_TRACE.meta.revealRound;
  const drandGate = useDrandCountdown(targetRound);
  const commitSecondsRemaining = live
    ? Math.max(0, Number(live.round.commit_deadline) - Math.floor(Date.now() / 1000))
    : null;
  const commitClosed = commitSecondsRemaining != null && commitSecondsRemaining <= 0;
  const revealedCount = live
    ? Object.values(live.bidStates).filter((state) => state.revealed_value != null).length
    : 0;
  const latestLog = log[0] ?? null;

  useEffect(() => {
    setEntryValue(active.defaultValue);
  }, [active.id, active.defaultValue]);

  function updateSession(id: UseCaseId, patch: Partial<CaseSession>) {
    setSessions((prev) => ({
      ...prev,
      [id]: {
        ...prev[id],
        ...patch,
      },
    }));
  }

  function push(message: string, id = active.id) {
    setSessions((prev) => ({
      ...prev,
      [id]: {
        ...prev[id],
        log: [message, ...prev[id].log].slice(0, 7),
      },
    }));
  }

  async function connect() {
    try {
      const connected = await isConnected();
      if (!connected.isConnected) throw new Error("Freighter extension is not installed or not reachable");
      const access = await requestAccess();
      const error = freighterError(access);
      if (error) throw new Error(error);
      const addr = "address" in access ? access.address : (access as { publicKey?: string }).publicKey;
      if (!addr) {
        const current = await getAddress();
        const currentError = freighterError(current);
        if (currentError) throw new Error(currentError);
        setAddress(current.address);
      } else {
        setAddress(addr);
      }
      const net = await getNetworkDetails();
      setWalletStatus(
        net.networkPassphrase === NETWORK
          ? `Connected on ${net.network}.`
          : `Connected, but switch Freighter to Testnet. Current: ${net.network}.`,
      );
      push("Freighter connected.");
    } catch (error) {
      setWalletStatus(error instanceof Error ? error.message : String(error));
    }
  }

  async function refresh(targetRoundId = roundId, id = active.id) {
    if (!contract || targetRoundId == null) return;
    const round = await contract.get_round({ round_id: targetRoundId });
    const bidders = await contract.get_bidders({ round_id: targetRoundId });
    const bidStates: Record<string, BidState> = {};
    for (const bidder of bidders.result.unwrap()) {
      const state = await contract.get_bid_state({ round_id: targetRoundId, bidder });
      bidStates[bidder] = state.result.unwrap();
    }
    updateSession(id, { live: { round: round.result.unwrap(), bidders: bidders.result.unwrap(), bidStates } });
  }

  async function createRound() {
    if (!CONTRACT_ID) {
      push("Missing VITE_CONTRACT_ID. Restart the dev server after setting apps/web/.env.local.");
      return;
    }
    if (!contract || !address) return;
    const id = active.id;
    setStatus("working");
    try {
      const drand = quicknet();
      const revealRound = await roundInSeconds(drand, LIVE_REVEAL_IN_SECONDS);
      const info = await drand.chain().info();
      const tReveal = Number(info.genesis_time) + Number(info.period) * revealRound;
      const commitDeadline = tReveal - LIVE_COMMIT_CLOSE_BEFORE_REVEAL_SECONDS;
      const revealDeadline = tReveal + LIVE_REVEAL_WINDOW_AFTER_REVEAL_SECONDS;
      const auditor = generateAuditorKeypair();
      const itemRef = await sha256Bytes(`${active.id}:${address}:${Date.now()}`);
      const tx = await contract.create_round({
        operator: address,
        item_ref: Buffer.from(itemRef),
        reveal_round: BigInt(revealRound),
        clearing_rule: { tag: "HighestBid", values: undefined },
        commit_deadline: BigInt(commitDeadline),
        reveal_deadline: BigInt(revealDeadline),
        auditor_pubkey: Buffer.from(auditor.publicKey),
      });
      const sent = await tx.signAndSend();
      const nextRoundId = sent.result.unwrap() as bigint;
      updateSession(id, { roundId: nextRoundId, auditorPublicKey: auditor.publicKey });
      setStatus("ok");
      push(`Created ${active.nav} round #${nextRoundId}. Quick mode: commit in ~10s, reveal opens right after Drand R=${revealRound}.`, id);
      await refresh(nextRoundId, id);
    } catch (error) {
      setStatus("error");
      push(displayError(error), id);
    }
  }

  async function commitEntry() {
    if (!contract || !address || roundId == null) return;
    const id = active.id;
    setStatus("working");
    try {
      const roundTx = await contract.get_round({ round_id: roundId });
      const round = roundTx.result.unwrap();
      const roundAuditorPublicKey = new Uint8Array(round.auditor_pubkey);
      const value = toDemoEscrowAmount(entryValue);
      const drand = quicknet();
      const sealed = await sealBid({
        value,
        nonce: generateNonce(),
        round: Number(round.reveal_round),
        client: drand,
        identity: new TextEncoder().encode(`${active.nav}:${address}`),
        auditorPublicKey: auditorPublicKey ?? roundAuditorPublicKey,
      });
      const tx = await contract.commit({
        round_id: roundId,
        bidder: address,
        commitment: Buffer.from(sealed.commitment),
        ciphertext: Buffer.from(sealed.ciphertext),
        escrow: value,
        auditor_blob: Buffer.from(sealed.auditorBlob),
      });
      await tx.signAndSend();
      updateSession(id, { commitValue: value, auditorPublicKey: auditorPublicKey ?? roundAuditorPublicKey });
      setStatus("ok");
      push(`Committed sealed ${active.inputLabel}: ${entryValue} (${formatDemoAmount(value)} escrow).`, id);
      await refresh(roundId, id);
    } catch (error) {
      setStatus("error");
      push(displayError(error), id);
    }
  }

  async function openAndReveal() {
    if (!contract || roundId == null) return;
    const id = active.id;
    if (live && !drandGate.published) {
      push(`Drand R is still sealed. Wait ${formatCountdown(drandGate.secondsRemaining)}, then open + reveal.`, id);
      return;
    }
    setStatus("working");
    try {
      const drand = quicknet();
      const roundTx = await contract.get_round({ round_id: roundId });
      let round = roundTx.result.unwrap();
      if (round.status.tag === "Open") {
        const signature = await fetchRoundSignature(drand, Number(round.reveal_round));
        const openTx = await contract.open_reveal({
          round_id: roundId,
          drand_signature: Buffer.from(signature),
        });
        await openTx.signAndSend();
        push(`Opened reveal with Drand R=${Number(round.reveal_round).toLocaleString()}.`, id);
        round = (await contract.get_round({ round_id: roundId })).result.unwrap();
      }
      if (round.status.tag !== "Revealing") throw new Error(`Round is ${round.status.tag}, not Revealing.`);
      const bidders = (await contract.get_bidders({ round_id: roundId })).result.unwrap();
      let revealed = 0;
      for (const bidder of bidders) {
        const state = (await contract.get_bid_state({ round_id: roundId, bidder })).result.unwrap();
        if (state.revealed_value != null) continue;
        const seal = (await contract.get_seal({ round_id: roundId, bidder })).result;
        if (!seal) continue;
        const opened = await openBid(new Uint8Array(seal.ciphertext), drand);
        const revealTx = await contract.reveal({
          round_id: roundId,
          bidder,
          value: opened.value,
          nonce: Buffer.from(opened.nonce),
        });
        await revealTx.signAndSend();
        revealed += 1;
      }
      setStatus("ok");
      push(`Revealed ${revealed} sealed entr${revealed === 1 ? "y" : "ies"} permissionlessly.`, id);
      await refresh(roundId, id);
    } catch (error) {
      setStatus("error");
      push(displayError(error), id);
    }
  }

  return (
    <main className="app-page">
      <section className="app-shell">
        <aside className="case-nav">
          <button type="button" className="brand-link" onClick={goHome}>
            <img src={LOGO_SRC} alt="" />
            <span>Sub Rosa</span>
          </button>
          {USE_CASES.map((item) => (
            <button
              key={item.id}
              type="button"
              className={active.id === item.id ? "active" : ""}
              onClick={() => setActive(item.id)}
            >
              {item.nav}
            </button>
          ))}
          <DrandCountdownChip targetRound={targetRound} />
        </aside>

        <section key={active.id} className="case-workspace">
          <div className="case-hero">
            <div>
              <p className="eyebrow">Live round cockpit</p>
              <h1>{active.title}</h1>
              <p className="lede">{active.oneLine}</p>
            </div>
            <div className="round-box">
              <span>active round</span>
              <strong>{roundId == null ? "none" : `#${roundId}`}</strong>
              <small>{CONTRACT_ID ? shortAddr(CONTRACT_ID, 5) : "Set VITE_CONTRACT_ID"}</small>
            </div>
          </div>

          <WalletBar address={address} connect={connect} status={walletStatus} />
          <FlowSteps
            address={address}
            roundId={roundId}
            committed={Boolean(commitValue)}
            revealed={revealedCount > 0}
            working={status === "working"}
          />
          <PhaseGuide
            address={address}
            canUseContract={canUseContract}
            roundId={roundId}
            committed={Boolean(commitValue)}
            revealedCount={revealedCount}
            commitSecondsRemaining={commitSecondsRemaining}
            commitClosed={commitClosed}
            drandGate={drandGate}
            status={status}
            connect={connect}
            createRound={createRound}
            commitEntry={commitEntry}
            openAndReveal={openAndReveal}
          />

          <section className="real-actions">
            <div className="action-input">
              <label htmlFor="entry-value">{active.inputLabel}</label>
              <div className="value-control">
                <input
                  id="entry-range"
                  type="range"
                  min="1"
                  max="150"
                  value={entryValue}
                  onChange={(event) => setEntryValue(Number(event.target.value || active.defaultValue))}
                />
                <input
                  id="entry-value"
                  type="number"
                  min="1"
                  value={entryValue}
                  onChange={(event) => setEntryValue(Number(event.target.value || active.defaultValue))}
                />
              </div>
              <small>Live escrow for this demo: {formatDemoAmount(toDemoEscrowAmount(entryValue))}</small>
              <small>Quick jury mode: after create, commit immediately; reveal opens about 10s later.</small>
            </div>
            <div className="action-buttons">
              <button type="button" className="secondary-action" onClick={createRound} disabled={!address || !canUseContract || status === "working"}>
                1. Create live round
              </button>
              <button type="button" className="primary-action" onClick={commitEntry} disabled={!address || !canUseContract || roundId == null || status === "working" || commitClosed}>
                {commitSecondsRemaining != null && !commitClosed
                  ? `2. Commit now (${formatCountdown(commitSecondsRemaining)})`
                  : "2. Commit sealed entry"}
              </button>
              <button
                type="button"
                className="secondary-action"
                onClick={openAndReveal}
                disabled={!address || !canUseContract || roundId == null || status === "working" || Boolean(live && !drandGate.published)}
              >
                {live && !drandGate.published
                  ? `3. Wait ${formatCountdown(drandGate.secondsRemaining)}`
                  : "3. Open + reveal after R"}
              </button>
              <button type="button" className="ghost-action" onClick={() => refresh()} disabled={!address || !canUseContract || roundId == null}>
                Refresh state
              </button>
            </div>
          </section>

          <div className="proof-layout">
            <PublicVsSealed useCase={active} committed={Boolean(commitValue)} />
            <FeedbackPanel status={status} latest={latestLog} roundId={roundId} commitValue={commitValue} />
          </div>

          <LiveState live={live} fallbackRound={targetRound} />

          <section className={`tx-log ${status}`}>
            <span>transaction log</span>
            {log.length === 0 ? (
              <p>Connect Freighter, create a round, commit your sealed entry, then wait for Drand R.</p>
            ) : (
              log.map((item, index) => <p key={`${item}-${index}`}>{item}</p>)
            )}
          </section>
        </section>
      </section>
    </main>
  );
}

export default function App() {
  const [route, setRoute] = useState(routeFromHash);

  useEffect(() => {
    const onHash = () => setRoute(routeFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const active = USE_CASES.find((item) => item.id === route.useCase) ?? USE_CASES[0];

  function enter(useCase: UseCaseId = route.useCase) {
    window.location.hash = `/app/${useCase}`;
    setRoute({ page: "app", useCase });
  }

  function setActive(id: UseCaseId) {
    window.location.hash = `/app/${id}`;
    setRoute({ page: "app", useCase: id });
  }

  function goHome() {
    window.location.hash = "/landing";
    setRoute({ page: "landing", useCase: route.useCase });
  }

  return route.page === "landing" ? (
    <Landing enterApp={() => enter("dao")} />
  ) : (
    <AppPage active={active} setActive={setActive} goHome={goHome} />
  );
}
