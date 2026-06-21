import { USDC_TESTNET_ADDRESS } from "@x402/stellar";
import type { Network } from "@x402/core/types";

export interface AppraisalServerConfig {
  /** Facilitator secret key (S...). XLM-funded; sponsors the fee and submits settlement. */
  facilitatorSecret: string;
  /** Resource-server address (G...) that receives the USDC payment. Needs a USDC trustline. */
  payTo: string;
  /** SEP-41 token contract (C...) used for payment. Defaults to canonical testnet USDC. */
  asset: string;
  /** Price per call, decimal units of the asset (e.g. 0.10). */
  price: number;
  /** CAIP-2 network id. */
  network: Network;
  /** Optional custom Soroban RPC URL. */
  rpcUrl?: string;
  /** HTTP port. */
  port: number;
}

const reqEnv = (n: string): string => {
  const v = process.env[n];
  if (!v) throw new Error(`missing required env var ${n}`);
  return v;
};

export function configFromEnv(): AppraisalServerConfig {
  return {
    facilitatorSecret: reqEnv("FACILITATOR_SECRET"),
    payTo: reqEnv("PAY_TO"),
    asset: process.env.PAYMENT_ASSET ?? USDC_TESTNET_ADDRESS,
    price: Number(process.env.PRICE ?? "0.10"),
    network: (process.env.X402_NETWORK ?? "stellar:testnet") as Network,
    rpcUrl: process.env.RPC_URL,
    port: Number(process.env.PORT ?? "4021"),
  };
}
