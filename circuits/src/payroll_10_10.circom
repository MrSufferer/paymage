pragma circom 2.2.2;

// Entry point: PayrollBatch with 10 levels (depth 10 = 1K leaf capacity)
// and max 10 employees per batch.
//
// Browser-optimised variant — produces ~23.6K constraints, ~11 MB PK,
// ~0.8 MB witness. Sub-5s proving in browser WASM.
// The production variant (payroll_20) supports 500 employees / 1M leaves
// for server-side proving.
include "./payroll.circom";

component main {public [employeeRoot, totalPayrollAmount, payrollPeriodId]} = PayrollBatch(10, 10);
