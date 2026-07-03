pragma circom 2.2.2;

// PayrollWithdraw — ZK salary withdrawal proof circuit
// Proves: employee knows the preimage to a salary commitment,
//         the commitment is in the employee Merkle tree,
//         commitmentId and nullifier are correctly derived,
//         no employee identity is revealed.
//
// Privacy note: salaryAmount is a PUBLIC input — the withdrawal amount is
// visible on-chain even though the employee's identity is hidden. This is
// a deliberate trade-off: the contract needs the amount to execute the
// USDC transfer. For full amount privacy, a confidential transfer pattern
// (e.g., range-proven amount hidden in a commitment) would be needed.
//
// Public inputs: [commitmentRoot, commitmentId, nullifier, salaryAmount]
// Private inputs: [employeeId, salaryAmount, salt, pathElements[levels], pathIndices]

include "./poseidon2/poseidon2_hash.circom";
include "./merkleProof.circom";
include "./circomlib/circuits/bitify.circom";

template PayrollWithdraw(levels) {
    // ═══════════════════════════════════════════════════════════════════
    // CONSTANTS
    // ═══════════════════════════════════════════════════════════════════

    var MAX_SALARY_BITS = 64;
    var PAYROLL_MAX_SALARY_BIT_LIMIT = 50;

    // Domain separation constants — must match the payroll deposit flow
    var DOMAIN_COMMITMENT = 0x01;    // Poseidon2(employeeId, salaryAmount, salt)
    var DOMAIN_COMMITMENT_ID = 0x02; // Poseidon2(commitment) → commitmentId
    var DOMAIN_NULLIFIER = 0x03;     // Poseidon2(commitment, salt) → nullifier

    // ═══════════════════════════════════════════════════════════════════
    // PUBLIC INPUTS
    // ═══════════════════════════════════════════════════════════════════

    // Employee Merkle root for this payroll period
    signal input commitmentRoot;

    // Commitment identifier — Poseidon2(commitment), used as key in contract's ipfsCids map
    signal input commitmentId;

    // Nullifier — Poseidon2(commitment, salt), prevents double-withdrawal
    signal input nullifier;

    // Salary amount being withdrawn — must match the committed amount
    signal input salaryAmount;

    // ═══════════════════════════════════════════════════════════════════
    // PRIVATE INPUTS
    // ═══════════════════════════════════════════════════════════════════

    // Employee identifier (hidden — enables private withdrawal)
    signal input employeeId;

    // Salary in stroops (constrained to equal public salaryAmount)
    signal input salaryAmountPrivate;

    // Random salt from deposit time (hidden)
    signal input salt;

    // Merkle proof: path elements and path indices
    signal input pathElements[levels];
    signal input pathIndices;

    // ═══════════════════════════════════════════════════════════════════
    // CONSTRAINT: private salaryAmountPrivate === public salaryAmount
    // ═══════════════════════════════════════════════════════════════════
    salaryAmountPrivate === salaryAmount;

    // ═══════════════════════════════════════════════════════════════════
    // COMMITMENT: commitment = Poseidon2(employeeId, salaryAmount, salt)
    // ═══════════════════════════════════════════════════════════════════
    component commitmentHasher = Poseidon2(3);
    commitmentHasher.inputs[0] <== employeeId;
    commitmentHasher.inputs[1] <== salaryAmount;
    commitmentHasher.inputs[2] <== salt;
    commitmentHasher.domainSeparation <== DOMAIN_COMMITMENT;

    // ═══════════════════════════════════════════════════════════════════
    // COMMITMENT ID: commitmentId === Poseidon2(commitment)
    // ═══════════════════════════════════════════════════════════════════
    component commitmentIdHasher = Poseidon2(1);
    commitmentIdHasher.inputs[0] <== commitmentHasher.out;
    commitmentIdHasher.domainSeparation <== DOMAIN_COMMITMENT_ID;
    commitmentId === commitmentIdHasher.out;

    // ═══════════════════════════════════════════════════════════════════
    // NULLIFIER: nullifier === Poseidon2(commitment, salt)
    // ═══════════════════════════════════════════════════════════════════
    component nullifierHasher = Poseidon2(2);
    nullifierHasher.inputs[0] <== commitmentHasher.out;
    nullifierHasher.inputs[1] <== salt;
    nullifierHasher.domainSeparation <== DOMAIN_NULLIFIER;
    nullifier === nullifierHasher.out;

    // ═══════════════════════════════════════════════════════════════════
    // RANGE CHECK: salaryAmount ∈ [0, 2^PAYROLL_MAX_SALARY_BIT_LIMIT)
    // ═══════════════════════════════════════════════════════════════════
    component num2Bits = Num2Bits(MAX_SALARY_BITS);
    num2Bits.in <== salaryAmount;
    for (var b = PAYROLL_MAX_SALARY_BIT_LIMIT; b < MAX_SALARY_BITS; b++) {
        num2Bits.out[b] === 0;
    }

    // ═══════════════════════════════════════════════════════════════════
    // MERKLE PROOF: commitment is in the employee tree
    // ═══════════════════════════════════════════════════════════════════
    component merkleProof = MerkleProof(levels);
    merkleProof.leaf <== commitmentHasher.out;
    merkleProof.pathIndices <== pathIndices;
    for (var j = 0; j < levels; j++) {
        merkleProof.pathElements[j] <== pathElements[j];
    }
    merkleProof.root === commitmentRoot;
}
