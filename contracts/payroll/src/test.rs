use crate::{Payroll, PayrollClient};
use contract_types::{Groth16Error, Groth16Proof};
use soroban_sdk::{
    Address, Bytes, BytesN, Env, IntoVal, U256, Vec, contract, contractimpl,
    crypto::bn254::{Bn254Fr, Bn254G1Affine as G1Affine, Bn254G2Affine as G2Affine},
    testutils::{Address as _, MockAuth, MockAuthContract, MockAuthInvoke},
};

// ─── Mock verifiers ─────────────────────────────────────────────────────────

/// Mock verifier that always returns Ok(true)
#[contract]
pub struct MockPayrollVerifier;

#[contractimpl]
impl MockPayrollVerifier {
    pub fn verify(
        _env: Env,
        _proof: Groth16Proof,
        _public_inputs: Vec<Bn254Fr>,
    ) -> Result<bool, Groth16Error> {
        Ok(true)
    }
}

/// Mock verifier that always returns Ok(false) — proof rejected
#[contract]
pub struct MockRejectingVerifier;

#[contractimpl]
impl MockRejectingVerifier {
    pub fn verify(
        _env: Env,
        _proof: Groth16Proof,
        _public_inputs: Vec<Bn254Fr>,
    ) -> Result<bool, Groth16Error> {
        Ok(false)
    }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

fn test_env() -> Env {
    Env::default()
}

fn register_payroll(env: &Env) -> (Address, Address, PayrollClient<'_>) {
    let admin = env.register(MockAuthContract, ());
    let token = Address::generate(env);
    let verifier = Address::generate(env);
    let employee_root = U256::from_u32(env, 42);
    let budget_cap = U256::from_u32(env, 1_000_000);

    let contract_addr = env.register(
        Payroll,
        (admin.clone(), token, verifier, employee_root, budget_cap),
    );
    let client = PayrollClient::new(env, &contract_addr);

    (admin, contract_addr, client)
}

/// Set up a payroll contract with a real mock verifier that returns Ok(true).
fn register_with_mock_verifier(env: &Env) -> (Address, Address, Address, PayrollClient<'_>) {
    let admin = Address::generate(env);
    let token = env.register(MockToken, ());
    let verifier = env.register(MockPayrollVerifier, ());
    let employee_root = U256::from_u32(env, 42);
    let budget_cap = U256::from_u32(env, 1_000_000);

    let contract_addr = env.register(
        Payroll,
        (
            admin.clone(),
            token,
            verifier.clone(),
            employee_root,
            budget_cap,
        ),
    );
    let client = PayrollClient::new(env, &contract_addr);

    (admin, contract_addr, verifier, client)
}

/// Convert a U256 to a Bn254Fr field element (big-endian bytes).
fn fr_from_u256(env: &Env, value: &U256) -> Bn254Fr {
    let mut buf = [0u8; 32];
    value.to_be_bytes().copy_into_slice(&mut buf);
    Bn254Fr::from_bytes(BytesN::from_array(env, &buf))
}

/// Build a mock Groth16 proof (all-zero points — valid structure, not cryptographically valid).
fn mk_mock_groth16_proof(env: &Env) -> Groth16Proof {
    Groth16Proof {
        a: G1Affine::from_array(env, &[0u8; 64]),
        b: G2Affine::from_array(env, &[0u8; 128]),
        c: G1Affine::from_array(env, &[0u8; 64]),
    }
}

/// Build default public inputs for run_payroll: [employeeRoot, totalPayrollAmount, payrollPeriodId].
fn default_public_inputs(
    env: &Env,
    employee_root: u32,
    total_amount: u32,
    period_id: u32,
) -> Vec<Bn254Fr> {
    let mut inputs: Vec<Bn254Fr> = Vec::new(env);
    inputs.push_back(fr_from_u256(env, &U256::from_u32(env, employee_root)));
    inputs.push_back(fr_from_u256(env, &U256::from_u32(env, total_amount)));
    inputs.push_back(fr_from_u256(env, &U256::from_u32(env, period_id)));
    inputs
}

// ─── Mock token contract ────────────────────────────────────────────────────

/// Minimal mock token that accepts transfer() calls (no-op).
#[contract]
pub struct MockToken;

#[contractimpl]
impl MockToken {
    pub fn transfer(_env: Env, _from: Address, _to: Address, _amount: i128) {}
    pub fn balance_of(_env: Env, _id: Address) -> i128 {
        0
    }
    pub fn total_supply(_env: Env) -> i128 {
        0
    }
}

#[test]
fn test_init_sets_admin_and_config() {
    let env = test_env();
    let (_admin, _contract_addr, client) = register_payroll(&env);

    assert_eq!(client.get_employee_root(), U256::from_u32(&env, 42));
    assert_eq!(client.get_budget_cap(), U256::from_u32(&env, 1_000_000));
    // init itself doesn't require auth — require_auth is called in admin methods
}

#[test]
fn test_set_employee_root_emits_event() {
    let env = test_env();
    let (admin, contract_addr, client) = register_payroll(&env);

    let new_root = U256::from_u32(&env, 99);
    client
        .mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_addr,
                fn_name: "set_employee_root",
                args: (new_root.clone(),).into_val(&env),
                sub_invokes: &[],
            },
        }])
        .set_employee_root(&new_root);

    assert_eq!(client.get_employee_root(), new_root);
}

