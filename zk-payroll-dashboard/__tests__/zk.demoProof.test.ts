import { afterEach, describe, expect, it, vi } from "vitest";

describe("demo payroll proof generation", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("generates a mock proof without fetching real ZK artifacts", async () => {
    vi.stubEnv("NEXT_PUBLIC_ZK_ENGINE", "real");
    globalThis.fetch = vi.fn(async () => {
      throw new Error("artifact server unavailable");
    }) as typeof fetch;

    const { generateDemoPayrollProof } = await import("@/lib/zk/generatePayrollProof");

    const result = await generateDemoPayrollProof({
      merkleRoot: "0xmock_merkle_root",
      totalPayrollAmount: "124500",
      payrollPeriodId: "2026-02",
      employeeId: "emp-001",
      employeeSsn: "111-22-3333",
      salaryAmount: "8500",
      salt: "dashboard-demo-salt",
    });

    expect(result.verification.isValid).toBe(true);
    expect(result.proof.proof.scheme).toBe("mock");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
