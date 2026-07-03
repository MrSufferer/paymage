pragma circom 2.2.2;

// Entry point: PayrollWithdraw with 10 levels (depth 10 = 1K leaf capacity).
// Single-commitment withdrawal proof for browser-based proving.
include "./payrollWithdraw.circom";

component main {public [commitmentRoot, commitmentId, nullifier, salaryAmount]} = PayrollWithdraw(10);
