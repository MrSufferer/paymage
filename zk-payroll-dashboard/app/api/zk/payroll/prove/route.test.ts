import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const validBody = {
  inputsJson: JSON.stringify({
    employeeRoot: "10",
    totalPayrollAmount: "5000000",
    payrollPeriodId: "1",
  }),
  publicInputs: {
    merkleRoot: "0a".padStart(64, "0"),
    totalPayrollAmount: "5000000",
    payrollPeriodId: "1",
  },
};

describe("POST /api/zk/payroll/prove", () => {
  afterEach(() => {
    delete process.env.PAYROLL_PROVER_URL;
    delete process.env.PAYROLL_PROVER_TOKEN;
    vi.restoreAllMocks();
  });

  it("returns 503 when no native prover URL is configured", async () => {
    const response = await POST(
      new Request("http://localhost/api/zk/payroll/prove", {
        method: "POST",
        body: JSON.stringify(validBody),
      }),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: { code: "PROVER_NOT_CONFIGURED" },
    });
  });

  it("forwards valid circuit input to the configured prover", async () => {
    process.env.PAYROLL_PROVER_URL = "http://127.0.0.1:8787/prove";
    const proofHex = "ab".repeat(256);
    const publicInputsHex = ["01", "02", "03"].map((value) => value.padStart(64, "0"));
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ proofHex, publicInputsHex }),
    }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const response = await POST(
      new Request("http://localhost/api/zk/payroll/prove", {
        method: "POST",
        body: JSON.stringify(validBody),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: { proofHex, publicInputsHex },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8787/prove",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("rejects mismatched public input semantics before calling the prover", async () => {
    process.env.PAYROLL_PROVER_URL = "http://127.0.0.1:8787/prove";
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const response = await POST(
      new Request("http://localhost/api/zk/payroll/prove", {
        method: "POST",
        body: JSON.stringify({
          ...validBody,
          publicInputs: { ...validBody.publicInputs, totalPayrollAmount: "999" },
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
