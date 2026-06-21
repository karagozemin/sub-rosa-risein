import {
  Account,
  Address,
  BASE_FEE,
  Contract,
  Networks,
  StrKey,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
} from "@stellar/stellar-sdk";
import { HORIZON_TESTNET_URL } from "./risein-stellar";

export const SOROBAN_TESTNET_RPC_URL = "https://soroban-testnet.stellar.org";
export const RISEIN_CONTRACT_ID = (import.meta.env.VITE_RISEIN_CONTRACT_ID ?? "").trim();

export type RiseInRoundState = {
  commitCount: number;
  createdAt: number;
  owner: string;
  title: string;
};

type SignedTransaction = {
  signedTxXdr: string;
};

type InvokeArgs = {
  source: string;
  sign: (xdr: string) => Promise<SignedTransaction>;
};

const rpcServer = new rpc.Server(SOROBAN_TESTNET_RPC_URL);

export function isRiseInContractConfigured(): boolean {
  return StrKey.isValidContract(RISEIN_CONTRACT_ID);
}

function configuredContract(): Contract {
  if (!isRiseInContractConfigured()) {
    throw new Error(
      "Rise In contract is not configured. Deploy it to testnet and set VITE_RISEIN_CONTRACT_ID in apps/web/.env.local.",
    );
  }
  return new Contract(RISEIN_CONTRACT_ID);
}

async function sourceAccount(address: string) {
  const response = await fetch(`${HORIZON_TESTNET_URL}/accounts/${address}`);
  if (!response.ok) {
    throw new Error("The connected wallet account was not found on Stellar Testnet.");
  }
  const account = (await response.json()) as {
    account_id: string;
    sequence: string;
  };
  return new Account(account.account_id, account.sequence);
}

function invocationTransaction(
  source: Awaited<ReturnType<typeof sourceAccount>>,
  operation: ReturnType<Contract["call"]>,
) {
  return new TransactionBuilder(source, {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(operation)
    .setTimeout(90)
    .build();
}

async function invokeContract(
  operation: ReturnType<Contract["call"]>,
  { source, sign }: InvokeArgs,
): Promise<string> {
  const account = await sourceAccount(source);
  const transaction = invocationTransaction(account, operation);
  const prepared = await rpcServer.prepareTransaction(transaction);
  const { signedTxXdr } = await sign(prepared.toXDR());
  const signed = TransactionBuilder.fromXDR(signedTxXdr, Networks.TESTNET);
  const submitted = await rpcServer.sendTransaction(signed);

  if (submitted.status !== "PENDING" && submitted.status !== "DUPLICATE") {
    throw new Error("Soroban RPC rejected the Rise In contract transaction.");
  }

  for (let attempt = 0; attempt < 30; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    const result = await rpcServer.getTransaction(submitted.hash);

    if (result.status === rpc.Api.GetTransactionStatus.SUCCESS) {
      return submitted.hash;
    }
    if (result.status === rpc.Api.GetTransactionStatus.FAILED) {
      throw new Error("The Rise In contract transaction failed on testnet.");
    }
  }

  throw new Error(
    `Transaction ${submitted.hash} is still pending. Check it in the testnet explorer.`,
  );
}

async function simulateRead(
  source: string,
  operation: ReturnType<Contract["call"]>,
) {
  const account = await sourceAccount(source);
  const transaction = invocationTransaction(account, operation);
  const simulation = await rpcServer.simulateTransaction(transaction);

  if (rpc.Api.isSimulationError(simulation)) {
    throw new Error(`Rise In contract read failed: ${simulation.error}`);
  }
  if (!simulation.result) {
    throw new Error("The Rise In contract returned no state.");
  }

  return scValToNative(simulation.result.retval);
}

export async function createRiseInRound({
  roundId,
  owner,
  title,
  sign,
}: {
  roundId: number;
  owner: string;
  title: string;
  sign: InvokeArgs["sign"];
}): Promise<string> {
  return invokeContract(
    configuredContract().call(
      "create_round",
      nativeToScVal(roundId, { type: "u32" }),
      new Address(owner).toScVal(),
      nativeToScVal(title, { type: "string" }),
    ),
    { source: owner, sign },
  );
}

export async function submitRiseInCommit({
  roundId,
  participant,
  commitment,
  sign,
}: {
  roundId: number;
  participant: string;
  commitment: Uint8Array;
  sign: InvokeArgs["sign"];
}): Promise<string> {
  if (commitment.length !== 32) {
    throw new Error("Commitment must be exactly 32 bytes.");
  }

  return invokeContract(
    configuredContract().call(
      "submit_commit",
      nativeToScVal(roundId, { type: "u32" }),
      new Address(participant).toScVal(),
      nativeToScVal(commitment),
    ),
    { source: participant, sign },
  );
}

export async function getRiseInRound(
  roundId: number,
  source: string,
): Promise<RiseInRoundState | null> {
  const result = await simulateRead(
    source,
    configuredContract().call(
      "get_round",
      nativeToScVal(roundId, { type: "u32" }),
    ),
  );

  if (result === null || result === undefined) return null;

  const value = result as {
    commit_count: number;
    created_at: bigint;
    owner: string;
    title: string;
  };

  return {
    commitCount: value.commit_count,
    createdAt: Number(value.created_at),
    owner: value.owner,
    title: value.title,
  };
}

export async function sha256Commitment(value: string): Promise<Uint8Array> {
  const bytes = new TextEncoder().encode(value);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}
