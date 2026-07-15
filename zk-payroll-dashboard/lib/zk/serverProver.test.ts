import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildMerkleTree } from "./merkleTree";
import { requestServerPayrollProof } from "./serverProver";

vi.mock("./wasm/poseidon/poseidon_wasm.js", () => ({
  default: vi.fn(async () => undefined),
  poseidon2_commitment: vi.fn((emp: string, sal: string, salt: string) =>
    `${emp}${sal}${salt}`.slice(0, 64).padStart(64, "0"),
  ),
  poseidon2_compress: vi.fn((left: string, right: string) =>
    (BigInt(`0x${left}`) + BigInt(`0x${right}`)).toString(16).padStart(64, "0"),
  ),
  version: vi.fn(() => "test"),
}));

const proofHex = "ab".repeat(256);
const publicInputsHex = ["01", "02", "03"].map((value) => value.padStart(64, "0"));

describe("requestServerPayrollProof", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("posts normalized circuit inputs to the prover API", async () => {
    const tree = await buildMerkleTree([
      { employeeId: "42", salaryAmount: "5000000", salt: "123" },
    ]);
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      const inputs = JSON.parse(body.inputsJson);
      expect(inputs.employeeId).toEqual(["42", "0", "0", "0", "0", "0", "0", "0", "0", "0"]);
      expect(inputs.salaryAmount[0]).toBe("5000000");
      expect(inputs.salt[0]).toBe("123");

      return {
        ok: true,
        json: async () => ({
          success: true,
          data: { proofHex, publicInputsHex, proverVersion: "native-test" },
        }),
      } as Response;
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const result = await requestServerPayrollProof({
      privateInputs: {
        employeeId: "42",
        salaryAmount: "5000000",
        salt: "123",
      },
      publicInputs: {
        merkleRoot: tree.root,
        totalPayrollAmount: "5000000",
        payrollPeriodId: "1",
      },
    });

    expect(result).toEqual({ proofHex, publicInputsHex, proverVersion: "native-test" });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/zk/payroll/prove",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("surfaces API errors", async () => {
    const tree = await buildMerkleTree([
      { employeeId: "42", salaryAmount: "1", salt: "1" },
    ]);
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      json: async () => ({
        success: false,
        error: { message: "PAYROLL_PROVER_URL is not configured" },
      }),
    })) as unknown as typeof fetch;

    await expect(
      requestServerPayrollProof({
        privateInputs: { employeeId: "42", salaryAmount: "1", salt: "1" },
        publicInputs: {
          merkleRoot: tree.root,
          totalPayrollAmount: "1",
          payrollPeriodId: "1",
        },
      }),
    ).rejects.toThrow(/PAYROLL_PROVER_URL/);
  });
});
