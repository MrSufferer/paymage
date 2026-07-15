import type { ZkProofRequest } from "@/types";
import { buildMerkleTree, type EmployeeSlot } from "./merkleTree";

export interface PayrollBatchSlot {
  employeeId: string;
  salaryAmount: string;
  salt: string;
  /** `levels` Merkle proof path elements, as 32-byte hex strings. */
  pathElements: string[];
  /** Bitmask of left/right turns, as a decimal string. */
  pathIndices: string;
}

export interface PayrollBatchInput {
  /** Public inputs. `employeeRoot` may be a 32-byte hex string or decimal string. */
  employeeRoot: string;
  totalPayrollAmount: string;
  payrollPeriodId: string;
  /** Private inputs, one slot per employee, padded to the circuit batch size. */
  leaves: PayrollBatchSlot[];
}

function fieldStringToDecimal(value: string, mode: "auto" | "hex" = "auto"): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("empty field element");
  }

  const hex = trimmed.replace(/^0x/i, "");
  if (mode === "hex") {
    if (!/^[0-9a-fA-F]+$/.test(hex)) {
      throw new Error(`invalid hex field element: ${value}`);
    }
    return BigInt(`0x${hex}`).toString(10);
  }

  if (/^[0-9a-fA-F]+$/.test(hex) && /[a-fA-F]/.test(hex)) {
    return BigInt(`0x${hex}`).toString(10);
  }

  if (/^0x[0-9a-fA-F]+$/i.test(trimmed)) {
    return BigInt(trimmed).toString(10);
  }

  if (/^[0-9]+$/.test(trimmed)) {
    return trimmed;
  }

  throw new Error(`invalid field element: ${value}`);
}

/**
 * Serialize a `PayrollBatchInput` to the JSON shape circom expects.
 *
 * The browser Merkle builder works with 32-byte hex strings, while the native
 * E2E and circom witness calculator use decimal strings. Normalize roots and
 * path elements here so all proof backends prove the same circuit input.
 */
export function buildPayrollCircuitInput(input: PayrollBatchInput): string {
  if (input.leaves.length === 0) {
    throw new Error("PayrollBatchInput.leaves must not be empty");
  }

  for (const leaf of input.leaves) {
    if (leaf.pathElements.length === 0) {
      throw new Error(
        "pathElements empty — build the Poseidon2 employee Merkle tree before proving",
      );
    }
  }

  const inputsJson = {
    employeeRoot: fieldStringToDecimal(input.employeeRoot, "hex"),
    totalPayrollAmount: fieldStringToDecimal(input.totalPayrollAmount),
    payrollPeriodId: fieldStringToDecimal(input.payrollPeriodId),
    employeeId: input.leaves.map((leaf) => fieldStringToDecimal(leaf.employeeId)),
    salaryAmount: input.leaves.map((leaf) => fieldStringToDecimal(leaf.salaryAmount)),
    salt: input.leaves.map((leaf) => fieldStringToDecimal(leaf.salt)),
    pathElements: input.leaves.map((leaf) =>
      leaf.pathElements.map((pathElement) => fieldStringToDecimal(pathElement, "hex")),
    ),
    pathIndices: input.leaves.map((leaf) => fieldStringToDecimal(leaf.pathIndices)),
  };

  return JSON.stringify(inputsJson);
}

export async function buildPayrollCircuitInputFromProofRequest(
  request: ZkProofRequest,
): Promise<string> {
  const employeeIds = (request.privateInputs.employeeId ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  const salaryAmounts = (request.privateInputs.salaryAmount ?? "")
    .split(",")
    .map((value) => value.trim());
  const salts = (request.privateInputs.salt ?? "")
    .split(",")
    .map((value) => value.trim());

  if (employeeIds.length === 0) {
    throw new Error("At least one employee is required for payroll proving");
  }
  if (salaryAmounts.length !== employeeIds.length) {
    throw new Error(
      `employeeId (${employeeIds.length}) and salaryAmount (${salaryAmounts.length}) count mismatch`,
    );
  }

  const employees: EmployeeSlot[] = employeeIds.map((employeeId, index) => ({
    employeeId,
    salaryAmount: salaryAmounts[index] ?? "0",
    salt: salts[index] ?? "0",
  }));

  const tree = await buildMerkleTree(employees, 10, 10);
  if (tree.root !== request.publicInputs.merkleRoot) {
    throw new Error(
      `Merkle root mismatch: tree=${tree.root.slice(0, 16)}... request=${request.publicInputs.merkleRoot.slice(0, 16)}...`,
    );
  }

  return buildPayrollCircuitInput({
    employeeRoot: tree.root,
    totalPayrollAmount: request.publicInputs.totalPayrollAmount,
    payrollPeriodId: request.publicInputs.payrollPeriodId,
    leaves: tree.proofs.map((proof, index) => ({
      employeeId: index < tree.actualEmployeeCount ? employees[index].employeeId : "0",
      salaryAmount: index < tree.actualEmployeeCount ? employees[index].salaryAmount : "0",
      salt: index < tree.actualEmployeeCount ? employees[index].salt : "0",
      pathElements: proof.pathElements,
      pathIndices: proof.pathIndices,
    })),
  });
}
