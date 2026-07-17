import type { PayrollTransaction } from "@/types/models";

export function eventLabel(tx: PayrollTransaction): string {
  switch (tx.eventType) {
    case "payroll_verified":
      return "Payroll proof verified";
    case "employee_root_updated":
      return "Workforce root updated";
    case "auditor_granted":
      return "Auditor granted";
    case "auditor_revoked":
      return "Auditor revoked";
    default:
      return "Protocol event";
  }
}

export function txExplorerUrl(txHash: string): string {
  return `https://stellar.expert/explorer/testnet/tx/${txHash}`;
}
