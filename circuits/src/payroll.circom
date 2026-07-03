pragma circom 2.2.2;

// PayrollBatch — ZK payroll batch proof circuit
// Proves: employer paid n employees, sum of salaries equals totalPayrollAmount,
//         each employee is in the Merkle tree, no individual salaries revealed.

include "./poseidon2/poseidon2_hash.circom";
include "./merkleProof.circom";
include "./circomlib/circuits/bitify.circom";

// PayrollBatch(levels, n)
// levels: Merkle tree depth (20 = 1M leaf capacity)
// n: max employees per batch (500 per design spec)
template PayrollBatch(levels, n) {
    // ═══════════════════════════════════════════════════════════════════
    // CONSTANTS (inside template body for Circom 2.x compatibility)
    // ═══════════════════════════════════════════════════════════════════

    // MAX_SALARY: 10^15 covers all USDC amounts (USDC has 7 decimals, 10^15 stroops = 100M USDC)
    // BN254 scalar field: ~2^254 >> 10^15
    // Num2Bits decomposes into MAX_SALARY_BITS bits; bits [PAYROLL_MAX_SALARY_BIT_LIMIT, MAX_SALARY_BITS)
    // are constrained to zero, ensuring salaryAmount < 2^PAYROLL_MAX_SALARY_BIT_LIMIT.
    var MAX_SALARY_BITS = 64;
    var PAYROLL_MAX_SALARY_BIT_LIMIT = 50;

    // Commitment domain separation for Poseidon2
    var DOMAIN_COMMITMENT = 0x01;

    // ═══════════════════════════════════════════════════════════════════
    // PUBLIC INPUTS
    // ═══════════════════════════════════════════════════════════════════

    // Employee Merkle root — employer posts this to contract via set_employee_root()
    signal input employeeRoot;

    // Total payroll amount in stroops (1 USDC = 10^7 stroops)
    signal input totalPayrollAmount;

    // Monotonic period counter — prevents replay attacks
    signal input payrollPeriodId;

    // ═══════════════════════════════════════════════════════════════════
    // PRIVATE INPUTS — per employee slot
    // ═══════════════════════════════════════════════════════════════════

    // Per-employee inputs
    signal input employeeId[n];        // Employee identifier
    signal input salaryAmount[n];      // Salary in stroops
    signal input salt[n];              // Random salt (32 bytes)
    signal input pathElements[n][levels]; // Merkle proof path elements
    signal input pathIndices[n];       // Merkle proof path indices (bitmask)

    // ═══════════════════════════════════════════════════════════════════
    // COMPONENTS
    // ═══════════════════════════════════════════════════════════════════

    component commitmentHasher[n];
    component merkleProof[n];
    component num2Bits[n];

    var totalSalaryComputed = 0;

    for (var i = 0; i < n; i++) {
        // ─── Commitment ───────────────────────────────────────────────
        // commitment = Poseidon2(employeeId, salaryAmount, salt)
        commitmentHasher[i] = Poseidon2(3);
        commitmentHasher[i].inputs[0] <== employeeId[i];
        commitmentHasher[i].inputs[1] <== salaryAmount[i];
        commitmentHasher[i].inputs[2] <== salt[i];
        commitmentHasher[i].domainSeparation <== DOMAIN_COMMITMENT;

        // ─── Range check: salaryAmount ∈ [0, MAX_SALARY] ──────────────
        // Use binary decomposition to constrain the range
        num2Bits[i] = Num2Bits(MAX_SALARY_BITS);
        num2Bits[i].in <== salaryAmount[i];

        // All bits beyond PAYROLL_MAX_SALARY_BIT_LIMIT must be zero
        // This ensures salaryAmount < 2^50 ~ 1.12e15 > 10^15 (MAX_SALARY)
        for (var b = PAYROLL_MAX_SALARY_BIT_LIMIT; b < MAX_SALARY_BITS; b++) {
            num2Bits[i].out[b] === 0;
        }

        // ─── Merkle proof: commitment is in the employee tree ─────────
        merkleProof[i] = MerkleProof(levels);
        merkleProof[i].leaf <== commitmentHasher[i].out;
        merkleProof[i].pathIndices <== pathIndices[i];
        for (var j = 0; j < levels; j++) {
            merkleProof[i].pathElements[j] <== pathElements[i][j];
        }
        merkleProof[i].root === employeeRoot;

        // ─── Sum of salaries (linear constraint) ─────────────────────
        totalSalaryComputed += salaryAmount[i];
    }

    // ─── Sum check: Σ salaryAmount[i] === totalPayrollAmount ─────────
    // This is a linear constraint that sums all salaries (padding slots add zero)
    totalSalaryComputed === totalPayrollAmount;
}
