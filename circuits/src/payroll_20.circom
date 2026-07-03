pragma circom 2.2.2;

// Entry point: PayrollBatch with 20 levels (depth 20 = 1M leaf capacity)
// and max 500 employees per batch.
include "./payroll.circom";

component main {public [employeeRoot, totalPayrollAmount, payrollPeriodId]} = PayrollBatch(20, 500);
