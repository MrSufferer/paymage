import type { Company, Employee, PayrollTransaction, ViewKey } from "@/types/models";

export const EVENT_LOOKBACK_LEDGERS = 9_000;

export const PAYMAGE_PROTOCOL = {
  productName: "PayMage",
  network: "Stellar Testnet",
  market: "Vietnam first",
  admin:
    process.env.NEXT_PUBLIC_ADMIN_PUBLIC_KEY ??
    "GBBTKIOKPCGILWKYJASL7LL3TSITQMOVTYOL3Q5KG3Y4L7KY4BIXXXJI",
  payrollContract: process.env.NEXT_PUBLIC_PAYROLL_CONTRACT ?? "",
  payrollVerifier: process.env.NEXT_PUBLIC_VERIFIER_CONTRACT ?? "",
  withdrawVerifier: process.env.NEXT_PUBLIC_WITHDRAW_VERIFIER_CONTRACT ?? "",
  payrollToken: process.env.NEXT_PUBLIC_PAYROLL_TOKEN ?? "",
  expectedEmployeeRoot:
    "1be648f15df6fe27c87e472fbbaf6abcd86ba1079ea90945542f16b029ea3c89",
  expectedEmployeeRootDecimal:
    "12619325169626986653218159332759082090146355822194684049292146930677168356489",
} as const;

export const PAYMAGE_AUDITOR_DISCLOSURE_KEY_ID =
  "paymage-auditor-disclosure-v1";

export const PAYMAGE_TESTNET_EMPLOYEES: Employee[] = Array.from(
  { length: 10 },
  (_, index) => {
    const id = `emp_${String(index + 1).padStart(3, "0")}`;
    return {
      id,
      address: PAYMAGE_PROTOCOL.admin,
      name: `PayMage Employee ${index + 1}`,
      email: `${id}@paymage.test`,
      department: index % 3 === 0 ? "Engineering" : index % 3 === 1 ? "Finance" : "Operations",
      salary: 50_000,
      salaryCommitment: PAYMAGE_PROTOCOL.expectedEmployeeRoot,
      isActive: true,
      status: "active",
      startDate: "2026-01-01T00:00:00Z",
    };
  },
);

export const PAYMAGE_COMPANY: Company = {
  id: "paymage_vietnam_001",
  name: "PayMage Vietnam Pilot",
  admin: PAYMAGE_PROTOCOL.admin,
  treasury: PAYMAGE_PROTOCOL.admin,
  employeeCount: PAYMAGE_TESTNET_EMPLOYEES.length,
  isActive: true,
};

export const PAYMAGE_PROTOCOL_TRANSACTIONS: PayrollTransaction[] = [
  {
    id: "root-sync-2026-07-16",
    companyId: PAYMAGE_COMPANY.id,
    timestamp: "2026-07-16T05:04:00Z",
    createdAt: "2026-07-16T05:04:00Z",
    totalAmount: 500_000,
    employeeCount: PAYMAGE_TESTNET_EMPLOYEES.length,
    proof: PAYMAGE_PROTOCOL.expectedEmployeeRoot,
    status: "verified",
    txHash: "8e9235909d702b924ad68c0bd8991aac52ca0fe89718456d8b0084a71a1cdbdb",
  },
];

export const PAYMAGE_VIEW_KEYS: ViewKey[] = [];
