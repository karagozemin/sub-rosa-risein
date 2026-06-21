import { Keypair } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { sha256Commitment } from "./contract";
import { isValidRecipient, validateAmount } from "./stellar";

describe("XLM input validation", () => {
  it("accepts a valid Stellar public key", () => {
    expect(isValidRecipient(Keypair.random().publicKey())).toBe(true);
  });

  it("rejects malformed recipients", () => {
    expect(isValidRecipient("not-a-stellar-address")).toBe(false);
  });

  it("accepts positive stroop-precision amounts", () => {
    expect(validateAmount("0.0000001")).toBeNull();
    expect(validateAmount("12.5")).toBeNull();
  });

  it("rejects zero, negatives, and excess precision", () => {
    expect(validateAmount("0")).not.toBeNull();
    expect(validateAmount("-1")).not.toBeNull();
    expect(validateAmount("1.00000001")).not.toBeNull();
  });
});

describe("commitment hashing", () => {
  it("creates a deterministic 32-byte SHA-256 commitment", async () => {
    const first = await sha256Commitment("allocate 25 points");
    const second = await sha256Commitment("allocate 25 points");

    expect(first).toHaveLength(32);
    expect(Array.from(first)).toEqual(Array.from(second));
  });
});
