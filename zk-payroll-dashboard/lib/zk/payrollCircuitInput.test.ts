import { describe, expect, it } from "vitest";
import { buildPayrollCircuitInput } from "./payrollCircuitInput";

describe("buildPayrollCircuitInput", () => {
  it("normalizes hex tree values to decimal circom inputs", () => {
    const parsed = JSON.parse(
      buildPayrollCircuitInput({
        employeeRoot: "0x0a",
        totalPayrollAmount: "5000000",
        payrollPeriodId: "1",
        leaves: [
          {
            employeeId: "42",
            salaryAmount: "5000000",
            salt: "123",
            pathElements: ["0f", "10"],
            pathIndices: "0",
          },
        ],
      }),
    );

    expect(parsed).toEqual({
      employeeRoot: "10",
      totalPayrollAmount: "5000000",
      payrollPeriodId: "1",
      employeeId: ["42"],
      salaryAmount: ["5000000"],
      salt: ["123"],
      pathElements: [["15", "16"]],
      pathIndices: ["0"],
    });
  });

  it("rejects empty Merkle paths before calling a prover", () => {
    expect(() =>
      buildPayrollCircuitInput({
        employeeRoot: "1",
        totalPayrollAmount: "1",
        payrollPeriodId: "1",
        leaves: [
          {
            employeeId: "1",
            salaryAmount: "1",
            salt: "1",
            pathElements: [],
            pathIndices: "0",
          },
        ],
      }),
    ).toThrow(/pathElements empty/);
  });
});