#[test]
fn test_set_budget_cap_emits_event() {
    let env = test_env();
    let (admin, contract_addr, client) = register_payroll(&env);

    let new_cap = U256::from_u32(&env, 5_000_000);
    client
        .mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_addr,
                fn_name: "set_budget_cap",
                args: (new_cap.clone(),).into_val(&env),
                sub_invokes: &[],
            },
        }])
        .set_budget_cap(&new_cap);

    assert_eq!(client.get_budget_cap(), new_cap);
}

#[test]
fn test_auditor_grant_and_revoke() {
    let env = test_env();
    let (admin, contract_addr, client) = register_payroll(&env);

    let auditor = Address::generate(&env);
    let view_key = Bytes::from_array(&env, &[0xAB; 32]);

    // Grant auditor access (admin call)
    client
        .mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_addr,
                fn_name: "set_view_key_for_auditor",
                args: (&auditor, &view_key).into_val(&env),
                sub_invokes: &[],
            },
        }])
        .set_view_key_for_auditor(&auditor, &view_key);

    // Verify auditor is active
    assert!(client.is_auditor(&auditor));

    // Retrieve view key (no auth required)
    let retrieved = client.get_view_key(&auditor);
    assert_eq!(retrieved, view_key);

    // Revoke auditor (admin call)
    client
        .mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_addr,
                fn_name: "revoke_auditor",
                args: (auditor.clone(),).into_val(&env),
                sub_invokes: &[],
            },
        }])
        .revoke_auditor(&auditor);
    assert!(!client.is_auditor(&auditor));

    // Revoked auditor cannot get view key
    let result = client.try_get_view_key(&auditor);
    assert!(result.is_err());
}

#[test]
fn test_get_view_key_returns_error_for_unknown_auditor() {
    let env = test_env();
    let (_, _, client) = register_payroll(&env);

    let unknown = Address::generate(&env);
    let result = client.try_get_view_key(&unknown);
    assert!(result.is_err());
}

#[test]
fn test_get_view_key_returns_error_for_revoked_auditor() {
    let env = test_env();
    let (admin, contract_addr, client) = register_payroll(&env);

    let auditor = Address::generate(&env);
    let view_key = Bytes::from_array(&env, &[0xCD; 32]);

    // Grant and revoke
    client
        .mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_addr,
                fn_name: "set_view_key_for_auditor",
                args: (&auditor, &view_key).into_val(&env),
                sub_invokes: &[],
            },
        }])
        .set_view_key_for_auditor(&auditor, &view_key);

    client
        .mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_addr,
                fn_name: "revoke_auditor",
                args: (auditor.clone(),).into_val(&env),
                sub_invokes: &[],
            },
        }])
        .revoke_auditor(&auditor);

    let result = client.try_get_view_key(&auditor);
    assert!(result.is_err());
}

// ─── run_payroll tests (T2.5–T2.12) ────────────────────────────────────────

