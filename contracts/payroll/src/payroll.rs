//! Payroll Contract Implementation
//!
//! Privacy-first ZK payroll with Groth16 proof verification.
//!
//! # Public Inputs to PayrollCircuit
//! `[employeeRoot, totalPayrollAmount, payrollPeriodId]`

#![allow(clippy::too_many_arguments)]

use contract_types::{Groth16Error, Groth16Proof};
use soroban_sdk::{
    contract, contractclient, contracterror, contractevent, contractimpl, contracttype,
    crypto::bn254::Bn254Fr, token::TokenClient, Address, Bytes, Env, U256, Vec,
};

// ─── Storage TTL constants ──────────────────────────────────────────────────
// Persistent storage entries are archived when their TTL expires. Extend
// proactively in hot paths to avoid costly RestoreFootprint operations.

/// Minimum remaining TTL (ledgers) before extension triggers (~1 day).
const MIN_TTL: u32 = 17280;
/// Target TTL after extension (~30 days).
const EXTEND_TO: u32 = 518400;

// ─── Verifier client interface ───────────────────────────────────────────────

#[contractclient(crate_path = "soroban_sdk", name = "CircomGroth16VerifierClient")]
pub trait CircomGroth16VerifierInterface {
    fn verify(
        env: Env,
        proof: Groth16Proof,
        public_inputs: Vec<Bn254Fr>,
    ) -> Result<bool, Groth16Error>;
}

// ─── Error types ─────────────────────────────────────────────────────────────

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    /// Caller not authorized for this operation
    NotAuthorized = 1,
    /// Payroll amount exceeds budget cap
    BudgetExceeded = 2,
    /// Groth16 proof verification failed
    ProofVerificationFailed = 3,
    /// Period not initialized
    PeriodNotInitialized = 4,
    /// Commitment list empty
    EmptyCommitments = 5,
    /// Employee root not set
    EmployeeRootNotSet = 6,
    /// Duplicate commitment
    DuplicateCommitment = 7,
    /// Auditor not found
    AuditorNotFound = 8,
    /// Auditor access revoked
    AuditorRevoked = 9,
    /// Non-canonical public input
    NonCanonicalInput = 10,
    /// Token not set
    TokenNotSet = 11,
    /// Nullifier already spent (double-withdrawal attempt)
    NullifierAlreadySpent = 13,
    /// Withdraw verifier contract not set
    WithdrawVerifierNotSet = 14,
    /// Commitment ID not found in any payroll period
    CommitmentNotFound = 15,
}

// ─── Storage keys ────────────────────────────────────────────────────────────

/// Payroll period record
#[contracttype]
#[derive(Clone)]
pub struct PayrollPeriod {
    pub commitment_root: U256,
    pub total_amount: U256,
    pub employee_count: u32,
    pub proof_verified: bool,
}

/// Auditor record
#[contracttype]
#[derive(Clone)]
pub struct AuditorRecord {
    pub encrypted_view_key: Bytes,
    pub revoked: bool,
}

/// Per-period commitment record (commitmentId → IPFS CID)
#[contracttype]
#[derive(Clone)]
pub struct CommitmentRecord {
    pub commitment_id: U256,
    pub ipfs_cid: Bytes,
}

// ─── Events ──────────────────────────────────────────────────────────────────

/// Fired when a payroll run succeeds
#[contractevent]
#[derive(Clone)]
pub struct PayrollVerifiedEvent {
    #[topic]
    pub period_id: u64,
    pub commitment_root: U256,
    pub total_amount: U256,
    pub employee_count: u32,
}

/// Fired when an auditor is granted access
#[contractevent]
#[derive(Clone)]
pub struct AuditorGrantedEvent {
    #[topic]
    pub auditor: Address,
}

/// Fired when an auditor is revoked
#[contractevent]
#[derive(Clone)]
pub struct AuditorRevokedEvent {
    #[topic]
    pub auditor: Address,
}

/// Fired when employee root is updated
#[contractevent]
#[derive(Clone)]
pub struct EmployeeRootUpdatedEvent {
    #[topic]
    pub root: U256,
}

