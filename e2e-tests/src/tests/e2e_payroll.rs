//! End-to-end payroll test: Merkle tree → witness → Groth16 proof →
//! on-chain verification → state transition.
//!
//! This test generates a REAL Groth16 proof (not a mock) using the same
//! native Rust prover the browser WASM prover wraps, then submits it to the
//! payroll contract in a local Soroban environment.
//!
//! A mock verifier is used because the `circom-groth16-verifier` crate embeds
//! a single VK at compile time (the pool VK for the existing pool e2e tests).
//! The proof is verified OFF-CHAIN via `Prover::verify` to confirm
//! cryptographic validity before submission.

use anyhow::Result;
use contract_types::{Groth16Error, Groth16Proof};
use num_bigint::{BigInt, Sign};
use payroll::{Payroll, PayrollClient};
use prover::prover::Prover;
use serde_json::json;
use soroban_sdk::{
    Address, Bytes, BytesN, Env, U256, contract, contractimpl,
    crypto::bn254::{Bn254Fr, Bn254G1Affine as G1Affine, Bn254G2Affine as G2Affine},
    testutils::Address as _,
};
use soroban_utils::utils::MockToken;
use std::path::PathBuf;
use witness::WitnessCalculator;
use zkhash::{
    ark_ff::{BigInteger, PrimeField, Zero},
    fields::bn256::FpBN256 as Scalar,
    poseidon2::{
        poseidon2::Poseidon2,
        poseidon2_instance_bn256::{POSEIDON2_BN256_PARAMS_2, POSEIDON2_BN256_PARAMS_4},
    },
};

// ─── Constants ─────────────────────────────────────────────────────────────

/// Merkle tree depth (matches `PayrollBatch(10, 10)` browser variant).
const LEVELS: usize = 10;
/// Batch size (matches circuit `n` parameter, `PayrollBatch(10, 10)`).
const BATCH_SIZE: usize = 10;

// ─── Mock verifier ─────────────────────────────────────────────────────────

/// A mock verifier that always returns Ok(true). The real on-chain verifier
/// is tested by the pool e2e tests — here we validate the full payroll flow
/// with a real proof (verified off-chain) and the contract logic.
#[contract]
pub struct MockVerifier;

#[contractimpl]
impl MockVerifier {
    pub fn verify(
        _env: Env,
        _proof: Groth16Proof,
        _public_inputs: soroban_sdk::Vec<Bn254Fr>,
    ) -> Result<bool, Groth16Error> {
        Ok(true)
    }
}

// ─── Poseidon2 helpers (matching the circom circuits) ─────────────────────

/// Salary commitment leaf: `Poseidon2(3)` = `Permutation(4)([emp, sal, salt, ds])[0]`.
fn commitment(emp: Scalar, sal: Scalar, salt: Scalar, ds: Scalar) -> Scalar {
    let p = Poseidon2::new(&POSEIDON2_BN256_PARAMS_4);
    p.permutation(&[emp, sal, salt, ds])[0]
}

/// Merkle internal node: `PoseidonCompress()` = `(Permutation(2)([l, r]) + l)[0]`.
fn compress(l: Scalar, r: Scalar) -> Scalar {
    let p = Poseidon2::new(&POSEIDON2_BN256_PARAMS_2);
    let out = p.permutation(&[l, r]);
    out[0] + l
}

/// Convert a Scalar to a 32-byte big-endian array.
fn scalar_to_bytes(s: &Scalar) -> [u8; 32] {
    let big = s.into_bigint();
    let bytes = big.to_bytes_be();
    let mut out = [0u8; 32];
    out[32 - bytes.len()..].copy_from_slice(&bytes);
    out
}

/// Convert a Scalar to a decimal BigInt string (for circom JSON input).
fn scalar_to_decimal(s: &Scalar) -> String {
    let bytes = scalar_to_bytes(s);
    BigInt::from_bytes_be(Sign::Plus, &bytes).to_str_radix(10)
}

