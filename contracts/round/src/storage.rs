use soroban_sdk::{Address, Env};

use crate::types::{BidState, DataKey, Error, GlobalConfig, Round, Seal};

// TTL policy. Ledger close time on Stellar is ~5s, so these are generous for a
// hackathon-scale round while keeping ephemeral seal data short-lived.
const LEDGERS_PER_DAY: u32 = 17_280;
pub const PERSISTENT_BUMP: u32 = 60 * LEDGERS_PER_DAY;
pub const PERSISTENT_THRESHOLD: u32 = 50 * LEDGERS_PER_DAY;
pub const TEMP_BUMP: u32 = 3 * LEDGERS_PER_DAY;
pub const TEMP_THRESHOLD: u32 = 2 * LEDGERS_PER_DAY;

pub fn get_config(env: &Env) -> Result<GlobalConfig, Error> {
    env.storage()
        .instance()
        .get(&DataKey::Config)
        .ok_or(Error::NotInitialized)
}

pub fn set_config(env: &Env, config: &GlobalConfig) {
    env.storage().instance().set(&DataKey::Config, config);
}

pub fn is_initialized(env: &Env) -> bool {
    env.storage().instance().has(&DataKey::Config)
}

pub fn bump_instance(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(PERSISTENT_THRESHOLD, PERSISTENT_BUMP);
}

pub fn next_round_id(env: &Env) -> u64 {
    let id: u64 = env
        .storage()
        .instance()
        .get(&DataKey::RoundCounter)
        .unwrap_or(0);
    let next = id + 1;
    env.storage().instance().set(&DataKey::RoundCounter, &next);
    next
}

pub fn get_round(env: &Env, round_id: u64) -> Result<Round, Error> {
    let key = DataKey::Round(round_id);
    let round: Round = env
        .storage()
        .persistent()
        .get(&key)
        .ok_or(Error::RoundNotFound)?;
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_THRESHOLD, PERSISTENT_BUMP);
    Ok(round)
}

pub fn set_round(env: &Env, round_id: u64, round: &Round) {
    let key = DataKey::Round(round_id);
    env.storage().persistent().set(&key, round);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_THRESHOLD, PERSISTENT_BUMP);
}

pub fn get_state(env: &Env, round_id: u64, bidder: &Address) -> Result<BidState, Error> {
    let key = DataKey::State(round_id, bidder.clone());
    let state: BidState = env
        .storage()
        .persistent()
        .get(&key)
        .ok_or(Error::BidNotFound)?;
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_THRESHOLD, PERSISTENT_BUMP);
    Ok(state)
}

pub fn try_get_state(env: &Env, round_id: u64, bidder: &Address) -> Option<BidState> {
    env.storage()
        .persistent()
        .get(&DataKey::State(round_id, bidder.clone()))
}

pub fn set_state(env: &Env, round_id: u64, bidder: &Address, state: &BidState) {
    let key = DataKey::State(round_id, bidder.clone());
    env.storage().persistent().set(&key, state);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_THRESHOLD, PERSISTENT_BUMP);
}

pub fn set_seal(env: &Env, round_id: u64, bidder: &Address, seal: &Seal) {
    let key = DataKey::Seal(round_id, bidder.clone());
    env.storage().temporary().set(&key, seal);
    env.storage()
        .temporary()
        .extend_ttl(&key, TEMP_THRESHOLD, TEMP_BUMP);
}

pub fn get_seal(env: &Env, round_id: u64, bidder: &Address) -> Option<Seal> {
    env.storage()
        .temporary()
        .get(&DataKey::Seal(round_id, bidder.clone()))
}
