extern crate alloc;

mod types {
    use alloc::vec::Vec;

    pub const FIELD_SIZE: usize = 32;

    pub struct Groth16Proof {
        pub a: Vec<u8>,
        pub b: Vec<u8>,
        pub c: Vec<u8>,
    }

    impl Groth16Proof {
        pub fn to_bytes(&self) -> Vec<u8> {
            let mut bytes = Vec::with_capacity(self.a.len() + self.b.len() + self.c.len());
            bytes.extend_from_slice(&self.a);
            bytes.extend_from_slice(&self.b);
            bytes.extend_from_slice(&self.c);
            bytes
        }
    }
}

mod serialization {
    use anyhow::{Result, anyhow};
    use ark_bn254::Fr;
    use ark_ff::PrimeField;

    use crate::types::FIELD_SIZE;

    pub fn bytes_to_fr(bytes: &[u8]) -> Result<Fr> {
        if bytes.len() != FIELD_SIZE {
            return Err(anyhow!(
                "Expected {} bytes, got {}",
                FIELD_SIZE,
                bytes.len()
            ));
        }
        Ok(Fr::from_le_bytes_mod_order(bytes))
    }
}

#[path = "../../../app/crates/core/prover/src/r1cs.rs"]
mod r1cs;

#[path = "../../../app/crates/core/prover/src/prover.rs"]
pub mod prover_impl;

mod prover {
    pub use crate::prover_impl as prover;
}

include!("../../../e2e-tests/src/bin/payroll_prover_service.rs");