/// Convert a Scalar to a Soroban U256 using from_parts (avoids Bytes conversion).
fn scalar_to_u256(env: &Env, s: &Scalar) -> U256 {
    let bytes = scalar_to_bytes(s);
    let hi_hi = u64::from_be_bytes(bytes[0..8].try_into().unwrap());
    let hi_lo = u64::from_be_bytes(bytes[8..16].try_into().unwrap());
    let lo_hi = u64::from_be_bytes(bytes[16..24].try_into().unwrap());
    let lo_lo = u64::from_be_bytes(bytes[24..32].try_into().unwrap());
    U256::from_parts(env, hi_hi, hi_lo, lo_hi, lo_lo)
}

// ─── Merkle tree ───────────────────────────────────────────────────────────

struct MerkleTree {
    root: Scalar,
    /// Per-slot proofs: `(path_elements, path_indices)` for each of BATCH_SIZE slots.
    proofs: std::vec::Vec<(std::vec::Vec<Scalar>, u64)>,
}

/// Build a sparse Merkle tree and produce proofs for all BATCH_SIZE slots.
fn build_merkle_tree(employees: &[(Scalar, Scalar, Scalar)]) -> MerkleTree {
    let ds = Scalar::from(1u64);

    // Zero-commitment = commitment(0, 0, 0, DS)
    let zero_commitment = commitment(Scalar::zero(), Scalar::zero(), Scalar::zero(), ds);

    // Precompute zero hashes for each level.
    let mut zeros = vec![zero_commitment];
    for i in 1..=LEVELS {
        zeros.push(compress(zeros[i - 1], zeros[i - 1]));
    }

    // Compute real commitments.
    let real_commitments: std::vec::Vec<Scalar> = employees
        .iter()
        .map(|(emp, sal, salt)| commitment(*emp, *sal, *salt, ds))
        .collect();

    // Sparse tree: layers[k] = HashMap<nodeIndex, Scalar>.
    let mut layers: std::vec::Vec<std::collections::HashMap<usize, Scalar>> = (0..=LEVELS)
        .map(|_| std::collections::HashMap::new())
        .collect();

    // Insert real commitments, propagating hashes upward.
    for (i, &commitment_val) in real_commitments.iter().enumerate() {
        let mut node_index = i;
        let mut hash = commitment_val;
        for k in 0..=LEVELS {
            if hash != zeros[k] {
                layers[k].insert(node_index, hash);
            }
            if k == LEVELS {
                break;
            }
            let sibling_index = node_index ^ 1;
            let sibling_hash = *layers[k].get(&sibling_index).unwrap_or(&zeros[k]);
            let parent_index = node_index >> 1;
            let (left, right) = if node_index % 2 == 0 {
                (hash, sibling_hash)
            } else {
                (sibling_hash, hash)
            };
            hash = compress(left, right);
            node_index = parent_index;
        }
    }

    let root = *layers[LEVELS].get(&0).unwrap_or(&zeros[LEVELS]);

    // Build proofs for all BATCH_SIZE slots.
    let mut proofs = std::vec::Vec::with_capacity(BATCH_SIZE);
    for slot_idx in 0..BATCH_SIZE {
        let mut path_elements = std::vec::Vec::with_capacity(LEVELS);
        let mut node_index = slot_idx;
        for k in 0..LEVELS {
            let sibling_index = node_index ^ 1;
            let sibling_hash = *layers[k].get(&sibling_index).unwrap_or(&zeros[k]);
            path_elements.push(sibling_hash);
            node_index >>= 1;
        }
        proofs.push((path_elements, slot_idx as u64));
    }

    MerkleTree { root, proofs }
}

// ─── Artifact paths ────────────────────────────────────────────────────────

fn workspace_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("workspace root")
        .to_path_buf()
}

fn pk_path() -> PathBuf {
    workspace_root().join("testdata/payroll_10_10_proving_key.bin")
}

fn r1cs_path() -> PathBuf {
    workspace_root().join("target/circuits-artifacts/debug/payroll_10_10.r1cs")
}

fn circom_wasm_path() -> PathBuf {
    workspace_root().join("target/circuits-artifacts/debug/payroll_10_10.wasm")
}

