import { describe, expect, it, vi } from "vitest";

function simpleHash(input: string): string {
  let h = BigInt(0);
  const mod = BigInt(1) << BigInt(256);
  for (let i = 0; i < input.length; i++) {
    h = (h * BigInt(31) + BigInt(input.charCodeAt(i))) % mod;
  }
  return h.toString(16).padStart(64, "0");
}

vi.mock("./wasm/poseidon/poseidon_wasm.js", () => ({
  default: vi.fn(async () => {}),
  poseidon2_commitment: vi.fn((emp: string, sal: string, salt: string, ds: string) =>
    simpleHash(`M:${emp}:${sal}:${salt}:${ds}`),
  ),
  poseidon2_commitment_id: vi.fn((commitment: string, ds: string) =>
    simpleHash(`ID:${commitment}:${ds}`),
  ),
  poseidon2_compress: vi.fn((l: string, r: string) => simpleHash(`C:${l}:${r}`)),
  version: vi.fn(() => "test-mock"),
}));

import {
  buildPayrollSlots,
  buildZkProofPrivateInputs,
  computeCommitmentId,
  employeeIdToFieldElement,
  employeeSaltToFieldElement,
} from "./payrollInputs";
import { computeCommitment } from "./merkleTree";

describe("payroll input preparation", () => {
  it("maps app employee ids to stable decimal field elements", async () => {
    const first = await employeeIdToFieldElement("emp_001");
    const second = await employeeIdToFieldElement("emp_001");
    const other = await employeeIdToFieldElement("emp_002");

    expect(first).toMatch(/^[0-9]+$/);
    expect(first).toBe(second);
    expect(first).not.toBe(other);
  });

  it("preserves generated salts in the real proof private input lists", async () => {
    const slots = await buildPayrollSlots(
      [
        { id: "emp_001", salary: 125_000 },
        { id: "emp_002", salary: 130_000 },
      ],
      (index) => BigInt(index + 10),
    );

    expect(slots.map((slot) => slot.salt)).toEqual(["10", "11"]);
    expect(buildZkProofPrivateInputs(slots)).toEqual({
      employeeId: `${slots[0].employeeId},${slots[1].employeeId}`,
      salaryAmount: "125000,130000",
      salt: "10,11",
    });
  });

  it("derives stable default salts so employee roots are reproducible", async () => {
    const first = await employeeSaltToFieldElement("emp_001", 125_000);
    const second = await employeeSaltToFieldElement("emp_001", 125_000);
    const otherSalary = await employeeSaltToFieldElement("emp_001", 130_000);
    const slotsA = await buildPayrollSlots([{ id: "emp_001", salary: 125_000 }]);
    const slotsB = await buildPayrollSlots([{ id: "emp_001", salary: 125_000 }]);

    expect(first).toMatch(/^[0-9]+$/);
    expect(first).toBe(second);
    expect(first).not.toBe(otherSalary);
    expect(slotsA[0].salt).toBe(first);
    expect(slotsB[0].salt).toBe(first);
  });

  it("derives commitment ids with the withdraw circuit commitment-id domain", async () => {
    const commitment = await computeCommitment("1", "500", "7");
    const commitmentId = await computeCommitmentId(commitment);

    expect(commitmentId).toBe(simpleHash(`ID:${commitment}:${"2".padStart(64, "0")}`));
    expect(commitmentId).not.toBe(commitment);
  });
});
