#![cfg(test)]

use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token, Address, Bytes, BytesN, Env,
};

use crate::drand;
use crate::types::{ClearingRule, GlobalConfig, Status};
use crate::{SubRosaRound, SubRosaRoundClient};

// Test timing uses genesis=0, period=1 so time(R) == R, keeping the deadline
// arithmetic obvious. The real quicknet constants are validated separately at
// deploy time (these values only feed the timing math, not BLS verification).
const GENESIS: u64 = 0;
const PERIOD: u64 = 1;

struct Fixture {
    env: Env,
    client: SubRosaRoundClient<'static>,
    usdc_admin: token::StellarAssetClient<'static>,
    usdc_token: token::Client<'static>,
}

fn setup() -> Fixture {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.timestamp = 1_000);

    let issuer = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(issuer);
    let usdc = sac.address();

    let drand_pubkey = BytesN::from_array(&env, &[0u8; 192]);
    let g2_neg_generator = BytesN::from_array(&env, &[0u8; 192]);
    let dst = Bytes::from_array(&env, b"BLS_SIG_BLS12381G1_XMD:SHA-256_SSWU_RO_NUL_");

    let contract_id = env.register(
        SubRosaRound,
        (
            drand_pubkey,
            g2_neg_generator,
            dst,
            GENESIS,
            PERIOD,
            usdc.clone(),
        ),
    );
    let client = SubRosaRoundClient::new(&env, &contract_id);

    Fixture {
        env: env.clone(),
        client,
        usdc_admin: token::StellarAssetClient::new(&env, &usdc),
        usdc_token: token::Client::new(&env, &usdc),
    }
}

fn funded_bidder(f: &Fixture, amount: i128) -> Address {
    let bidder = Address::generate(&f.env);
    f.usdc_admin.mint(&bidder, &amount);
    bidder
}

fn b32(env: &Env, byte: u8) -> BytesN<32> {
    BytesN::from_array(env, &[byte; 32])
}

fn open_round(f: &Fixture, operator: &Address) -> u64 {
    f.client.create_round(
        operator,
        &b32(&f.env, 1),
        &2_000,                       // reveal_round R -> time(R) == 2000
        &ClearingRule::HighestBid,
        &1_500,                       // commit_deadline (now=1000 < 1500 < 2000)
        &2_500,                       // reveal_deadline (> 2000)
        &Bytes::from_array(&f.env, b"auditor-pubkey"),
    )
}

#[test]
fn create_round_happy_path() {
    let f = setup();
    let operator = Address::generate(&f.env);
    let id = open_round(&f, &operator);
    assert_eq!(id, 1);
    let round = f.client.get_round(&id);
    assert_eq!(round.operator, operator);
    assert_eq!(round.reveal_round, 2_000);
    assert_eq!(round.bidders.len(), 0);
}

#[test]
fn create_round_rejects_commit_after_reveal() {
    let f = setup();
    let operator = Address::generate(&f.env);
    // commit_deadline >= time(R) must be rejected.
    let res = f.client.try_create_round(
        &operator,
        &b32(&f.env, 1),
        &2_000,
        &ClearingRule::HighestBid,
        &2_000, // == time(R) -> invalid
        &2_500,
        &Bytes::from_array(&f.env, b"a"),
    );
    assert!(res.is_err());
}

#[test]
fn create_round_rejects_deadline_in_past() {
    let f = setup();
    let operator = Address::generate(&f.env);
    let res = f.client.try_create_round(
        &operator,
        &b32(&f.env, 1),
        &2_000,
        &ClearingRule::HighestBid,
        &500, // <= now (1000)
        &2_500,
        &Bytes::from_array(&f.env, b"a"),
    );
    assert!(res.is_err());
}

#[test]
fn commit_locks_escrow() {
    let f = setup();
    let operator = Address::generate(&f.env);
    let id = open_round(&f, &operator);

    let bidder = funded_bidder(&f, 1_000);
    f.client.commit(
        &id,
        &bidder,
        &b32(&f.env, 7),
        &Bytes::from_array(&f.env, b"ciphertext"),
        &600,
        &Bytes::from_array(&f.env, b"id-blob"),
    );

    assert_eq!(f.usdc_token.balance(&bidder), 400);
    assert_eq!(f.usdc_token.balance(&f.client.address), 600);

    let round = f.client.get_round(&id);
    assert_eq!(round.bidders.len(), 1);
    let state = f.client.get_bid_state(&id, &bidder);
    assert_eq!(state.escrow, 600);
    assert_eq!(state.valid, false);
}

