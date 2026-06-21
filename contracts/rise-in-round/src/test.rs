extern crate std;

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Address, BytesN, Env, String,
};

fn setup() -> (Env, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|ledger| {
        ledger.timestamp = 1_745_000_000;
    });

    let contract_id = env.register(RiseInRoundContract, ());
    let owner = Address::generate(&env);
    (env, contract_id, owner)
}

#[test]
fn creates_and_reads_a_round() {
    let (env, contract_id, owner) = setup();
    let client = RiseInRoundContractClient::new(&env, &contract_id);
    let title = String::from_str(&env, "Community micro-grants");

    let created = client.create_round(&7, &owner, &title);
    let stored = client.get_round(&7).unwrap();

    assert_eq!(created, stored);
    assert_eq!(stored.owner, owner);
    assert_eq!(stored.commit_count, 0);
    assert_eq!(stored.created_at, 1_745_000_000);
}

#[test]
fn stores_a_commit_and_updates_round_state() {
    let (env, contract_id, owner) = setup();
    let client = RiseInRoundContractClient::new(&env, &contract_id);
    client.create_round(&11, &owner, &String::from_str(&env, "Builder allocation"));

    let commitment = BytesN::from_array(&env, &[9; 32]);
    let count = client.submit_commit(&11, &owner, &commitment);

    assert_eq!(count, 1);
    assert_eq!(client.get_commit(&11, &owner), Some(commitment));
    assert_eq!(client.get_round(&11).unwrap().commit_count, 1);
}

#[test]
#[should_panic(expected = "Error(Contract, #1)")]
fn rejects_duplicate_round_ids() {
    let (env, contract_id, owner) = setup();
    let client = RiseInRoundContractClient::new(&env, &contract_id);
    let title = String::from_str(&env, "First round");

    client.create_round(&3, &owner, &title);
    client.create_round(&3, &owner, &title);
}

#[test]
#[should_panic(expected = "Error(Contract, #3)")]
fn rejects_a_second_commit_from_the_same_participant() {
    let (env, contract_id, owner) = setup();
    let client = RiseInRoundContractClient::new(&env, &contract_id);
    client.create_round(&4, &owner, &String::from_str(&env, "One entry each"));

    client.submit_commit(&4, &owner, &BytesN::from_array(&env, &[1; 32]));
    client.submit_commit(&4, &owner, &BytesN::from_array(&env, &[2; 32]));
}