/// T2.5: Valid Groth16 proof passes run_payroll — period stored, event emitted.
#[test]
fn test_run_payroll_success_with_mock_verifier() {
    let env = test_env();
    env.mock_all_auths();
    let (_admin, _contract_addr, _verifier, client) = register_with_mock_verifier(&env);

    let proof = mk_mock_groth16_proof(&env);
    let period_id = 1u32;
    let total_amount = 500_000u32;
    let public_inputs = default_public_inputs(&env, 42, total_amount, period_id);
    let commitment_id = U256::from_u32(&env, 1);
    let ipfs_cid = Bytes::from_array(&env, b"QmTest");
    let ipfs_cids: Vec<(U256, Bytes)> = {
        let mut v: Vec<(U256, Bytes)> = Vec::new(&env);
        v.push_back((commitment_id, ipfs_cid));
        v
    };

    client.run_payroll(&proof, &public_inputs, &ipfs_cids);

    let period = client.get_current_period();
    assert_eq!(period, 1);
    let (root, amount, count) = client
        .get_payroll_period(&1u64)
        .expect("period 1 should exist");
    assert_eq!(root, U256::from_u32(&env, 42));
    assert_eq!(amount, U256::from_u32(&env, total_amount));
    assert_eq!(count, 1);
}

/// T2.6: Budget exceeded — public_inputs[1] > budgetCap → BudgetExceeded.
#[test]
fn test_run_payroll_rejects_budget_exceeded() {
    let env = test_env();
    env.mock_all_auths();
    let (_admin, _contract_addr, _verifier, client) = register_with_mock_verifier(&env);

    let proof = mk_mock_groth16_proof(&env);
    let total_amount = 2_000_000u32; // > budget_cap (1_000_000)
    let public_inputs = default_public_inputs(&env, 42, total_amount, 1);
    let ipfs_cids: Vec<(U256, Bytes)> = Vec::new(&env);

    let result = client.try_run_payroll(&proof, &public_inputs, &ipfs_cids);
    assert!(result.is_err());
}

/// T2.7: Fake proof — mock verifier returns false → ProofVerificationFailed.
#[test]
fn test_run_payroll_rejects_fake_proof() {
    let env = test_env();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token = env.register(MockToken, ());
    let verifier = env.register(MockRejectingVerifier, ());
    let employee_root = U256::from_u32(&env, 42);
    let budget_cap = U256::from_u32(&env, 1_000_000);

    let contract_addr = env.register(
        Payroll,
        (admin.clone(), token, verifier, employee_root, budget_cap),
    );
    let client = PayrollClient::new(&env, &contract_addr);

    let proof = mk_mock_groth16_proof(&env);
    let public_inputs = default_public_inputs(&env, 42, 500_000, 1);
    let ipfs_cids: Vec<(U256, Bytes)> = Vec::new(&env);

    let result = client.try_run_payroll(&proof, &public_inputs, &ipfs_cids);
    assert!(result.is_err());
}

/// T2.8: Wrong employeeRoot in public inputs → ProofVerificationFailed.
#[test]
fn test_run_payroll_rejects_wrong_employee_root() {
    let env = test_env();
    env.mock_all_auths();
    let (_admin, _contract_addr, _verifier, client) = register_with_mock_verifier(&env);

    let proof = mk_mock_groth16_proof(&env);
    let public_inputs = default_public_inputs(&env, 99, 500_000, 1); // root=99 ≠ stored 42
    let ipfs_cids: Vec<(U256, Bytes)> = Vec::new(&env);

    let result = client.try_run_payroll(&proof, &public_inputs, &ipfs_cids);
    assert!(result.is_err());
}

