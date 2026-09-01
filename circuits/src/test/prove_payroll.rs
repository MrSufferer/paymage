#[cfg(test)]
mod tests {
    use crate::test::utils::{
        circom_tester::{Inputs, SignalKey, generate_keys, prove_and_verify_with_keys},
        general::{load_artifacts, scalar_to_bigint},
    };
    use anyhow::{Context, Result};
    use num_bigint::BigInt;
    use zkhash::fields::bn256::FpBN256 as Scalar;

    const LEVELS: usize = 10;
    const BATCH_SIZE: usize = 10;

    /// Negative test: salary sum != totalPayrollAmount → proof fails
    /// verification.
    ///
    /// T1.2: Invalid sum (sum of salaryAmounts ≠ totalPayrollAmount) must
    /// produce a proof that does not verify.
    #[test]
    #[ignore]
    fn test_payroll_invalid_sum_rejected() -> Result<()> {
        let (wasm, r1cs) = load_artifacts("payroll_10_10")?;
        let keys = generate_keys(&wasm, &r1cs).context("generate_keys failed")?;

        let mut inputs = Inputs::new();
        inputs.set("employeeRoot", scalar_to_bigint(Scalar::from(0u64)));
        // total=9999999 but only one employee with salary=5000000 → sum
        // mismatch
        inputs.set(
            "totalPayrollAmount",
            scalar_to_bigint(Scalar::from(9_999_999u64)),
        );
        inputs.set("payrollPeriodId", BigInt::from(1));

        for i in 0..BATCH_SIZE {
            let e = if i == 0 {
                Scalar::from(42u64)
            } else {
                Scalar::from(0u64)
            };
            let s = if i == 0 {
                Scalar::from(5_000_000u64)
            } else {
                Scalar::from(0u64)
            };
            let sa = if i == 0 {
                Scalar::from(123_456_789u64)
            } else {
                Scalar::from(0u64)
            };
            inputs.set_key(&SignalKey::new("employeeId").idx(i), scalar_to_bigint(e));
            inputs.set_key(&SignalKey::new("salaryAmount").idx(i), scalar_to_bigint(s));
            inputs.set_key(&SignalKey::new("salt").idx(i), scalar_to_bigint(sa));
            inputs.set_key(&SignalKey::new("pathIndices").idx(i), BigInt::from(0));
            for j in 0..LEVELS {
                inputs.set_key(
                    &SignalKey::new("pathElements").idx(i).idx(j),
                    scalar_to_bigint(Scalar::from(0u64)),
                );
            }
        }

        let res = prove_and_verify_with_keys(&wasm, &r1cs, &inputs, &keys)
            .expect("prove_and_verify_with_keys should not error");
        assert!(
            !res.verified,
            "invalid salary sum must be rejected (proof must not verify)"
        );
        Ok(())
    }

    /// Negative test: incorrect Merkle path → proof fails verification.
    ///
    /// T1.3: Invalid Merkle proof (all-zero path elements that don't match
    /// the employee root) must produce a proof that does not verify.
    #[test]
    #[ignore]
    fn test_payroll_invalid_merkle_path_rejected() -> Result<()> {
        let (wasm, r1cs) = load_artifacts("payroll_10_10")?;
        let keys = generate_keys(&wasm, &r1cs).context("generate_keys failed")?;

        let mut inputs = Inputs::new();
        inputs.set("employeeRoot", scalar_to_bigint(Scalar::from(1u64))); // non-zero root
        inputs.set(
            "totalPayrollAmount",
            scalar_to_bigint(Scalar::from(5_000_000u64)),
        );
        inputs.set("payrollPeriodId", BigInt::from(1));

        for i in 0..BATCH_SIZE {
            let e = if i == 0 {
                Scalar::from(42u64)
            } else {
                Scalar::from(0u64)
            };
            let s = if i == 0 {
                Scalar::from(5_000_000u64)
            } else {
                Scalar::from(0u64)
            };
            let sa = if i == 0 {
                Scalar::from(123_456_789u64)
            } else {
                Scalar::from(0u64)
            };
            inputs.set_key(&SignalKey::new("employeeId").idx(i), scalar_to_bigint(e));
            inputs.set_key(&SignalKey::new("salaryAmount").idx(i), scalar_to_bigint(s));
            inputs.set_key(&SignalKey::new("salt").idx(i), scalar_to_bigint(sa));
            inputs.set_key(&SignalKey::new("pathIndices").idx(i), BigInt::from(0));
            // All-zero path elements won't match any valid Merkle proof
            for j in 0..LEVELS {
                inputs.set_key(
                    &SignalKey::new("pathElements").idx(i).idx(j),
                    scalar_to_bigint(Scalar::from(0u64)),
                );
            }
        }

        let res = prove_and_verify_with_keys(&wasm, &r1cs, &inputs, &keys)
            .expect("prove_and_verify_with_keys should not error");
        assert!(
            !res.verified,
            "invalid Merkle path must be rejected (proof must not verify)"
        );
        Ok(())
    }
}
