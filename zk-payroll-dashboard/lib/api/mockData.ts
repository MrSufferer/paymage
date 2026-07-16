import {
  PAYMAGE_COMPANY,
  PAYMAGE_PROTOCOL_TRANSACTIONS,
  PAYMAGE_TESTNET_EMPLOYEES,
  PAYMAGE_VIEW_KEYS,
} from "@/lib/protocol/paymage";

export const MOCK_EMPLOYEES = PAYMAGE_TESTNET_EMPLOYEES;
export const MOCK_COMPANIES = [PAYMAGE_COMPANY];
export const MOCK_TRANSACTIONS = PAYMAGE_PROTOCOL_TRANSACTIONS;
export const MOCK_PAYROLL_RUNS = PAYMAGE_PROTOCOL_TRANSACTIONS.map((tx) => ({
  ...tx,
  employeeIds: PAYMAGE_TESTNET_EMPLOYEES.map((employee) => employee.id),
  executedAt: tx.status === "verified" ? tx.timestamp : null,
  transactionHash: tx.txHash || null,
}));
export const MOCK_TREASURY_BALANCE = {
  balance: 0,
  projectedPayroll: 500_000,
  lastFunded: "2026-07-16T05:04:00Z",
};
export const MOCK_VIEW_KEYS = PAYMAGE_VIEW_KEYS;
