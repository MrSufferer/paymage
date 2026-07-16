import type { EmployeeSlot } from "./merkleTree";

const BN254_FR_MODULUS = BigInt(
  "21888242871839275222246405745257275088548364400416034343698204186575808495617",
);

const DS_COMMITMENT_ID = "2".padStart(64, "0");

type PayrollEmployeeInput = {
  id: string;
  salary: number;
};

export type PayrollSlot = EmployeeSlot & {
  sourceEmployeeId: string;
};

function bytesToBigInt(bytes: Uint8Array): bigint {
  let value = BigInt(0);
  for (let i = 0; i < bytes.length; i++) {
    value = (value << BigInt(8)) | BigInt(bytes[i]);
  }
  return value;
}

function decimalToFieldElement(value: string): string | null {
  if (!/^[0-9]+$/.test(value)) {
    return null;
  }
  const parsed = BigInt(value);
  if (parsed >= BN254_FR_MODULUS) {
    throw new Error(`Employee id exceeds BN254 field modulus: ${value}`);
  }
  return parsed.toString();
}

function getCrypto(): Crypto {
  if (!globalThis.crypto?.subtle) {
    throw new Error("Web Crypto API is required to derive payroll field ids");
  }
  return globalThis.crypto;
}

export async function employeeIdToFieldElement(employeeId: string): Promise<string> {
  const decimal = decimalToFieldElement(employeeId);
  if (decimal !== null) {
    return decimal;
  }

  const digest = await getCrypto().subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`zk-payroll:employee-id:${employeeId}`),
  );
  return (bytesToBigInt(new Uint8Array(digest)) % BN254_FR_MODULUS).toString();
}

export async function employeeSaltToFieldElement(
  employeeId: string,
  salary: number,
): Promise<string> {
  const digest = await getCrypto().subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`zk-payroll:salary-salt:${employeeId}:${salary}`),
  );
  return (bytesToBigInt(new Uint8Array(digest)) % BN254_FR_MODULUS).toString();
}

export async function buildPayrollSlots(
  employees: PayrollEmployeeInput[],
  saltForIndex?: (index: number) => bigint,
): Promise<PayrollSlot[]> {
  return Promise.all(
    employees.map(async (employee, index) => {
      const salt = saltForIndex
        ? saltForIndex(index).toString()
        : await employeeSaltToFieldElement(employee.id, employee.salary);

      return {
        sourceEmployeeId: employee.id,
        employeeId: await employeeIdToFieldElement(employee.id),
        salaryAmount: employee.salary.toString(),
        salt,
      };
    }),
  );
}

export function buildZkProofPrivateInputs(slots: PayrollSlot[]): Record<string, string> {
  return {
    employeeId: slots.map((slot) => slot.employeeId).join(","),
    salaryAmount: slots.map((slot) => slot.salaryAmount).join(","),
    salt: slots.map((slot) => slot.salt).join(","),
  };
}

export async function computeCommitmentId(commitment: string): Promise<string> {
  const wasm = await import("./wasm/poseidon/poseidon_wasm.js");
  await wasm.default();
  return wasm.poseidon2_commitment_id(commitment.replace(/^0x/i, ""), DS_COMMITMENT_ID);
}
