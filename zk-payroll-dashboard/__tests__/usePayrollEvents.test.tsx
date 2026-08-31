import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { usePayrollEvents } from "@/hooks/usePayrollEvents";
import type { PayrollEventsRpc } from "@/lib/stellar/events";

describe("usePayrollEvents", () => {
  it("polls the RPC on the configured interval", async () => {
    vi.useFakeTimers();
    const rpc: PayrollEventsRpc = {
      getEvents: vi.fn().mockResolvedValue({ events: [], cursor: "" }),
    };

    try {
      renderHook(() =>
        usePayrollEvents({ rpc, startLedger: 7, pollInterval: 5000 }),
      );

      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(rpc.getEvents).toHaveBeenCalledTimes(1);
      expect(rpc.getEvents).toHaveBeenCalledWith(
        expect.objectContaining({ startLedger: 7 }),
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });

      expect(rpc.getEvents).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