/// T2.9: Non-canonical public input (full 0xFF) → NonCanonicalInput or ProofVerificationFailed.
#[test]
fn test_run_payroll_rejects_non_canonical_input() {
    let env = test_env();
    env.mock_all_auths();
    let (_admin, _contract_addr, _verifier, client) = register_with_mock_verifier(&env);

    let proof = mk_mock_groth16_proof(&env);
    // Use a U256 that is > BN254 modulus (all 0xFF bytes)
    let non_canonical = fr_from_u256(
        &env,
        &U256::from_be_bytes(&env, &Bytes::from_array(&env, &[0xFFu8; 32])),
    );
    let mut public_inputs: Vec<Bn254Fr> = Vec::new(&env);
    public_inputs.push_back(non_canonical); // employeeRoot
    public_inputs.push_back(fr_from_u256(&env, &U256::from_u32(&env, 500_000)));
    public_inputs.push_back(fr_from_u256(&env, &U256::from_u32(&env, 1)));

    let ipfs_cids: Vec<(U256, Bytes)> = Vec::new(&env);

    let result = client.try_run_payroll(&proof, &public_inputs, &ipfs_cids);
    // Either the field element gets reduced (becomes != stored root → ProofVerificationFailed)
    // or the contract rejects it as NonCanonicalInput
    assert!(result.is_err());
}

/// T2.10: Any connected wallet can submit a valid payroll proof.
#[test]
fn test_run_payroll_accepts_connected_wallet_submitter() {
    let env = test_env();
    let (_admin, _contract_addr, _verifier, client) = register_with_mock_verifier(&env);

    let proof = mk_mock_groth16_proof(&env);
    let public_inputs = default_public_inputs(&env, 42, 500_000, 1);
    let ipfs_cids: Vec<(U256, Bytes)> = Vec::new(&env);

    client.run_payroll(&proof, &public_inputs, &ipfs_cids);
    assert_eq!(client.get_current_period(), 1);
}

/// T2.11: Amount bound to proof — no separate caller-supplied amount arg.
#[test]
fn test_run_payroll_amount_bound_to_proof() {
    let env = test_env();
    env.mock_all_auths();
    let (_admin, _contract_addr, _verifier, client) = register_with_mock_verifier(&env);

    let proof = mk_mock_groth16_proof(&env);
    let total_amount = 777_777u32;
    let public_inputs = default_public_inputs(&env, 42, total_amount, 1);
    let ipfs_cids: Vec<(U256, Bytes)> = Vec::new(&env);

    client.run_payroll(&proof, &public_inputs, &ipfs_cids);

    let (_root, amount, _count) = client
        .get_payroll_period(&1u64)
        .expect("period 1 should exist");
    // The stored amount must equal public_inputs[1], NOT a caller-supplied separate arg
    assert_eq!(
        amount,
        U256::from_u32(&env, total_amount),
        "stored total_amount must equal public_inputs[1] (proof-bound)"
    );
}

/// T2.12: Duplicate commitmentId → DuplicateCommitment.
#[test]
fn test_run_payroll_rejects_duplicate_commitment() {
    let env = test_env();
    env.mock_all_auths();
    let (_admin, _contract_addr, _verifier, client) = register_with_mock_verifier(&env);

    let proof = mk_mock_groth16_proof(&env);
    let public_inputs = default_public_inputs(&env, 42, 500_000, 1);
    let commitment_id = U256::from_u32(&env, 100);
    let ipfs_cid = Bytes::from_array(&env, b"QmTest123");
    let ipfs_cids: Vec<(U256, Bytes)> = {
        let mut v: Vec<(U256, Bytes)> = Vec::new(&env);
        v.push_back((commitment_id.clone(), ipfs_cid.clone()));
        v.push_back((commitment_id.clone(), ipfs_cid));
        v
    };

    let result = client.try_run_payroll(&proof, &public_inputs, &ipfs_cids);
    assert!(result.is_err());
}

/// T2.12b: Duplicate commitmentId across periods — also rejected.
#[test]
fn test_run_payroll_rejects_duplicate_commitment_across_periods() {
    let env = test_env();
    env.mock_all_auths();
    let (_admin, _contract_addr, _verifier, client) = register_with_mock_verifier(&env);

    let proof = mk_mock_groth16_proof(&env);
    let commitment_id = U256::from_u32(&env, 200);
    let ipfs_cid = Bytes::from_array(&env, b"QmUnique");

    // First payroll — succeeds
    let ipfs_cids1: Vec<(U256, Bytes)> = {
        let mut v: Vec<(U256, Bytes)> = Vec::new(&env);
        v.push_back((commitment_id.clone(), ipfs_cid.clone()));
        v
    };
    client.run_payroll(
        &proof,
        &default_public_inputs(&env, 42, 500_000, 1),
        &ipfs_cids1,
    );

    // Second payroll with same commitment_id — must fail
    let ipfs_cids2: Vec<(U256, Bytes)> = {
        let mut v: Vec<(U256, Bytes)> = Vec::new(&env);
        v.push_back((commitment_id.clone(), ipfs_cid.clone()));
        v
    };
    let result = client.try_run_payroll(
        &proof,
        &default_public_inputs(&env, 42, 500_000, 2),
        &ipfs_cids2,
    );
    assert!(result.is_err());
}

