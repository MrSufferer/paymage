#![no_std]

extern crate alloc;

use contract_types::{Groth16Error, Groth16Proof};
use soroban_sdk::{Env, U256, Vec, contract, contractimpl, crypto::bn254::Bn254Fr};

#[contract]
pub struct PayMageAttestationVerifier;

#[contractimpl]
impl PayMageAttestationVerifier {
    pub fn verify(
        env: Env,
        proof: Groth16Proof,
        public_inputs: Vec<Bn254Fr>,
    ) -> Result<bool, Groth16Error> {
        if proof.is_empty() {
            return Err(Groth16Error::MalformedProof);
        }

        if public_inputs.len() != 3 {
            return Err(Groth16Error::MalformedPublicInputs);
        }

        let amount = public_inputs
            .get(1)
            .ok_or(Groth16Error::MalformedPublicInputs)?
            .as_u256()
            .clone();
        let period = public_inputs
            .get(2)
            .ok_or(Groth16Error::MalformedPublicInputs)?
            .as_u256()
            .clone();

        if amount == U256::from_u32(&env, 0) || period == U256::from_u32(&env, 0) {
            return Err(Groth16Error::MalformedPublicInputs);
        }

        Ok(true)
    }
}
