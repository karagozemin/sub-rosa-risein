// SubRosaClient — a thin, ergonomic, spec-accurate wrapper over the generated
// Round contract bindings. Direct Soroban RPC is the default submission path;
// callers can optionally inject a submitter (for example OZ Relayer Channels)
// without changing contract call encoding. Argument encoding is delegated to the
// contract Spec embedded in the generated bindings, so the bytes on the wire are
// exactly what the contract expects.

import { Keypair } from "@stellar/stellar-sdk";
import { rpc } from "@stellar/stellar-sdk";
import type {
  AssembledTransaction,
  Result,
} from "@stellar/stellar-sdk/contract";
import { basicNodeSigner } from "@stellar/stellar-sdk/contract";
import {
  Client as RoundContract,
  type BidState,
  type ClearingRule,
  type GlobalConfig,
  type Round,
  type Seal,
} from "@sub-rosa/round-bindings";
import type { SealedBid } from "@sub-rosa/tlock";
import type { TransactionSubmitter } from "./submitter.js";

export interface SubRosaClientConfig {
  /** Soroban RPC endpoint, e.g. https://soroban-testnet.stellar.org */
  rpcUrl: string;
  /** Network passphrase the contract is deployed on. */
  networkPassphrase: string;
  /** Deployed Round contract id (C…). */
  contractId: string;
  /**
   * Secret key (S…) of the account that signs and pays for state-changing
   * calls. Required for create_round/commit/open_reveal/reveal/clear/settle/void.
   * Read-only calls (get_*) work without it.
   */
  secretKey?: string;
  /**
   * Public key (G…) used as the source for read-only simulation when no
   * `secretKey` is given. Ignored when `secretKey` is provided.
   */
  publicKey?: string;
  /** Allow http RPC URLs (e.g. a local quickstart node). Default: false. */
  allowHttp?: boolean;
  /** Optional external submitter. Direct Soroban RPC remains the default. */
  submitter?: TransactionSubmitter;
}

export type ClearingRuleTag = ClearingRule["tag"];

export interface CreateRoundParams {
  /** sha256 (or any opaque 32-byte ref) of the off-chain item description. */
  itemRef: Uint8Array;
  /** Drand round R whose signature unseals the bids. */
  revealRound: number | bigint;
  /** Unix seconds; strictly before time(R). */
  commitDeadline: number | bigint;
  /** Unix seconds; after time(R). */
  revealDeadline: number | bigint;
  /** Auditor public key (selective disclosure) bidder identities seal to. */
  auditorPubkey: Uint8Array;
  /** Clearing rule. Default: HighestBid (first-price sealed-bid auction). */
  clearingRule?: ClearingRuleTag;
  /** Operator address. Default: the configured signer's public key. */
  operator?: string;
}

export interface CommitParams {
  roundId: number | bigint;
  /** The off-chain seal produced by @sub-rosa/tlock `sealBid`. */
  sealed: SealedBid;
  /** Public USDC budget locked now; upper bound on the sealed bid. */
  escrow: bigint;
  /** Bidder address. Default: the configured signer's public key. */
  bidder?: string;
}

export interface RevealParams {
  roundId: number | bigint;
  /** The address the bid was committed under. */
  bidder: string;
  /** The plaintext value revealed from the seal. */
  value: bigint;
  /** The 32-byte nonce revealed from the seal. */
  nonce: Uint8Array;
}

const toBigInt = (v: number | bigint): bigint =>
  typeof v === "bigint" ? v : BigInt(v);

const toBuffer = (b: Uint8Array): Buffer => Buffer.from(b);

export class SubRosaClient {
  readonly contract: RoundContract;
  readonly contractId: string;
  readonly networkPassphrase: string;
  readonly #source?: string;
  readonly #rpcUrl: string;
  readonly #allowHttp: boolean;
  readonly #submitter?: TransactionSubmitter;

  constructor(config: SubRosaClientConfig) {
    const keypair = config.secretKey
      ? Keypair.fromSecret(config.secretKey)
      : undefined;
    const source = keypair?.publicKey() ?? config.publicKey;
    const signer = keypair
      ? basicNodeSigner(keypair, config.networkPassphrase)
      : undefined;

    this.contractId = config.contractId;
    this.networkPassphrase = config.networkPassphrase;
    this.#source = source;
    this.#rpcUrl = config.rpcUrl;
    this.#allowHttp = config.allowHttp ?? false;
    this.#submitter = config.submitter;
    this.contract = new RoundContract({
      contractId: config.contractId,
      networkPassphrase: config.networkPassphrase,
      rpcUrl: config.rpcUrl,
      allowHttp: config.allowHttp ?? false,
      ...(source ? { publicKey: source } : {}),
      ...(signer ? { signTransaction: signer.signTransaction } : {}),
    });
  }

  /** The contract Spec embedded in the bindings — the single source of truth
   *  for argument/return encoding. Exposed for offline encoding checks. */
  get spec() {
    return this.contract.spec;
  }