#[test]
fn get_bidders_returns_ordered_index() {
    let f = setup();
    let operator = Address::generate(&f.env);
    let id = open_round(&f, &operator);

    let a = funded_bidder(&f, 1_000);
    let b = funded_bidder(&f, 1_000);
    f.client.commit(
        &id,
        &a,
        &b32(&f.env, 1),
        &Bytes::from_array(&f.env, b"c"),
        &100,
        &Bytes::from_array(&f.env, b"id"),
    );
    f.client.commit(
        &id,
        &b,
        &b32(&f.env, 2),
        &Bytes::from_array(&f.env, b"c"),
        &200,
        &Bytes::from_array(&f.env, b"id"),
    );
    // Overwriting an existing bidder must not duplicate the index entry.
    f.client.commit(
        &id,
        &a,
        &b32(&f.env, 3),
        &Bytes::from_array(&f.env, b"c"),
        &150,
        &Bytes::from_array(&f.env, b"id"),
    );

    let bidders = f.client.get_bidders(&id);
    assert_eq!(bidders.len(), 2);
    assert_eq!(bidders.get(0).unwrap(), a);
    assert_eq!(bidders.get(1).unwrap(), b);
}

#[test]
fn commit_overwrite_before_close_refunds_prior_escrow() {
    let f = setup();
    let operator = Address::generate(&f.env);
    let id = open_round(&f, &operator);

    let bidder = funded_bidder(&f, 1_000);
    f.client.commit(
        &id,
        &bidder,
        &b32(&f.env, 7),
        &Bytes::from_array(&f.env, b"c1"),
        &600,
        &Bytes::from_array(&f.env, b"id"),
    );
    // Overwrite with a smaller escrow; prior 600 refunded, new 200 locked.
    f.client.commit(
        &id,
        &bidder,
        &b32(&f.env, 9),
        &Bytes::from_array(&f.env, b"c2"),
        &200,
        &Bytes::from_array(&f.env, b"id"),
    );

    assert_eq!(f.usdc_token.balance(&bidder), 800);
    assert_eq!(f.usdc_token.balance(&f.client.address), 200);
    // Still a single effective bidder.
    let round = f.client.get_round(&id);
    assert_eq!(round.bidders.len(), 1);
}

#[test]
fn commit_after_deadline_rejected() {
    let f = setup();
    let operator = Address::generate(&f.env);
    let id = open_round(&f, &operator);
    let bidder = funded_bidder(&f, 1_000);

    f.env.ledger().with_mut(|l| l.timestamp = 1_600); // past commit_deadline 1500

    let res = f.client.try_commit(
        &id,
        &bidder,
        &b32(&f.env, 7),
        &Bytes::from_array(&f.env, b"c"),
        &600,
        &Bytes::from_array(&f.env, b"id"),
    );
    assert!(res.is_err());
}

#[test]
fn commit_zero_escrow_rejected() {
    let f = setup();
    let operator = Address::generate(&f.env);
    let id = open_round(&f, &operator);
    let bidder = funded_bidder(&f, 1_000);

    let res = f.client.try_commit(
        &id,
        &bidder,
        &b32(&f.env, 7),
        &Bytes::from_array(&f.env, b"c"),
        &0,
        &Bytes::from_array(&f.env, b"id"),
    );
    assert!(res.is_err());
}

#[test]
fn void_after_grace_refunds_all() {
    let f = setup();
    let operator = Address::generate(&f.env);
    let id = open_round(&f, &operator);

    let a = funded_bidder(&f, 1_000);
    let bbidder = funded_bidder(&f, 1_000);
    f.client.commit(
        &id,
        &a,
        &b32(&f.env, 1),
        &Bytes::from_array(&f.env, b"c"),
        &300,
        &Bytes::from_array(&f.env, b"id"),
    );
    f.client.commit(
        &id,
        &bbidder,
        &b32(&f.env, 2),
        &Bytes::from_array(&f.env, b"c"),
        &500,
        &Bytes::from_array(&f.env, b"id"),
    );

    // Reveal never opened (Drand stall). Advance past reveal_deadline + grace.
    f.env
        .ledger()
        .with_mut(|l| l.timestamp = 2_500 + 3_600 + 1);
    f.client.void(&id);

    assert_eq!(f.usdc_token.balance(&a), 1_000);
    assert_eq!(f.usdc_token.balance(&bbidder), 1_000);
    let round = f.client.get_round(&id);
    assert_eq!(round.bidders.len(), 2);
}

// ---- Real on-chain BLS verification against a frozen live quicknet vector ----
//
// Round 29155653 of Drand quicknet, captured from the public API via
// services/drand-tools (off-chain verified true). This exercises the exact path
// the contract uses in production: sha256(be8(R)) -> hash_to_g1(DST) -> pairing
// check, run through Soroban's native BLS12-381 host functions in the test Env.
// This is the risk-2 kill: no testnet deploy required to prove the seal unlocks.

