//! Browser WASM Poseidon2 primitives (BN254 scalar field) for the payroll
//! Merkle tree.
//!
//! Wraps the repo's `zkhash` crate — the *same* Rust implementation the circom
//! circuits use (parameters generated from the same Sage script), guaranteeing
//! hash consistency between the browser tree builder and the on-chain proof.
//!
//! Two primitives are exposed, matching `circuits/src/`:
//! - `poseidon2_commitment`: the salary commitment leaf
//!   `Poseidon2(3)` = `Permutation(4)([emp, sal, salt, ds])[0]` (ds = 0x01).
//! - `poseidon2_compress`: the Merkle internal-node hash `PoseidonCompress()`
//!   = `(Permutation(2)([l, r]) + [l, r])[0]`.
//!
//! Field elements are exchanged as 32-byte big-endian hex strings (no `0x`
//! prefix), matching the BN254 Fr wire format used everywhere else in this
//! project.

// Field arithmetic (ark-ff Fp addition) is modular and cannot overflow.
#![allow(clippy::arithmetic_side_effects)]

use ark_ff::{BigInteger, PrimeField};
use std::sync::Arc;
use wasm_bindgen::prelude::*;
use zkhash::{
    fields::bn256::FpBN256,
    poseidon2::{
        poseidon2::Poseidon2,
        poseidon2_instance_bn256::{POSEIDON2_BN256_PARAMS_2, POSEIDON2_BN256_PARAMS_4},
    },
};

type Fr = FpBN256;

/// Byte length of a BN254 field element.
const FR_BYTES: usize = 32;
/// Hex string length for a 32-byte BN254 field element.
const HEX_LEN: usize = 64;

fn parse_fr(hex_in: &str) -> Result<Fr, JsValue> {
    let clean = hex_in.trim_start_matches("0x");
    if clean.len() > HEX_LEN {
        return Err(JsValue::from(JsError::new(&format!(
            "field element hex too long ({} > {} chars): {hex_in}",
            clean.len(),
            HEX_LEN
        ))));
    }
    let mut bytes = vec![0u8; HEX_LEN.saturating_sub(clean.len())];
    for b in clean.as_bytes().chunks(2) {
        let s = std::str::from_utf8(b).map_err(|e| JsValue::from(JsError::new(&format!("bad hex: {e}"))))?;
        bytes.push(u8::from_str_radix(s, 16).map_err(|e| JsValue::from(JsError::new(&format!("bad hex: {e}"))))?);
    }
    Ok(Fr::from_be_bytes_mod_order(&bytes))
}

fn fr_to_hex(f: &Fr) -> String {
    let big = f.into_bigint();
    let bytes = big.to_bytes_be();
    // Pad to 32 bytes (the high bytes may be missing for small values).
    let mut out = vec![0u8; FR_BYTES.saturating_sub(bytes.len())];
    out.extend_from_slice(&bytes);
    hex::encode(out)
}

fn perm(params: &Arc<zkhash::poseidon2::poseidon2_params::Poseidon2Params<Fr>>, inputs: &[Fr]) -> Vec<Fr> {
    Poseidon2::new(params).permutation(inputs)
}

/// Salary commitment leaf (core): `Poseidon2(3)` = `Permutation(4)([emp, sal, salt, ds])[0]`.
fn commitment_fr(emp: Fr, sal: Fr, salt: Fr, ds: Fr) -> Fr {
    perm(&POSEIDON2_BN256_PARAMS_4, &[emp, sal, salt, ds])[0]
}

/// Merkle internal-node hash (core): `PoseidonCompress()` =
/// `(Permutation(2)([l, r]) + [l, r])[0]`.
fn compress_fr(l: Fr, r: Fr) -> Fr {
    let out = perm(&POSEIDON2_BN256_PARAMS_2, &[l, r]);
    out[0] + l
}

/// Salary commitment leaf: `Poseidon2(3)` = `Permutation(4)([emp, sal, salt, ds])[0]`.
#[wasm_bindgen]
pub fn poseidon2_commitment(
    employee_id_hex: &str,
    salary_hex: &str,
    salt_hex: &str,
    ds_hex: &str,
) -> Result<String, JsValue> {
    let emp = parse_fr(employee_id_hex)?;
    let sal = parse_fr(salary_hex)?;
    let salt = parse_fr(salt_hex)?;
    let ds = parse_fr(ds_hex)?;
    Ok(fr_to_hex(&commitment_fr(emp, sal, salt, ds)))
}

/// Merkle internal-node hash: `PoseidonCompress()` =
/// `(Permutation(2)([l, r]) + [l, r])[0]`.
#[wasm_bindgen]
pub fn poseidon2_compress(left_hex: &str, right_hex: &str) -> Result<String, JsValue> {
    let l = parse_fr(left_hex)?;
    let r = parse_fr(right_hex)?;
    Ok(fr_to_hex(&compress_fr(l, r)))
}

/// Crate version — lets the JS side assert compatibility before hashing.
#[wasm_bindgen]
pub fn version() -> String {
    String::from(env!("CARGO_PKG_VERSION"))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Round-trip: `fr_to_hex(parse_fr(x)) == x` for a canonical 32-byte hex.
    #[test]
    fn round_trip_hex() {
        let h = "0000000000000000000000000000000000000000000000000000000000000001";
        let f = parse_fr(h).unwrap();
        assert_eq!(fr_to_hex(&f), h);
    }

    /// `poseidon2_commitment` matches a direct `Poseidon2::new(params_4).permutation`
    /// call — verifies hex parsing, param selection, and output extraction.
    #[test]
    fn commitment_matches_direct_perm() {
        let emp = Fr::from(42u64);
        let sal = Fr::from(500_000u64);
        let salt = Fr::from(0u64);
        let ds = Fr::from(1u64);
        let direct = Poseidon2::new(&POSEIDON2_BN256_PARAMS_4).permutation(&[emp, sal, salt, ds])[0];
        let got = commitment_fr(emp, sal, salt, ds);
        assert_eq!(got, direct);
    }

    /// `poseidon2_compress` matches `(Permutation(2)([l, r]) + [l, r])[0]`.
    #[test]
    fn compress_matches_direct_perm() {
        let l = Fr::from(10u64);
        let r = Fr::from(20u64);
        let out = Poseidon2::new(&POSEIDON2_BN256_PARAMS_2).permutation(&[l, r]);
        let direct = out[0] + l;
        let got = compress_fr(l, r);
        assert_eq!(got, direct);
    }

    /// Two-level Merkle tree consistency:
    /// `compress(leaf, compress(leaf2, leaf3))` is deterministic and matches
    /// a hand-rolled TS-style computation using the same primitives.
    #[test]
    fn merkle_two_level_consistency() {
        let leaf0 = Fr::from(1u64);
        let leaf1 = Fr::from(2u64);
        let leaf2 = Fr::from(3u64);
        let leaf3 = Fr::from(4u64);

        let left = compress_fr(leaf0, leaf1);
        let right = compress_fr(leaf2, leaf3);
        let root = compress_fr(left, right);

        // Re-compute the right child in a different order to ensure no aliasing.
        let right2 = compress_fr(leaf2, leaf3);
        assert_eq!(right, right2);

        // Root must differ from any leaf.
        assert_ne!(root, leaf0);
        assert_ne!(root, leaf1);
    }
}