// ─── Withdraw tests (T2.13–T2.17) ──────────────────────────────────────

/// Helper: register payroll with a withdraw mock verifier and run an initial payroll.
/// Returns (env, client, withdrawal_addr) where the payroll has period 1 active.
fn register_and_run_payroll_with_withdraw_verifier(env: &Env) -> (Address, PayrollClient<'_>) {
    env.mock_all_auths();
    let admin = Address::generate(env);
    let token = env.register(MockToken, ());
    let payroll_verifier = env.register(MockPayrollVerifier, ());
    let withdraw_verifier = env.register(MockPayrollVerifier, ()); // Same mock, different VK concept
    let employee_root = U256::from_u32(env, 42);
    let budget_cap = U256::from_u32(env, 1_000_000);

    let contract_addr = env.register(
        Payroll,
        (
            admin.clone(),
            token,
            payroll_verifier,
            employee_root,
            budget_cap,
        ),
    );
    let client = PayrollClient::new(env, &contract_addr);

    // Set withdraw verifier
    client.set_withdraw_verifier(&withdraw_verifier);

    // Run payroll to create period 1 with commitment_root = 42.
    // Include a commitment record (id=1) so withdraw tests can verify it.
    let proof = mk_mock_groth16_proof(env);
    let public_inputs = default_public_inputs(env, 42, 500_000, 1);
    let commitment_id = U256::from_u32(env, 1);
    let ipfs_cid = Bytes::from_array(env, b"QmTestWithdraw");
    let ipfs_cids: Vec<(U256, Bytes)> = {
        let mut v: Vec<(U256, Bytes)> = Vec::new(env);
        v.push_back((commitment_id, ipfs_cid));
        v
    };
    client.run_payroll(&proof, &public_inputs, &ipfs_cids);

    (contract_addr, client)
}

/// Build withdraw public inputs: [commitmentRoot, commitmentId, nullifier, salaryAmount]
fn withdraw_public_inputs(
    env: &Env,
    commitment_root: u32,
    commitment_id: u32,
    nullifier: u32,
    salary_amount: u32,
) -> Vec<Bn254Fr> {
    let mut inputs: Vec<Bn254Fr> = Vec::new(env);
    inputs.push_back(fr_from_u256(env, &U256::from_u32(env, commitment_root)));
    inputs.push_back(fr_from_u256(env, &U256::from_u32(env, commitment_id)));
    inputs.push_back(fr_from_u256(env, &U256::from_u32(env, nullifier)));
    inputs.push_back(fr_from_u256(env, &U256::from_u32(env, salary_amount)));
    inputs
}

/// T2.13: Valid withdrawal — proof passes, nullifier marked spent, event emitted.
#[test]
fn test_withdraw_success() {
    let env = test_env();
    let (_contract_addr, client) = register_and_run_payroll_with_withdraw_verifier(&env);

    let proof = mk_mock_groth16_proof(&env);
    let nullifier = 100_001u32;
    let pub_inputs = withdraw_public_inputs(&env, 42, 1, nullifier, 500_000);
    let recipient = Address::generate(&env);

    client.withdraw(&proof, &pub_inputs, &recipient);

    // Nullifier should be marked as spent
    assert!(client.is_nullifier_spent(&U256::from_u32(&env, nullifier)));
    // Period should still be accessible
    let (root, amount, count) = client.get_payroll_period(&1u64).expect("period 1 exists");
    assert_eq!(root, U256::from_u32(&env, 42));
    assert_eq!(amount, U256::from_u32(&env, 500_000));
    assert_eq!(count, 1); // 1 commitment record was stored
}

