#[cfg(test)]
mod tests {
    use crate::test::utils::circom_tester::{
        Inputs, SignalKey, generate_keys, prove_and_verify_with_keys,
    };
    use crate::test::utils::general::load_artifacts;
    use crate::test::utils::general::scalar_to_bigint;
    use anyhow::{Context, Result};
    use num_bigint::BigInt;
    use std::panic;
    use zkhash::fields::bn256::FpBN256 as Scalar;

    const LEVELS: usize = 10;
    const BATCH_SIZE: usize = 10;

    /// Negative test: salary sum != totalPayrollAmount → build() panics.
    ///
    /// T1.2: Invalid sum (sum of salaryAmounts ≠ totalPayrollAmount) must
    /// fail at constraint-check time.
    #[test]
    #[ignore]
    fn test_payroll_invalid_sum_rejected() -> Result<()> {
        let (wasm, r1cs) = load_artifacts("payroll_10_10")?;
        let keys = generate_keys(&wasm, &r1cs).context("generate_keys failed")?;

        let mut inputs = Inputs::new();
        inputs.set("employeeRoot", &scalar_to_bigint(Scalar::from(0u64)));
        // total=9999999 but only one employee with salary=5000000 → sum mismatch
        inputs.set(
            "totalPayrollAmount",
            &scalar_to_bigint(Scalar::from(9_999_999u64)),
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
            inputs.set_key(&SignalKey::new("employeeId").idx(i), &scalar_to_bigint(e));
            inputs.set_key(&SignalKey::new("salaryAmount").idx(i), &scalar_to_bigint(s));
            inputs.set_key(&SignalKey::new("salt").idx(i), &scalar_to_bigint(sa));
            inputs.set_key(&SignalKey::new("pathIndices").idx(i), BigInt::from(0));
            for j in 0..LEVELS {
                inputs.set_key(
                    &SignalKey::new("pathElements").idx(i).idx(j),
                    &scalar_to_bigint(Scalar::from(0u64)),
                );
            }
        }

        let result = panic::catch_unwind(panic::AssertUnwindSafe(|| {
            prove_and_verify_with_keys(&wasm, &r1cs, &inputs, &keys)
        }));

        assert!(
            result.is_err(),
            "build() should panic when salary sum ≠ totalPayrollAmount"
        );
        Ok(())
    }

    /// Negative test: incorrect Merkle path → build() panics.
    ///
    /// T1.3: Invalid Merkle proof (all-zero path elements that don't match
    /// the employee root) must fail at constraint-check time.
    #[test]
    #[ignore]
    fn test_payroll_invalid_merkle_path_rejected() -> Result<()> {
        let (wasm, r1cs) = load_artifacts("payroll_10_10")?;
        let keys = generate_keys(&wasm, &r1cs).context("generate_keys failed")?;

        let mut inputs = Inputs::new();
        inputs.set("employeeRoot", &scalar_to_bigint(Scalar::from(1u64))); // non-zero root
        inputs.set(
            "totalPayrollAmount",
            &scalar_to_bigint(Scalar::from(5_000_000u64)),
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
            inputs.set_key(&SignalKey::new("employeeId").idx(i), &scalar_to_bigint(e));
            inputs.set_key(&SignalKey::new("salaryAmount").idx(i), &scalar_to_bigint(s));
            inputs.set_key(&SignalKey::new("salt").idx(i), &scalar_to_bigint(sa));
            inputs.set_key(&SignalKey::new("pathIndices").idx(i), BigInt::from(0));
            // All-zero path elements won't match any valid Merkle proof
            for j in 0..LEVELS {
                inputs.set_key(
                    &SignalKey::new("pathElements").idx(i).idx(j),
                    &scalar_to_bigint(Scalar::from(0u64)),
                );
            }
        }

        let result = panic::catch_unwind(panic::AssertUnwindSafe(|| {
            prove_and_verify_with_keys(&wasm, &r1cs, &inputs, &keys)
        }));

        assert!(
            result.is_err(),
            "build() should panic when Merkle path doesn't match the root"
        );
        Ok(())
    }
}
