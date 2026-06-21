#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, symbol_short, Address,
    BytesN, Env, String,
};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RoundState {
    pub commit_count: u32,
    pub created_at: u64,
    pub owner: Address,
    pub title: String,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Round(u32),
    Commit(u32, Address),
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum ContractError {
    RoundAlreadyExists = 1,
    RoundNotFound = 2,
    EntryAlreadyCommitted = 3,
    EmptyTitle = 4,
}

#[contract]
pub struct RiseInRoundContract;

#[contractimpl]
impl RiseInRoundContract {
    /// Creates one educational allocation round owned by the caller.
    pub fn create_round(env: Env, round_id: u32, owner: Address, title: String) -> RoundState {
        owner.require_auth();

        if title.len() == 0 {
            panic_with_error!(&env, ContractError::EmptyTitle);
        }

        let key = DataKey::Round(round_id);
        if env.storage().persistent().has(&key) {
            panic_with_error!(&env, ContractError::RoundAlreadyExists);
        }

        let round = RoundState {
            commit_count: 0,
            created_at: env.ledger().timestamp(),
            owner: owner.clone(),
            title: title.clone(),
        };

        env.storage().persistent().set(&key, &round);
        env.events().publish(
            (symbol_short!("round"), symbol_short!("created"), round_id),
            (owner, title),
        );
        round
    }

    /// Stores a single 32-byte commitment for a participant and increments state.
    pub fn submit_commit(
        env: Env,
        round_id: u32,
        participant: Address,
        commitment: BytesN<32>,
    ) -> u32 {
        participant.require_auth();

        let round_key = DataKey::Round(round_id);
        let mut round: RoundState = env
            .storage()
            .persistent()
            .get(&round_key)
            .unwrap_or_else(|| panic_with_error!(&env, ContractError::RoundNotFound));

        let commit_key = DataKey::Commit(round_id, participant.clone());
        if env.storage().persistent().has(&commit_key) {
            panic_with_error!(&env, ContractError::EntryAlreadyCommitted);
        }

        env.storage().persistent().set(&commit_key, &commitment);
        round.commit_count += 1;
        env.storage().persistent().set(&round_key, &round);
        env.events().publish(
            (symbol_short!("commit"), symbol_short!("stored"), round_id),
            (participant, commitment),
        );

        round.commit_count
    }

    pub fn get_round(env: Env, round_id: u32) -> Option<RoundState> {
        env.storage().persistent().get(&DataKey::Round(round_id))
    }

    pub fn get_commit(env: Env, round_id: u32, participant: Address) -> Option<BytesN<32>> {
        env.storage()
            .persistent()
            .get(&DataKey::Commit(round_id, participant))
    }
}

#[cfg(test)]
mod test;
