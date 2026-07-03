import { RealProver } from "./realProver";

/**
 * Input for the PayrollWithdraw(10) circuit.
 *
 * commitmentId and nullifier are computed by the circuit from private inputs
 * (employeeId, salaryAmount, salt) and constrained to equal the public inputs.
 * The caller does NOT provide them — the witness calculator computes them.
 */
export interface WithdrawProofInput {
  commitmentRoot: string;
  employeeId: string;
  salaryAmount: string;
  salt: string;
  pathElements: string[];
  pathIndices: string;
}

/**
 * Result of generating a withdraw proof.
 */
export interface GeneratedWithdrawProof {
  proofHex: string;
  publicInputsHex: string[];
}

/**
 * Build the JSON circuit input for PayrollWithdraw(10).
 * Signal names must match circuits/src/payrollWithdraw.circom.
 *
 * commitmentId and nullifier are NOT included — they are public inputs
 * constrained by the circuit. The witness calculator computes them from
 * the private inputs (employeeId, salaryAmount, salt).
 */
function buildWithdrawCircuitInput(input: WithdrawProofInput): string {
  const json = {
    commitmentRoot: input.commitmentRoot,
    salaryAmount: input.salaryAmount,
    employeeId: input.employeeId,
    salaryAmountPrivate: input.salaryAmount,
    salt: input.salt,
    pathElements: input.pathElements,
    pathIndices: input.pathIndices,
  };
  return JSON.stringify(json);
}

/**
 * Generate a PayrollWithdraw ZK proof in the browser.
 *
 * Uses a RealProver configured for the "withdraw" circuit (PayrollWithdraw(10)),
 * which loads the withdraw proving key (~1.1 MB), R1CS (~759 KB), and WASM (~466 KB).
 */
export async function generateWithdrawProof(
  input: WithdrawProofInput
): Promise<GeneratedWithdrawProof> {
  const inputsJson = buildWithdrawCircuitInput(input);

  const prover = new RealProver("withdraw");
  await prover.init();
  const result = await prover.prove(inputsJson);
  return {
    proofHex: result.proofHex,
    publicInputsHex: result.publicInputsHex,
  };
}
