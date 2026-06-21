import {
  Asset,
  Horizon,
  Networks,
  Operation,
  StrKey,
  TransactionBuilder,
} from "@stellar/stellar-sdk";

export const HORIZON_TESTNET_URL = "https://horizon-testnet.stellar.org";
export const TESTNET_EXPLORER_URL = "https://stellar.expert/explorer/testnet";

const server = new Horizon.Server(HORIZON_TESTNET_URL);

export function isValidRecipient(value: string): boolean {
  return StrKey.isValidEd25519PublicKey(value.trim());
}

export function validateAmount(value: string): string | null {
  const amount = value.trim();

  if (!/^\d+(\.\d{1,7})?$/.test(amount)) {
    return "Enter a positive XLM amount with no more than 7 decimal places.";
  }

  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    return "Amount must be greater than 0 XLM.";
  }

  return null;
}

export async function loadXlmBalance(address: string): Promise<string> {
  const account = await server.loadAccount(address);
  const nativeBalance = account.balances.find(
    (candidate) => candidate.asset_type === "native",
  );

  if (!nativeBalance) {
    throw new Error("No native XLM balance was found for this testnet account.");
  }

  return nativeBalance.balance;
}

type SignedTransaction = {
  signedTxXdr: string;
};

export async function buildAndSubmitPayment({
  sender,
  recipient,
  amount,
  sign,
}: {
  sender: string;
  recipient: string;
  amount: string;
  sign: (xdr: string) => Promise<SignedTransaction>;
}): Promise<string> {
  const [account, baseFee] = await Promise.all([
    server.loadAccount(sender),
    server.fetchBaseFee(),
  ]);

  const transaction = new TransactionBuilder(account, {
    fee: String(baseFee),
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      Operation.payment({
        destination: recipient,
        asset: Asset.native(),
        amount,
      }),
    )
    .setTimeout(120)
    .build();

  const { signedTxXdr } = await sign(transaction.toXDR());
  const signedTransaction = TransactionBuilder.fromXDR(
    signedTxXdr,
    Networks.TESTNET,
  );
  const response = await server.submitTransaction(signedTransaction);

  return response.hash;
}

export function readableError(error: unknown): string {
  if (typeof error === "object" && error !== null && "response" in error) {
    const response = (error as {
      response?: {
        data?: {
          extras?: {
            result_codes?: {
              transaction?: string;
              operations?: string[];
            };
          };
        };
      };
    }).response;
    const codes = response?.data?.extras?.result_codes;

    if (codes?.transaction || codes?.operations?.length) {
      const details = [codes.transaction, ...(codes.operations ?? [])]
        .filter(Boolean)
        .join(", ");
      return `Stellar rejected the transaction (${details}). Check the balance, reserve, recipient, and amount.`;
    }
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "Something went wrong. Please check Freighter and try again.";
}