const VEC_ROUND: u64 = 29_155_653;
const VEC_SIG_G1: &str = "0f74ee9ea1bc8ab52cc375ec82e70b6fed483a2618e90eeaef5631555733554f8bb3ec7c8563341af525d09b3702cae7181d281dbcb68e4779e93184eea8f879301f980708c26e488b5417f9c257b6b9cee7f9a2d6981fb65b7bcd6bcc15d3ac";
// Soroban serializes Fp2 as (c1, c0) — the (c0, c1) ordering is rejected by the
// host as "point not on curve". These are the confirmed deploy constants.
const VEC_PUBKEY_C1C0: &str = "03cf0f2896adee7eb8b5f01fcad3912212c437e0073e911fb90022d3e760183c8c4b450b6a0a6c3ac6a5776a2d1064510d1fec758c921cc22b0e17e63aaf4bcb5ed66304de9cf809bd274ca73bab4af5a6e9c76a4bc09e76eae8991ef5ece45a01a714f2edb74119a2f2b0d5a7c75ba902d163700a61bc224ededd8e63aef7be1aaf8e93d7a9718b047ccddb3eb5d68b0e5db2b6bfbb01c867749cadffca88b36c24f3012ba09fc4d3022c5c37dce0f977d3adb5d183c7477c442b1f04515273";
const VEC_NEGGEN_C1C0: &str = "13e02b6052719f607dacd3a088274f65596bd0d09920b61ab5da61bbdc7f5049334cf11213945d57e5ac7d055d042b7e024aa2b2f08f0a91260805272dc51051c6e47ad4fa403b02b4510b647ae3d1770bac0326a805bbefd48056c8c121bdb813fa4d4a0ad8b1ce186ed5061789213d993923066dddaf1040bc3ff59f825c78df74f2d75467e25e0f55f8a00fa030ed0d1b3cc2c7027888be51d9ef691d77bcb679afda66c73f17f9ee3837a55024f78c71363275a75d75d86bab79f74782aa";
const VEC_DST: &[u8] = b"BLS_SIG_BLS12381G1_XMD:SHA-256_SSWU_RO_NUL_";
const VEC_GENESIS: u64 = 1_692_803_367;
const VEC_PERIOD: u64 = 3;

fn hexval(c: u8) -> u8 {
    match c {
        b'0'..=b'9' => c - b'0',
        b'a'..=b'f' => c - b'a' + 10,
        b'A'..=b'F' => c - b'A' + 10,
        _ => panic!("bad hex"),
    }
}

fn hexn<const N: usize>(env: &Env, s: &str) -> BytesN<N> {
    let raw = s.as_bytes();
    assert_eq!(raw.len(), N * 2, "hex length mismatch");
    let mut out = [0u8; N];
    let mut i = 0;
    while i < N {
        out[i] = (hexval(raw[i * 2]) << 4) | hexval(raw[i * 2 + 1]);
        i += 1;
    }
    BytesN::from_array(env, &out)
}

fn config_with(env: &Env, pubkey: &str, neg_gen: &str) -> GlobalConfig {
    GlobalConfig {
        drand_pubkey: hexn::<192>(env, pubkey),
        g2_neg_generator: hexn::<192>(env, neg_gen),
        dst: Bytes::from_slice(env, VEC_DST),
        drand_genesis: 1_692_803_367,
        drand_period: 3,
        usdc: Address::generate(env),
    }
}

// Soroban serializes Fp2 as (c1, c0) — confirmed empirically: the (c0, c1)
// ordering is rejected by the host as "point not on curve".
#[test]
fn drand_bls_verify_real_vector() {
    let env = Env::default();
    let sig = hexn::<96>(&env, VEC_SIG_G1);
    let cfg = config_with(&env, VEC_PUBKEY_C1C0, VEC_NEGGEN_C1C0);
    assert!(
        drand::verify_round(&env, &cfg, VEC_ROUND, &sig),
        "c1c0-ordered constants must verify the live quicknet signature on-chain"
    );
}

#[test]
fn drand_bls_verify_rejects_wrong_round() {
    let env = Env::default();
    let sig = hexn::<96>(&env, VEC_SIG_G1);
    let cfg = config_with(&env, VEC_PUBKEY_C1C0, VEC_NEGGEN_C1C0);
    // A valid signature for round R must not verify against a different round.
    assert!(!drand::verify_round(&env, &cfg, VEC_ROUND + 1, &sig));
}

fn setup_real_drand() -> Fixture {
    let env = Env::default();
    env.mock_all_auths();
    let issuer = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(issuer);
    let usdc = sac.address();
    let contract_id = env.register(
        SubRosaRound,
        (
            hexn::<192>(&env, VEC_PUBKEY_C1C0),
            hexn::<192>(&env, VEC_NEGGEN_C1C0),
            Bytes::from_slice(&env, VEC_DST),
            VEC_GENESIS,
            VEC_PERIOD,
            usdc.clone(),
        ),
    );
    let client = SubRosaRoundClient::new(&env, &contract_id);
    Fixture {
        env: env.clone(),
        client,
        usdc_admin: token::StellarAssetClient::new(&env, &usdc),
        usdc_token: token::Client::new(&env, &usdc),
    }
}

