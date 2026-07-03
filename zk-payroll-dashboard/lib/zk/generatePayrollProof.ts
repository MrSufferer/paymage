import type {
  GeneratedPayrollProof,
  PayrollPublicInputs,
  PayrollSecrets,
  ZkProofRequest,
} from "@/types";
import { zkEngine } from "./engine";
import { sha256Hex } from "./hash";
import { toSorobanScVals } from "./serialize";
import { createMockProver } from "./mockProver";

function normalizeRequired(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${fieldName} is required`);
  }

  return normalized;
}

function normalizeInputs(inputs: PayrollSecrets): {
  privateInputs: Record<string, string>;
  publicInputs: PayrollPublicInputs;
} {
  const publicInputs: PayrollPublicInputs = {
    merkleRoot: normalizeRequired(inputs.merkleRoot, "merkleRoot"),
    totalPayrollAmount: normalizeRequired(
      inputs.totalPayrollAmount,
      "totalPayrollAmount"
    ),
    payrollPeriodId: normalizeRequired(inputs.payrollPeriodId, "payrollPeriodId"),
  };

  return {
    privateInputs: {
      employeeId: normalizeRequired(inputs.employeeId, "employeeId"),
      employeeSsn: normalizeRequired(inputs.employeeSsn, "employeeSsn"),
      salaryAmount: normalizeRequired(inputs.salaryAmount, "salaryAmount"),
      salt: inputs.salt?.trim() || "default-salt",
    },
    publicInputs,
  };
}

export async function generatePayrollProof(
  inputs: PayrollSecrets
): Promise<GeneratedPayrollProof> {
  if (typeof window === "undefined") {
    throw new Error("generatePayrollProof must run in the browser");
  }

  const normalized = normalizeInputs(inputs);

  const [employeeIdHash, employeeSsnHash, salaryAmountHash, saltHash] =
    await Promise.all([
      sha256Hex(normalized.privateInputs.employeeId),
      sha256Hex(normalized.privateInputs.employeeSsn),
      sha256Hex(normalized.privateInputs.salaryAmount),
      sha256Hex(normalized.privateInputs.salt),
    ]);

  const request: ZkProofRequest = {
    privateInputs: {
      // Raw values (used by the real prover path — RealZkEngine).
      employeeId: normalized.privateInputs.employeeId,
      salaryAmount: normalized.privateInputs.salaryAmount,
      salt: normalized.privateInputs.salt,
      // Hashed variants (used by the mock prover path).
      employeeIdHash,
      employeeSsnHash,
      salaryAmountHash,
      saltHash,
    },
    publicInputs: normalized.publicInputs,
  };

  const proof = await zkEngine.generateProof(request);
  const verification = await zkEngine.verifyProof(proof, normalized.publicInputs);

  return {
    proof,
    publicInputs: normalized.publicInputs,
    sorobanArgs: toSorobanScVals(proof, normalized.publicInputs),
    verification,
  };
}

export async function generateDemoPayrollProof(
  inputs: PayrollSecrets
): Promise<GeneratedPayrollProof> {
  if (typeof window === "undefined") {
    throw new Error("generateDemoPayrollProof must run in the browser");
  }

  const normalized = normalizeInputs(inputs);

  const [employeeIdHash, employeeSsnHash, salaryAmountHash, saltHash] =
    await Promise.all([
      sha256Hex(normalized.privateInputs.employeeId),
      sha256Hex(normalized.privateInputs.employeeSsn),
      sha256Hex(normalized.privateInputs.salaryAmount),
      sha256Hex(normalized.privateInputs.salt),
    ]);

  const request: ZkProofRequest = {
    privateInputs: {
      employeeId: normalized.privateInputs.employeeId,
      salaryAmount: normalized.privateInputs.salaryAmount,
      salt: normalized.privateInputs.salt,
      employeeIdHash,
      employeeSsnHash,
      salaryAmountHash,
      saltHash,
    },
    publicInputs: normalized.publicInputs,
  };

  const prover = createMockProver();
  const artifacts = { verificationKey: null, circuitWasm: null };
  const proof = await prover.generateProof(request, artifacts);
  const isValid = await prover.verifyProof(
    proof,
    normalized.publicInputs,
    artifacts.verificationKey,
  );

  return {
    proof,
    publicInputs: normalized.publicInputs,
    sorobanArgs: toSorobanScVals(proof, normalized.publicInputs),
    verification: {
      isValid,
      verifiedAt: new Date().toISOString(),
      error: isValid ? undefined : "Mock proof verification failed",
    },
  };
}