// ─── E2E test ──────────────────────────────────────────────────────────────

/// Fast test: Merkle tree construction + witness computation (no proof gen).
///
/// Validates that the Poseidon2 hashes match the circuit, the sparse tree
/// produces correct proofs, and the circom witness calculator accepts the
/// JSON input. This is the critical Phase 4.4 validation.
#[test]
fn e2e_payroll_merkle_witness() -> Result<()> {
    // ─── 1. Define employee data ───────────────────────────────────────────
    let employee_id = Scalar::from(42u64);
    let salary_stroops = Scalar::from(5_000_000u64); // 0.5 USDC (7 decimals)
    let salt = Scalar::from(123_456_789u64);

    let employees = [(employee_id, salary_stroops, salt)];

    // ─── 2. Build Merkle tree ──────────────────────────────────────────────
    let tree = build_merkle_tree(&employees);
    eprintln!("[e2e] Merkle root: {}", scalar_to_decimal(&tree.root));
    eprintln!(
        "[e2e] Proofs: {} slots × {} levels",
        tree.proofs.len(),
        LEVELS
    );

    // Verify tree properties.
    assert_eq!(tree.proofs.len(), BATCH_SIZE);
    for (pe, _pi) in &tree.proofs {
        assert_eq!(pe.len(), LEVELS);
    }

    // ─── 3. Construct circuit input JSON ───────────────────────────────────
    let total_payroll = salary_stroops;

    let mut employee_ids = std::vec::Vec::new();
    let mut salary_amounts = std::vec::Vec::new();
    let mut salts = std::vec::Vec::new();
    let mut path_elements_json = std::vec::Vec::new();
    let mut path_indices_json = std::vec::Vec::new();

    for i in 0..BATCH_SIZE {
        if i < employees.len() {
            employee_ids.push(scalar_to_decimal(&employee_id));
            salary_amounts.push(scalar_to_decimal(&salary_stroops));
            salts.push(scalar_to_decimal(&salt));
        } else {
            employee_ids.push("0".to_string());
            salary_amounts.push("0".to_string());
            salts.push("0".to_string());
        }
        let (pe, pi) = &tree.proofs[i];
        path_elements_json.push(
            pe.iter()
                .map(|s| scalar_to_decimal(s))
                .collect::<std::vec::Vec<_>>(),
        );
        path_indices_json.push(BigInt::from(*pi).to_str_radix(10));
    }

    let inputs_json = json!({
        "employeeRoot": scalar_to_decimal(&tree.root),
        "totalPayrollAmount": scalar_to_decimal(&total_payroll),
        "payrollPeriodId": "1",
        "employeeId": employee_ids,
        "salaryAmount": salary_amounts,
        "salt": salts,
        "pathElements": path_elements_json,
        "pathIndices": path_indices_json,
    })
    .to_string();

    // ─── 4. Load artifacts ─────────────────────────────────────────────────
    eprintln!("[e2e] Loading artifacts...");
    let r1cs_bytes = std::fs::read(r1cs_path())?;
    let circom_wasm = std::fs::read(circom_wasm_path())?;
    eprintln!(
        "[e2e] R1CS={}MB, WASM={}MB",
        r1cs_bytes.len() / 1_000_000,
        circom_wasm.len() / 1_000_000
    );

    // ─── 5. Compute witness ────────────────────────────────────────────────
    eprintln!("[e2e] Computing witness...");
    let mut witness_calc = WitnessCalculator::new(&circom_wasm, &r1cs_bytes)?;
    let witness_bytes = witness_calc.compute_witness(&inputs_json)?;
    eprintln!(
        "[e2e] Witness computed: {} bytes ({} field elements)",
        witness_bytes.len(),
        witness_bytes.len() / 32
    );

    // Verify witness has enough public inputs (1 (one) + 3 public = 4).
    assert!(
        witness_bytes.len() >= 4 * 32,
        "witness too short for public inputs"
    );

    // ─── 6. Verify Merkle root is in the witness (public input 0) ──────────
    // The witness layout: [1, employeeRoot, totalPayrollAmount, payrollPeriodId, ...]
    // Each field element is 32 bytes little-endian in the witness.
    let root_from_witness_le = &witness_bytes[32..64]; // skip the "1" element
    let root_from_witness_be: [u8; 32] = {
        let mut buf = [0u8; 32];
        buf.copy_from_slice(root_from_witness_le);
        buf.reverse();
        buf
    };
    let root_expected = scalar_to_bytes(&tree.root);
    assert_eq!(
        root_from_witness_be, root_expected,
        "Merkle root in witness must match tree root"
    );

    eprintln!(
        "✅ Merkle tree + witness validated: root matches, {} field elements",
        witness_bytes.len() / 32
    );

    Ok(())
}