fn commitment(env: &Env, value: i128, nonce: &BytesN<32>) -> BytesN<32> {
    let mut pre = Bytes::new(env);
    pre.extend_from_array(&value.to_be_bytes());
    pre.extend_from_array(&nonce.to_array());
    env.crypto().sha256(&pre).to_bytes()
}

/// Full sealed round driven by the real quicknet round-R signature: the reveal
/// only opens because the on-chain BLS check passes. End-to-end, no mock.
#[test]
fn full_lifecycle_real_drand_signature() {
    let f = setup_real_drand();
    let t_reveal = VEC_GENESIS + VEC_PERIOD * VEC_ROUND;
    let commit_deadline = t_reveal - 10;
    let reveal_deadline = t_reveal + 100;
    f.env.ledger().with_mut(|l| l.timestamp = t_reveal - 100);

    let operator = Address::generate(&f.env);
    let id = f.client.create_round(
        &operator,
        &b32(&f.env, 0xAB),
        &VEC_ROUND,
        &ClearingRule::HighestBid,
        &commit_deadline,
        &reveal_deadline,
        &Bytes::from_array(&f.env, b"auditor"),
    );

    let alice = funded_bidder(&f, 1_000);
    let bob = funded_bidder(&f, 1_000);
    let a_nonce = b32(&f.env, 0x11);
    let b_nonce = b32(&f.env, 0x22);
    let a_value: i128 = 700;
    let b_value: i128 = 500;

    // Sealed bids: ciphertext is opaque on-chain; only the commitment is checked.
    f.client.commit(
        &id,
        &alice,
        &commitment(&f.env, a_value, &a_nonce),
        &Bytes::from_array(&f.env, b"sealedA"),
        &1_000,
        &Bytes::from_array(&f.env, b"idA"),
    );
    f.client.commit(
        &id,
        &bob,
        &commitment(&f.env, b_value, &b_nonce),
        &Bytes::from_array(&f.env, b"sealedB"),
        &1_000,
        &Bytes::from_array(&f.env, b"idB"),
    );

    // Commit window closes; round R is published. Opening the reveal requires the
    // real quicknet signature to verify on-chain.
    f.env.ledger().with_mut(|l| l.timestamp = t_reveal + 1);
    let sig = hexn::<96>(&f.env, VEC_SIG_G1);
    f.client.open_reveal(&id, &sig);
    assert_eq!(f.client.get_round(&id).status, Status::Revealing);

    // Anti-grief: a wrong nonce is rejected and does not lock the bidder out.
    assert!(f
        .client
        .try_reveal(&id, &alice, &a_value, &b32(&f.env, 0x99))
        .is_err());
    f.client.reveal(&id, &alice, &a_value, &a_nonce);
    f.client.reveal(&id, &bob, &b_value, &b_nonce);

    // Clear after the reveal deadline -> Alice (700) beats Bob (500).
    f.env.ledger().with_mut(|l| l.timestamp = reveal_deadline + 1);
    assert_eq!(f.client.clear(&id), Some(alice.clone()));
    assert_eq!(f.client.get_round(&id).winning_bid, 700);

    // Settle: operator paid 700; Alice refunded surplus 300; Bob refunded 1000.
    f.client.settle(&id);
    assert_eq!(f.usdc_token.balance(&operator), 700);
    assert_eq!(f.usdc_token.balance(&alice), 300);
    assert_eq!(f.usdc_token.balance(&bob), 1_000);
    assert_eq!(f.usdc_token.balance(&f.client.address), 0);
    assert_eq!(f.client.get_round(&id).status, Status::Settled);
}

/// Cross-language parity: the contract's commitment for a frozen (value, nonce)
/// must equal the H computed off-chain by packages/tlock (commitment.test.ts).
/// This proves on-chain sha256(value‖nonce) and the TS encoder agree byte-for-
/// byte, so any bid sealed off-chain reveals correctly on-chain.
#[test]
fn commitment_matches_offchain_vector() {
    let env = Env::default();
    let h = commitment(&env, 700, &b32(&env, 0x11));
    let expected = hexn::<32>(
        &env,
        "3d4c2d3604b23250687f0344a9474e3c748742a4fba4616d308d529121a8dec4",
    );
    assert_eq!(h, expected);
}

#[test]
fn void_before_grace_rejected() {
    let f = setup();
    let operator = Address::generate(&f.env);
    let id = open_round(&f, &operator);
    f.env.ledger().with_mut(|l| l.timestamp = 2_600); // past reveal_deadline, before grace
    let res = f.client.try_void(&id);
    assert!(res.is_err());
}