  #requireSource(role: string): string {
    if (!this.#source) {
      throw new Error(
        `a secretKey (or publicKey) is required to use it as the ${role}`,
      );
    }
    return this.#source;
  }

  async #sendUnwrap<T>(tx: AssembledTransaction<Result<T>>): Promise<T> {
    if (!this.#submitter) {
      const sent = await tx.signAndSend();
      return sent.result.unwrap();
    }

    await tx.sign();
    if (!tx.signed) throw new Error("transaction was not signed");
    const submitted = await this.#submitter.submitSignedTransaction({
      signedTransactionXdr: tx.signed.toXDR(),
      contractId: this.contractId,
      networkPassphrase: this.networkPassphrase,
      rpcUrl: this.#rpcUrl,
    });
    const server = new rpc.Server(this.#rpcUrl, { allowHttp: this.#allowHttp });
    const deadline = Date.now() + 60_000;
    let lastStatus = "NOT_FOUND";
    while (Date.now() < deadline) {
      const res = await server.getTransaction(submitted.hash);
      lastStatus = res.status;
      if (res.status === rpc.Api.GetTransactionStatus.SUCCESS) {
        if (!("returnValue" in res) || !res.returnValue) {
          throw new Error(`transaction ${submitted.hash} succeeded without a return value`);
        }
        return tx.options.parseResultXdr(res.returnValue).unwrap();
      }
      if (res.status !== rpc.Api.GetTransactionStatus.NOT_FOUND) {
        throw new Error(`transaction ${submitted.hash} ended with status ${res.status}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 1_500));
    }
    throw new Error(
      `${this.#submitter.name} submitted ${submitted.hash}, but RPC did not finalize it in time (last=${lastStatus})`,
    );
  }

  // ── State-changing calls (sign + submit over RPC) ──────────────────────

  async createRound(params: CreateRoundParams): Promise<bigint> {
    const operator = params.operator ?? this.#requireSource("operator");
    const clearing_rule = {
      tag: params.clearingRule ?? "HighestBid",
      values: undefined,
    } as ClearingRule;
    const tx = await this.contract.create_round({
      operator,
      item_ref: toBuffer(params.itemRef),
      reveal_round: toBigInt(params.revealRound),
      clearing_rule,
      commit_deadline: toBigInt(params.commitDeadline),
      reveal_deadline: toBigInt(params.revealDeadline),
      auditor_pubkey: toBuffer(params.auditorPubkey),
    });
    return this.#sendUnwrap(tx);
  }

  async commit(params: CommitParams): Promise<void> {
    const bidder = params.bidder ?? this.#requireSource("bidder");
    const tx = await this.contract.commit({
      round_id: toBigInt(params.roundId),
      bidder,
      commitment: toBuffer(params.sealed.commitment),
      ciphertext: toBuffer(params.sealed.ciphertext),
      escrow: params.escrow,
      auditor_blob: toBuffer(params.sealed.auditorBlob),
    });
    await this.#sendUnwrap(tx);
  }

  async openReveal(
    roundId: number | bigint,
    drandSignature: Uint8Array,
  ): Promise<void> {
    const tx = await this.contract.open_reveal({
      round_id: toBigInt(roundId),
      drand_signature: toBuffer(drandSignature),
    });
    await this.#sendUnwrap(tx);
  }

  async reveal(params: RevealParams): Promise<void> {
    const tx = await this.contract.reveal({
      round_id: toBigInt(params.roundId),
      bidder: params.bidder,
      value: params.value,
      nonce: toBuffer(params.nonce),
    });
    await this.#sendUnwrap(tx);
  }

  /** Clear a round. Returns the winning address, or undefined if the round was
   *  voided for having no valid bids. */
  async clear(roundId: number | bigint): Promise<string | undefined> {
    const tx = await this.contract.clear({ round_id: toBigInt(roundId) });
    const winner = await this.#sendUnwrap(tx);
    return winner ?? undefined;
  }

  async settle(roundId: number | bigint): Promise<void> {
    const tx = await this.contract.settle({ round_id: toBigInt(roundId) });
    await this.#sendUnwrap(tx);
  }

  async void(roundId: number | bigint): Promise<void> {
    const tx = await this.contract.void({ round_id: toBigInt(roundId) });
    await this.#sendUnwrap(tx);
  }

  // ── Read-only views (simulation only; no signing/submission) ───────────

  async getRound(roundId: number | bigint): Promise<Round> {
    const tx = await this.contract.get_round({ round_id: toBigInt(roundId) });
    return tx.result.unwrap();
  }

  async getBidState(
    roundId: number | bigint,
    bidder: string,
  ): Promise<BidState> {
    const tx = await this.contract.get_bid_state({
      round_id: toBigInt(roundId),
      bidder,
    });
    return tx.result.unwrap();
  }

  /** The deterministic, ordered bidder index — the keeper's reveal set. Reading
   *  this is how the keeper knows exactly which seals to open and reveal. */
  async getBidders(roundId: number | bigint): Promise<string[]> {
    const tx = await this.contract.get_bidders({ round_id: toBigInt(roundId) });
    return tx.result.unwrap();
  }

  /** The sealed payload while it is still in Temporary storage; undefined once
   *  it has expired (the visible "sealed → gone" lifecycle). */
  async getSeal(
    roundId: number | bigint,
    bidder: string,
  ): Promise<Seal | undefined> {
    const tx = await this.contract.get_seal({
      round_id: toBigInt(roundId),
      bidder,
    });
    return tx.result ?? undefined;
  }

  async getConfig(): Promise<GlobalConfig> {
    const tx = await this.contract.get_config();
    return tx.result.unwrap();
  }
}
