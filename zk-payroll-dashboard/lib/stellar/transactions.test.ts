import { describe, expect, it, vi } from "vitest";
import {
  submitAndConfirmSorobanTransaction,
  waitForSorobanTransaction,
} from "./transactions";

describe("Soroban transaction confirmation", () => {
  it("polls until the transaction succeeds", async () => {
    const server = {
      getTransaction: vi
        .fn()
        .mockResolvedValueOnce({ status: "NOT_FOUND" })
        .mockResolvedValueOnce({ status: "SUCCESS", returnValue: "ok" }),
    };

    const result = await waitForSorobanTransaction(server, "abc", {
      maxAttempts: 2,
      pollMs: 0,
    });

    expect(result.status).toBe("SUCCESS");
    expect(server.getTransaction).toHaveBeenCalledTimes(2);
  });

  it("throws when confirmation returns a failed status", async () => {
    const server = {
      getTransaction: vi.fn().mockResolvedValue({ status: "FAILED" }),
    };

    await expect(
      waitForSorobanTransaction(server, "abc", { maxAttempts: 1, pollMs: 0 }),
    ).rejects.toThrow("failed with status FAILED");
  });

  it("submits and returns only after confirmation succeeds", async () => {
    const server = {
      sendTransaction: vi.fn().mockResolvedValue({ status: "PENDING", hash: "abc" }),
      getTransaction: vi.fn().mockResolvedValue({ status: "SUCCESS" }),
    };

    const result = await submitAndConfirmSorobanTransaction(server, "tx", {
      maxAttempts: 1,
      pollMs: 0,
    });

    expect(result.hash).toBe("abc");
    expect(server.sendTransaction).toHaveBeenCalledWith("tx");
  });
});
