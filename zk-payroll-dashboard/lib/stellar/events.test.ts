import { xdr } from "@stellar/stellar-sdk";
import { describe, expect, it, vi } from "vitest";
import {
  PAYROLL_CONTRACT_ID,
  fetchPayrollEvents,
  type PayrollEventsRpc,
} from "./events";

describe("payroll event polling", () => {
  it("requests both payroll event topics and normalizes successful events", async () => {
    const rpc: PayrollEventsRpc = {
      getEvents: vi.fn().mockResolvedValue({
        events: [
          {
            id: "event-1",
            type: "contract",
            ledger: 321,
            ledgerClosedAt: "2026-08-31T06:00:00Z",
            transactionIndex: 0,
            operationIndex: 0,
            inSuccessfulContractCall: true,
            txHash: "abc123",
            contractId: PAYROLL_CONTRACT_ID,
            topic: [xdr.ScVal.scvSymbol("PayrollVerifiedEvent")],
            value: xdr.ScVal.scvVoid(),
          },
        ],
        cursor: "",
      }),
    };

    const transactions = await fetchPayrollEvents(rpc, { startLedger: 42 });
    const request = vi.mocked(rpc.getEvents).mock.calls[0][0];

    expect(request.startLedger).toBe(42);
    expect(request.filters).toHaveLength(2);
    expect(request.filters[0].topics?.[0][0]).toBe(
      xdr.ScVal.scvSymbol("PayrollVerifiedEvent").toXDR("base64"),
    );
    expect(request.filters[1].topics?.[0][0]).toBe(
      xdr.ScVal.scvSymbol("WithdrawalEvent").toXDR("base64"),
    );
    expect(transactions).toHaveLength(1);
    expect(transactions[0]).toMatchObject({
      id: "event-1",
      txHash: "abc123",
      status: "verified",
      eventType: "PayrollVerifiedEvent",
    });
  });

  it("skips events outside the payroll contract and failed calls", async () => {
    const rpc: PayrollEventsRpc = {
      getEvents: vi.fn().mockResolvedValue({
        events: [
          {
            id: "event-ignored",
            type: "contract",
            ledger: 321,
            ledgerClosedAt: "2026-08-31T06:00:00Z",
            transactionIndex: 0,
            operationIndex: 0,
            inSuccessfulContractCall: false,
            txHash: "ignored",
            contractId: "COTHER",
            topic: [xdr.ScVal.scvSymbol("WithdrawalEvent")],
            value: xdr.ScVal.scvVoid(),
          },
        ],
        cursor: "",
      }),
    };

    await expect(fetchPayrollEvents(rpc)).resolves.toEqual([]);
  });
});