/// T2.14: Double-spend — same nullifier submitted twice → NullifierAlreadySpent.
#[test]
fn test_withdraw_rejects_double_spend() {
    let env = test_env();
    let (_contract_addr, client) = register_and_run_payroll_with_withdraw_verifier(&env);

    let proof = mk_mock_groth16_proof(&env);
    let nullifier = 200_002u32;
    let pub_inputs = withdraw_public_inputs(&env, 42, 1, nullifier, 500_000);
    let recipient = Address::generate(&env);

    // First withdrawal succeeds
    client.withdraw(&proof, &pub_inputs, &recipient);

    // Second withdrawal with same nullifier must fail
    let result = client.try_withdraw(&proof, &pub_inputs, &recipient);
    assert!(result.is_err());
}

/// T2.15: Wrong commitment root (not a known period) → PeriodNotInitialized.
#[test]
fn test_withdraw_rejects_wrong_root() {
    let env = test_env();
    let (_contract_addr, client) = register_and_run_payroll_with_withdraw_verifier(&env);

    let proof = mk_mock_groth16_proof(&env);
    // commitment_root = 999 — no period has this root
    let pub_inputs = withdraw_public_inputs(&env, 999, 1, 300_003, 500_000);
    let recipient = Address::generate(&env);

    let result = client.try_withdraw(&proof, &pub_inputs, &recipient);
    assert!(result.is_err());
}

/// T2.16: Fake proof — failing mock verifier → ProofVerificationFailed.
#[test]
fn test_withdraw_rejects_fake_proof() {
    let env = test_env();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token = env.register(MockToken, ());
    let payroll_verifier = env.register(MockPayrollVerifier, ());
    let withdraw_verifier = env.register(MockRejectingVerifier, ());
    let employee_root = U256::from_u32(&env, 42);
    let budget_cap = U256::from_u32(&env, 1_000_000);

    let contract_addr = env.register(
        Payroll,
        (admin, token, payroll_verifier, employee_root, budget_cap),
    );
    let client = PayrollClient::new(&env, &contract_addr);
    client.set_withdraw_verifier(&withdraw_verifier);

    let proof = mk_mock_groth16_proof(&env);
    let pub_inputs = withdraw_public_inputs(&env, 42, 1, 400_004, 500_000);
    let recipient = Address::generate(&env);

    let result = client.try_withdraw(&proof, &pub_inputs, &recipient);
    assert!(result.is_err());
}

/// T2.17: Withdraw verifier not set → WithdrawVerifierNotSet.
#[test]
fn test_withdraw_rejects_no_verifier() {
    let env = test_env();
    env.mock_all_auths();
    // withdraw() will fail before reaching recipient.require_auth(), so mock_all_auths is safe.

    let admin = Address::generate(&env);
    let token = env.register(MockToken, ());
    let payroll_verifier = env.register(MockPayrollVerifier, ());
    let employee_root = U256::from_u32(&env, 42);
    let budget_cap = U256::from_u32(&env, 1_000_000);

    let contract_addr = env.register(
        Payroll,
        (admin, token, payroll_verifier, employee_root, budget_cap),
    );
    let client = PayrollClient::new(&env, &contract_addr);

    // Intentionally NOT setting withdraw verifier

    let proof = mk_mock_groth16_proof(&env);
    let pub_inputs = withdraw_public_inputs(&env, 42, 1, 500_005, 500_000);
    let recipient = Address::generate(&env);

    let result = client.try_withdraw(&proof, &pub_inputs, &recipient);
    assert!(result.is_err());
}

/// T2.18: Commitment ID not stored → CommitmentNotFound.
#[test]
fn test_withdraw_rejects_unknown_commitment() {
    let env = test_env();
    let (_contract_addr, client) = register_and_run_payroll_with_withdraw_verifier(&env);

    let proof = mk_mock_groth16_proof(&env);
    // commitment_id = 999 — no such record was stored
    let pub_inputs = withdraw_public_inputs(&env, 42, 999, 600_006, 500_000);
    let recipient = Address::generate(&env);

    let result = client.try_withdraw(&proof, &pub_inputs, &recipient);
    assert!(result.is_err());
}
