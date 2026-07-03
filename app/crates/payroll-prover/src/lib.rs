//! Browser WASM Groth16 prover for the payroll circuit.
//!
//! Thin wasm-bindgen wrapper around the circuit-agnostic `prover` and `witness`
//! crates. Keys (proving key + R1CS) are loaded at runtime from bytes supplied
//! by the JS host (which caches them in IndexedDB), NOT embedded via
//! `include_bytes!` — the payroll proving key is ~1 GB and cannot be embedded
//! in a loadable WASM binary.
//!
//! Output is JSON shaped for the dashboard's `toSorobanScVals` serializer:
//! `{ proof: { a, b, c }, publicInputs: [...] }` where each field is a hex
//! string of the uncompressed point bytes / field element bytes.

use anyhow::Result;
use prover::prover::Prover;
use serde::Serialize;
use wasm_bindgen::prelude::*;
use witness::WitnessCalculator;

/// JSON shape returned to JS.
#[derive(Serialize)]
struct ProofResult {
    /// Uncompressed G1 (64 bytes) || G2 (128 bytes) || G1 (64 bytes) = 256 bytes, hex.
    proof_hex: String,
    /// Public inputs as big-endian 32-byte field elements, hex, in circuit order.
    public_inputs_hex: Vec<String>,
}

/// Generate a Groth16 proof.
///
/// Circuit-agnostic: accepts any proving key, R1CS, and circom WASM.
///
/// # Arguments (all from JS, bytes are `Uint8Array`)
/// * `pk_bytes`            — serialized proving key (compressed arkworks format)
/// * `r1cs_bytes`          — R1CS binary (.r1cs file contents)
/// * `circuit_wasm_bytes`  — circom-compiled witness generator WASM
/// * `inputs_json`         — JSON string of circuit inputs (same shape circom/snarkjs expect)
///
/// # Returns
/// JSON string `{ proof_hex, public_inputs_hex }`.
#[wasm_bindgen]
pub fn generate_proof(
    pk_bytes: &[u8],
    r1cs_bytes: &[u8],
    circuit_wasm_bytes: &[u8],
    inputs_json: &str,
) -> Result<String, JsValue> {
    let result = inner_generate(pk_bytes, r1cs_bytes, circuit_wasm_bytes, inputs_json)
        .map_err(|e| JsError::new(&format!("payroll-prover: {e}")))?;
    Ok(serde_json::to_string(&result)
        .map_err(|e| JsError::new(&format!("payroll-prover: serialize: {e}")))?)
}

/// Generate a Groth16 proof for the payroll circuit (backward-compatible alias).
#[wasm_bindgen]
pub fn generate_payroll_proof(
    pk_bytes: &[u8],
    r1cs_bytes: &[u8],
    circuit_wasm_bytes: &[u8],
    inputs_json: &str,
) -> Result<String, JsValue> {
    generate_proof(pk_bytes, r1cs_bytes, circuit_wasm_bytes, inputs_json)
}

/// Version of the prover crate — lets the JS side assert artifact compatibility
/// before kicking off a long proof.
#[wasm_bindgen]
pub fn version() -> String {
    String::from(env!("CARGO_PKG_VERSION"))
}

fn inner_generate(
    pk_bytes: &[u8],
    r1cs_bytes: &[u8],
    circuit_wasm_bytes: &[u8],
    inputs_json: &str,
) -> Result<ProofResult> {
    // 1. Compute witness from circom WASM + inputs.
    let mut wc = WitnessCalculator::new(circuit_wasm_bytes, r1cs_bytes)?;
    let witness_bytes = wc.compute_witness(inputs_json)?;

    // 2. Load prover (deserializes the 1 GB PK — this is the expensive step).
    let prover = Prover::new(pk_bytes, r1cs_bytes)?;

    // 3. Generate proof as uncompressed Soroban-ready bytes:
    //    [A (64) || B (128) || C (64)] = 256 bytes.
    let proof_uncompressed = prover.prove_bytes_uncompressed(&witness_bytes)?;

    // 4. Extract public inputs (big-endian 32-byte Fr elements).
    let public_inputs_bytes = prover.extract_public_inputs(&witness_bytes)?;
    let public_inputs_hex = public_inputs_bytes
        .chunks_exact(32)
        .map(|chunk| hex::encode(chunk))
        .collect();

    Ok(ProofResult {
        proof_hex: hex::encode(&proof_uncompressed),
        public_inputs_hex,
    })
}