/// Full E2E: Merkle tree → witness → Groth16 proof → on-chain verification.
///
/// With the `PayrollBatch(10, 10)` browser variant, the PK is only 9.6 MB
/// and proving takes seconds.
#[test]
fn e2e_payroll_real_proof() -> Result<()> {
    // ─── 1. Define employee data ───────────────────────────────────────────
    let employee_id = Scalar::from(42u64);
    let salary_stroops = Scalar::from(5_000_000u64); // 0.5 USDC (7 decimals)
    let salt = Scalar::from(123_456_789u64);

    let employees = [(employee_id, salary_stroops, salt)];

    // ─── 2. Build Merkle tree ──────────────────────────────────────────────
    let tree = build_merkle_tree(&employees);

    // ─── 3. Construct circuit input JSON ───────────────────────────────────
    let total_payroll = salary_stroops;

    let mut employee_ids = std::vec::Vec::new();
    let mut salary_amounts = std::vec::Vec::new();
    let mut salts = std::vec::Vec::new();
    let mut path_elements_json = std::vec::Vec::new();
    let mut path_indices_json = std::vec::Vec::new();

    for i in 0..BATCH_SIZE {
        if i < employees.len() {
            employee_ids.push(scalar_to_decimal(&employee_id));
            salary_amounts.push(scalar_to_decimal(&salary_stroops));
            salts.push(scalar_to_decimal(&salt));
        } else {
            employee_ids.push("0".to_string());
            salary_amounts.push("0".to_string());
            salts.push("0".to_string());
        }
        let (pe, pi) = &tree.proofs[i];
        path_elements_json.push(
            pe.iter()
                .map(|s| scalar_to_decimal(s))
                .collect::<std::vec::Vec<_>>(),
        );
        path_indices_json.push(BigInt::from(*pi).to_str_radix(10));
    }

    let inputs_json = json!({
        "employeeRoot": scalar_to_decimal(&tree.root),
        "totalPayrollAmount": scalar_to_decimal(&total_payroll),
        "payrollPeriodId": "1",
        "employeeId": employee_ids,
        "salaryAmount": salary_amounts,
        "salt": salts,
        "pathElements": path_elements_json,
        "pathIndices": path_indices_json,
    })
    .to_string();

    // ─── 4. Load artifacts ─────────────────────────────────────────────────
    eprintln!("[e2e] Loading artifacts...");
    let pk_bytes = std::fs::read(pk_path())?;
    let r1cs_bytes = std::fs::read(r1cs_path())?;
    let circom_wasm = std::fs::read(circom_wasm_path())?;
    eprintln!(
        "[e2e] Artifacts loaded: PK={}MB, R1CS={}MB, WASM={}MB",
        pk_bytes.len() / 1_000_000,
        r1cs_bytes.len() / 1_000_000,
        circom_wasm.len() / 1_000_000
    );

    // ─── 5. Compute witness ────────────────────────────────────────────────
    eprintln!("[e2e] Computing witness...");
    let mut witness_calc = WitnessCalculator::new(&circom_wasm, &r1cs_bytes)?;
    let witness_bytes = witness_calc.compute_witness(&inputs_json)?;
    eprintln!("[e2e] Witness computed: {} bytes", witness_bytes.len());

    // ─── 6. Generate proof ─────────────────────────────────────────────────
    eprintln!("[e2e] Creating prover (deserializing PK)...");
    let prover = Prover::new(&pk_bytes, &r1cs_bytes)?;
    eprintln!(
        "[e2e] Prover ready. Constraints: {}, wires: {}",
        prover.num_constraints(),
        prover.num_wires()
    );

    eprintln!("[e2e] Generating Groth16 proof...");
    let proof_bytes_compressed = prover.prove_bytes(&witness_bytes)?;
    let proof_bytes = prover.prove_bytes_uncompressed(&witness_bytes)?;
    eprintln!(
        "[e2e] Proof generated: {} bytes uncompressed, {} bytes compressed",
        proof_bytes.len(),
        proof_bytes_compressed.len()
    );
    assert_eq!(
        proof_bytes.len(),
        256,
        "uncompressed proof must be 256 bytes"
    );

    // ─── 7. Extract & verify public inputs off-chain ───────────────────────
    let public_inputs_bytes = prover.extract_public_inputs(&witness_bytes)?;
    assert_eq!(
        public_inputs_bytes.len(),
        3 * 32,
        "3 public inputs × 32 bytes"
    );

    // verify() expects compressed bytes; prove_bytes_uncompressed returns
    // uncompressed for Soroban submission.
    let is_valid = prover.verify(&proof_bytes_compressed, &public_inputs_bytes)?;
    assert!(is_valid, "off-chain proof verification must succeed");

    // ─── 8. Convert proof to Soroban types ─────────────────────────────────
    let env = Env::default();

    let a_bytes: [u8; 64] = proof_bytes[0..64].try_into().unwrap();
    let b_bytes: [u8; 128] = proof_bytes[64..192].try_into().unwrap();
    let c_bytes: [u8; 64] = proof_bytes[192..256].try_into().unwrap();

    let soroban_proof = Groth16Proof {
        a: G1Affine::from_array(&env, &a_bytes),
        b: G2Affine::from_array(&env, &b_bytes),
        c: G1Affine::from_array(&env, &c_bytes),
    };

    // Convert public inputs to Soroban Vec<Bn254Fr>.
    // The witness stores field elements in little-endian, but Bn254Fr::from_bytes
    // expects big-endian, so we reverse each 32-byte chunk.
    let mut pub_inputs = soroban_sdk::Vec::new(&env);
    for chunk in public_inputs_bytes.chunks_exact(32) {
        let mut buf: [u8; 32] = chunk.try_into().unwrap();
        buf.reverse(); // witness is LE, Bn254Fr expects BE
        pub_inputs.push_back(Bn254Fr::from_bytes(BytesN::from_array(&env, &buf)));
    }

    // ─── 9. Deploy contracts in local Env (same env) ────────────────────────
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let token = env.register(MockToken, ());
    let verifier = env.register(MockVerifier, ());
    let employee_root_u256 = U256::from_u32(&env, 42);
    let budget_cap = U256::from_u32(&env, 100_000_000); // 10 USDC

    let payroll_addr = env.register(
        Payroll,
        (
            admin.clone(),
            token,
            verifier,
            employee_root_u256.clone(),
            budget_cap,
        ),
    );
    let client = PayrollClient::new(&env, &payroll_addr);

    // ─── 10. Payroll contract is initialized via __constructor at register ───
    // Update root to the actual tree root.
    let actual_root = scalar_to_u256(&env, &tree.root);
    client.set_employee_root(&actual_root);

    // Root was set via init — run_payroll will verify it matches the proof.

    // ─── 11. Run payroll with real proof ───────────────────────────────────
    let ipfs_cids: soroban_sdk::Vec<(U256, Bytes)> = soroban_sdk::Vec::new(&env);

    client.run_payroll(&soroban_proof, &pub_inputs, &ipfs_cids);

    // ─── 12. Verify state transition ───────────────────────────────────────
    let period = client.get_current_period();
    assert_eq!(period, 1, "period should advance after run_payroll");

    println!("✅ E2E payroll test passed: real Groth16 proof verified and accepted by contract");

    Ok(())
}