/// Fired when budget cap is updated
#[contractevent]
#[derive(Clone)]
pub struct BudgetCapUpdatedEvent {
    #[topic]
    pub cap: U256,
}

/// Fired when an employee withdraws their salary via ZK proof
#[contractevent]
#[derive(Clone)]
pub struct WithdrawalEvent {
    #[topic]
    pub nullifier: U256,
    pub period_id: u64,
    pub salary_amount: U256,
    pub recipient: Address,
}

// ─── Contract ────────────────────────────────────────────────────────────────

#[contract]
pub struct Payroll;

// ─── Storage keys enum ───────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum DataKey {
    /// Administrator address
    Admin,
    /// USDC token address
    Token,
    /// Groth16 verifier contract address
    Verifier,
    /// Current employee Merkle root
    EmployeeRoot,
    /// Budget cap per period (in stroops)
    BudgetCap,
    /// Current payroll period counter
    CurrentPeriod,
    /// Payroll period record
    Period(u64),
    /// Commitment records for a period
    PeriodCommitments(u64),
    /// Individual commitment record by ID
    CommitmentRecord(U256),
    /// Auditor record by address
    Auditor(Address),
    /// PayrollWithdrawCircuit verifier contract address
    WithdrawVerifier,
    /// Tracks spent nullifiers (nullifier → bool)
    WithdrawnNullifier(U256),
    /// Maps commitment root to period ID
    RootToPeriod(U256),
}

#[contractimpl]
impl Payroll {
    // ═══════════════════════════════════════════════════════════════════════════
    // Initialization
    // ═══════════════════════════════════════════════════════════════════════════

    /// Initialize the payroll contract — set admin, verifier, token, and initial config.
    /// Runs once atomically at deploy time (Protocol 22+ host-level one-shot constructor).
    /// Must be named __constructor and return ().
    pub fn __constructor(
        env: Env,
        admin: Address,
        token: Address,
        verifier: Address,
        employee_root: U256,
        budget_cap: U256,
    ) {
        env.storage().persistent().set(&DataKey::Admin, &admin);
        env.storage().persistent().set(&DataKey::Token, &token);
        env.storage().persistent().set(&DataKey::Verifier, &verifier);
        env.storage()
            .persistent()
            .set(&DataKey::EmployeeRoot, &employee_root);
        env.storage()
            .persistent()
            .set(&DataKey::BudgetCap, &budget_cap);
        env.storage()
            .persistent()
            .set(&DataKey::CurrentPeriod, &0u64);

        env.storage().instance().extend_ttl(MIN_TTL, EXTEND_TO);
    }

    // ─── Admin methods ──────────────────────────────────────────────────────

    /// Set the employee Merkle root (employer/admin only)
    pub fn set_employee_root(env: Env, root: U256) -> Result<(), Error> {
        Self::require_admin(&env)?;
        env.storage().persistent().set(&DataKey::EmployeeRoot, &root);
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::EmployeeRoot, MIN_TTL, EXTEND_TO);
        EmployeeRootUpdatedEvent { root }.publish(&env);
        Ok(())
    }

    /// Set the budget cap per period in stroops (employer/admin only)
    pub fn set_budget_cap(env: Env, cap: U256) -> Result<(), Error> {
        Self::require_admin(&env)?;
        env.storage().persistent().set(&DataKey::BudgetCap, &cap);
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::BudgetCap, MIN_TTL, EXTEND_TO);
        BudgetCapUpdatedEvent { cap }.publish(&env);
        Ok(())
    }

    /// Set the USDC token address (employer/admin only)
    pub fn set_token(env: Env, token: Address) -> Result<(), Error> {
        Self::require_admin(&env)?;
        env.storage().persistent().set(&DataKey::Token, &token);
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::Token, MIN_TTL, EXTEND_TO);
        Ok(())
    }

    /// Set the Groth16 verifier contract address (employer/admin only)
    pub fn set_verifier(env: Env, verifier: Address) -> Result<(), Error> {
        Self::require_admin(&env)?;
        env.storage().persistent().set(&DataKey::Verifier, &verifier);
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::Verifier, MIN_TTL, EXTEND_TO);
        Ok(())
    }

    // ─── Auditor management ─────────────────────────────────────────────────

    /// Grant an auditor access to view salary data (employer/admin only)
    pub fn set_view_key_for_auditor(
        env: Env,
        auditor: Address,
        encrypted_view_key: Bytes,
    ) -> Result<(), Error> {
        Self::require_admin(&env)?;
        let record = AuditorRecord {
            encrypted_view_key,
            revoked: false,
        };
        env.storage()
            .persistent()
            .set(&DataKey::Auditor(auditor.clone()), &record);
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::Auditor(auditor.clone()), MIN_TTL, EXTEND_TO);
        AuditorGrantedEvent {
            auditor: auditor.clone(),
        }
        .publish(&env);
        Ok(())
    }

    /// Retrieve my encrypted view key (auditor self-service)
    pub fn get_view_key(env: Env, auditor: Address) -> Result<Bytes, Error> {
        let record = env
            .storage()
            .persistent()
            .get::<_, AuditorRecord>(&DataKey::Auditor(auditor.clone()))
            .ok_or(Error::AuditorNotFound)?;

        if record.revoked {
            return Err(Error::AuditorRevoked);
        }

        Ok(record.encrypted_view_key)
    }

    /// Revoke an auditor's access (employer/admin only)
    pub fn revoke_auditor(env: Env, auditor: Address) -> Result<(), Error> {
        Self::require_admin(&env)?;
        let mut record = env
            .storage()
            .persistent()
            .get::<_, AuditorRecord>(&DataKey::Auditor(auditor.clone()))
            .ok_or(Error::AuditorNotFound)?;

        record.revoked = true;
        env.storage()
            .persistent()
            .set(&DataKey::Auditor(auditor.clone()), &record);
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::Auditor(auditor.clone()), MIN_TTL, EXTEND_TO);
        AuditorRevokedEvent {
            auditor: auditor.clone(),
        }
        .publish(&env);
        Ok(())
    }

    /// Check if an address is an active (non-revoked) auditor
    pub fn is_auditor(env: Env, auditor: Address) -> bool {
        env.storage()
            .persistent()
            .get::<_, AuditorRecord>(&DataKey::Auditor(auditor))
            .is_some_and(|r| !r.revoked)
    }

    // ─── Payroll execution ──────────────────────────────────────────────────

    /// Execute a payroll run — verify Groth16 proof, check budget, transfer USDC
    ///
    /// # Arguments
    /// * `proof` — Serialized Groth16 proof from browser prover
    /// * `public_inputs` — `[employeeRoot, totalPayrollAmount, payrollPeriodId]` as BN254 Fr elements
    /// * `ipfs_cids` — Vector of `(commitmentId, ipfsCid)` tuples for encrypted salary blobs.
    ///                 Employee count is derived from `ipfs_cids.len()`.
    ///                 Note: this matches the number of commitment records stored,
    ///                 not the circuit's batch size (which includes zero-padded slots).
    pub fn run_payroll(
        env: Env,
        proof: Groth16Proof,
        public_inputs: Vec<Bn254Fr>,
        ipfs_cids: Vec<(U256, Bytes)>,
    ) -> Result<(), Error> {
        // 1. Require admin auth for this operation (authorizes token transfer)
        Self::require_admin(&env)?;

        // 2. Derive employee count from ipfs_cids length
        let employee_count = ipfs_cids.len();

        // 2. Extract and validate all public inputs from the proof
        // public_inputs = [employeeRoot, totalPayrollAmount, payrollPeriodId]
        let employee_root = public_inputs.get(0).ok_or(Error::NonCanonicalInput)?;
        let total_payroll_amount_fe = public_inputs.get(1).ok_or(Error::NonCanonicalInput)?;
        let payroll_period_id_fe = public_inputs.get(2).ok_or(Error::NonCanonicalInput)?;

        // Convert field elements to U256 — reject if non-canonical
        let employee_root_u256 = employee_root.as_u256().clone();
        let total_payroll_amount = total_payroll_amount_fe.as_u256().clone();

        // 3. Verify employee root matches stored root
        let stored_root = env
            .storage()
            .persistent()
            .get::<_, U256>(&DataKey::EmployeeRoot)
            .ok_or(Error::EmployeeRootNotSet)?;
        if employee_root_u256 != stored_root {
            return Err(Error::ProofVerificationFailed);
        }

        // 4. Check budget cap against proof-bound amount
        let budget_cap = env
            .storage()
            .persistent()
            .get::<_, U256>(&DataKey::BudgetCap)
            .unwrap_or_else(|| U256::min_value(&env));
        if total_payroll_amount > budget_cap {
            return Err(Error::BudgetExceeded);
        }

        // 5. Verify Groth16 proof via deployed verifier contract
        let verifier = env
            .storage()
            .persistent()
            .get::<_, Address>(&DataKey::Verifier)
            .ok_or(Error::ProofVerificationFailed)?;

        let client = CircomGroth16VerifierClient::new(&env, &verifier);
        let is_valid = client.verify(&proof, &public_inputs);
        if !is_valid {
            return Err(Error::ProofVerificationFailed);
        }

        // 6. Verify payroll period ID from proof matches the next period
        let current_period = env
            .storage()
            .persistent()
            .get::<_, u64>(&DataKey::CurrentPeriod)
            .unwrap_or(0u64);
        let new_period = current_period.checked_add(1).ok_or(Error::NonCanonicalInput)?;

        // Convert proof's period ID to u64 and verify it matches
        let proof_period_id = Self::fr_to_u64(&env, &payroll_period_id_fe)?;
        if proof_period_id != new_period {
            return Err(Error::ProofVerificationFailed);
        }

        // 7. Store period record with proof-bound amount
        let period_record = PayrollPeriod {
            commitment_root: employee_root_u256.clone(),
            total_amount: total_payroll_amount.clone(),
            employee_count,
            proof_verified: true,
        };
        env.storage()
            .persistent()
            .set(&DataKey::Period(new_period), &period_record);

        // 7b. Map commitment root to period ID (used by withdraw())
        env.storage()
            .persistent()
            .set(&DataKey::RootToPeriod(employee_root_u256.clone()), &new_period);

        // 8. Store commitment records, check for duplicates
        let mut period_commitments: Vec<U256> = Vec::new(&env);
        for item in ipfs_cids.iter() {
            let (commitment_id, ipfs_cid) = item;
            let commitment_id_owned = commitment_id.clone();
            let ipfs_cid_owned = ipfs_cid.clone();
            if env
                .storage()
                .persistent()
                .get::<_, CommitmentRecord>(&DataKey::CommitmentRecord(commitment_id_owned.clone()))
                .is_some()
            {
                return Err(Error::DuplicateCommitment);
            }
            let record = CommitmentRecord {
                commitment_id: commitment_id_owned.clone(),
                ipfs_cid: ipfs_cid_owned.clone(),
            };
            env.storage()
                .persistent()
                .set(&DataKey::CommitmentRecord(commitment_id_owned.clone()), &record);
            period_commitments.push_back(commitment_id_owned);
        }
        env.storage()
            .persistent()
            .set(&DataKey::PeriodCommitments(new_period), &period_commitments);

        // 9. Update period counter
        env.storage()
            .persistent()
            .set(&DataKey::CurrentPeriod, &new_period);

        // 9b. Extend TTL for all hot-path storage entries
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::Period(new_period), MIN_TTL, EXTEND_TO);
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::RootToPeriod(employee_root_u256.clone()), MIN_TTL, EXTEND_TO);
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::PeriodCommitments(new_period), MIN_TTL, EXTEND_TO);
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::CurrentPeriod, MIN_TTL, EXTEND_TO);
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::EmployeeRoot, MIN_TTL, EXTEND_TO);
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::BudgetCap, MIN_TTL, EXTEND_TO);

        // 10. Transfer USDC from employer to contract escrow
        let token = env
            .storage()
            .persistent()
            .get::<_, Address>(&DataKey::Token)
            .ok_or(Error::TokenNotSet)?;
        let admin = env
            .storage()
            .persistent()
            .get::<_, Address>(&DataKey::Admin)
            .ok_or(Error::NotAuthorized)?;
        let contract_addr = env.current_contract_address();

        let amount_u128 = total_payroll_amount
            .to_u128()
            .ok_or(Error::NonCanonicalInput)?;
        if amount_u128 > i128::MAX.unsigned_abs() {
            return Err(Error::NonCanonicalInput);
        }
        #[allow(clippy::cast_possible_wrap)]
        let amount_i128 = amount_u128 as i128;

        let token_client = TokenClient::new(&env, &token);
        token_client.transfer(&admin, &contract_addr, &amount_i128);

        // 11. Emit success event
        PayrollVerifiedEvent {
            period_id: new_period,
            commitment_root: employee_root_u256,
            total_amount: total_payroll_amount,
            employee_count,
        }
        .publish(&env);

        Ok(())
    }

    /// Set the PayrollWithdrawCircuit verifier contract address (employer/admin only)
    pub fn set_withdraw_verifier(env: Env, verifier: Address) -> Result<(), Error> {
        Self::require_admin(&env)?;
        env.storage()
            .persistent()
            .set(&DataKey::WithdrawVerifier, &verifier);
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::WithdrawVerifier, MIN_TTL, EXTEND_TO);
        Ok(())
    }

    // ─── Withdrawal ──────────────────────────────────────────────────────────

    /// Withdraw salary via ZK proof (employee self-service).
    ///
    /// Employee generates a PayrollWithdrawCircuit proof proving ownership of a
    /// salary commitment without revealing their identity. The contract verifies
    /// the proof, checks the nullifier hasn't been spent, marks it spent, and
    /// transfers USDC to the caller.
    ///
    /// # Arguments
    /// * `proof` — Serialized Groth16 proof from browser prover (PayrollWithdrawCircuit)
    /// * `public_inputs` — `[commitmentRoot, commitmentId, nullifier, salaryAmount]` as BN254 Fr elements
    pub fn withdraw(
        env: Env,
        proof: Groth16Proof,
        public_inputs: Vec<Bn254Fr>,
        recipient: Address,
    ) -> Result<(), Error> {
        // 0. Require recipient to authorize this withdrawal
        recipient.require_auth();

        // 1. Verify proof via withdraw verifier
        let withdraw_verifier = env
            .storage()
            .persistent()
            .get::<_, Address>(&DataKey::WithdrawVerifier)
            .ok_or(Error::WithdrawVerifierNotSet)?;

        let verifier_client = CircomGroth16VerifierClient::new(&env, &withdraw_verifier);
        let is_valid = verifier_client.verify(&proof, &public_inputs);
        if !is_valid {
            return Err(Error::ProofVerificationFailed);
        }

        // 2. Extract public inputs: [commitmentRoot, commitmentId, nullifier, salaryAmount]
        let commitment_root_fe = public_inputs.get(0).ok_or(Error::NonCanonicalInput)?;
        let commitment_id_fe = public_inputs.get(1).ok_or(Error::NonCanonicalInput)?;
        let nullifier_fe = public_inputs.get(2).ok_or(Error::NonCanonicalInput)?;
        let salary_fe = public_inputs.get(3).ok_or(Error::NonCanonicalInput)?;

        let commitment_root = commitment_root_fe.as_u256().clone();
        let commitment_id = commitment_id_fe.as_u256().clone();
        let nullifier = nullifier_fe.as_u256().clone();
        let salary_amount = salary_fe.as_u256().clone();

        // 3. Verify commitment root is from a known payroll period
        let period_id = env
            .storage()
            .persistent()
            .get::<_, u64>(&DataKey::RootToPeriod(commitment_root.clone()))
            .ok_or(Error::PeriodNotInitialized)?;

        // 4. Verify commitment ID exists in stored records
        if env
            .storage()
            .persistent()
            .get::<_, CommitmentRecord>(&DataKey::CommitmentRecord(commitment_id.clone()))
            .is_none()
        {
            return Err(Error::CommitmentNotFound);
        }

        // 5. Check nullifier hasn't been spent
        if env
            .storage()
            .persistent()
            .get::<_, bool>(&DataKey::WithdrawnNullifier(nullifier.clone()))
            .unwrap_or(false)
        {
            return Err(Error::NullifierAlreadySpent);
        }

        // 6. Mark nullifier as spent
        env.storage()
            .persistent()
            .set(&DataKey::WithdrawnNullifier(nullifier.clone()), &true);
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::WithdrawnNullifier(nullifier.clone()), MIN_TTL, EXTEND_TO);

        // 7. Transfer USDC from contract escrow to caller
        let token = env
            .storage()
            .persistent()
            .get::<_, Address>(&DataKey::Token)
            .ok_or(Error::TokenNotSet)?;
        let contract_addr = env.current_contract_address();

        let amount_u128 = salary_amount
            .to_u128()
            .ok_or(Error::NonCanonicalInput)?;
        if amount_u128 > i128::MAX.unsigned_abs() {
            return Err(Error::NonCanonicalInput);
        }
        #[allow(clippy::cast_possible_wrap)]
        let amount_i128 = amount_u128 as i128;

        let token_client = TokenClient::new(&env, &token);
        token_client.transfer(&contract_addr, &recipient, &amount_i128);

        // 8. Emit withdrawal event
        WithdrawalEvent {
            nullifier,
            period_id,
            salary_amount,
            recipient,
        }
        .publish(&env);

        Ok(())
    }

    // ─── Queries ────────────────────────────────────────────────────────────

    pub fn get_employee_root(env: Env) -> U256 {
        env.storage()
            .persistent()
            .get(&DataKey::EmployeeRoot)
            .unwrap_or_else(|| U256::min_value(&env))
    }

    pub fn get_budget_cap(env: Env) -> U256 {
        env.storage()
            .persistent()
            .get(&DataKey::BudgetCap)
            .unwrap_or_else(|| U256::min_value(&env))
    }

    pub fn get_payroll_period(env: Env, period_id: u64) -> Option<(U256, U256, u32)> {
        env.storage()
            .persistent()
            .get::<_, PayrollPeriod>(&DataKey::Period(period_id))
            .map(|p| (p.commitment_root, p.total_amount, p.employee_count))
    }

    pub fn get_commitment_record(env: Env, commitment_id: U256) -> Option<(U256, Bytes)> {
        env.storage()
            .persistent()
            .get::<_, CommitmentRecord>(&DataKey::CommitmentRecord(commitment_id))
            .map(|r| (r.commitment_id, r.ipfs_cid))
    }

    pub fn get_current_period(env: Env) -> u64 {
        env.storage()
            .persistent()
            .get(&DataKey::CurrentPeriod)
            .unwrap_or(0)
    }

    /// Check if a nullifier has already been spent (preview before withdraw)
    pub fn is_nullifier_spent(env: Env, nullifier: U256) -> bool {
        env.storage()
            .persistent()
            .get::<_, bool>(&DataKey::WithdrawnNullifier(nullifier))
            .unwrap_or(false)
    }

    // ─── Internal helpers ───────────────────────────────────────────────────

    fn require_admin(env: &Env) -> Result<(), Error> {
        let admin = env
            .storage()
            .persistent()
            .get::<_, Address>(&DataKey::Admin)
            .ok_or(Error::NotAuthorized)?;
        admin.require_auth();
        Ok(())
    }

    /// Extract a u64 from a Bn254Fr field element.
    /// Rejects values that don't fit in u64 as NonCanonicalInput.
    fn fr_to_u64(_env: &Env, fr: &Bn254Fr) -> Result<u64, Error> {
        let u256 = fr.as_u256();
        // U256 fits in u128 via to_u128; reject if it doesn't fit in u64
        let u128_val = u256.to_u128().ok_or(Error::NonCanonicalInput)?;
        if u128_val > u128::from(u64::MAX) {
            return Err(Error::NonCanonicalInput);
        }
        u64::try_from(u128_val).map_err(|_| Error::NonCanonicalInput)
    }
}

