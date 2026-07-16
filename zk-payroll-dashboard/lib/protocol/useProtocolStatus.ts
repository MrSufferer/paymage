"use client";

import { useCallback, useEffect, useState } from "react";

export interface ProtocolStatus {
  product: string;
  network: "TESTNET" | "PUBLIC";
  ledger: {
    sequence: number;
    protocolVersion: number;
  };
  contracts: {
    payroll: string;
    payrollVerifier: string;
    withdrawVerifier: string;
    payrollToken: string;
  };
  payroll: {
    admin: string;
    employeeRoot: string | null;
    employeeRootHex: string | null;
    expectedEmployeeRoot: string;
    rootMatchesDemo: boolean;
    currentPeriod: string | null;
    activeEmployees: number;
    nextPayrollAmount: number;
    budgetCapStroops: string | null;
    budgetCap: string | null;
    treasuryBalanceStroops: string | null;
    treasuryBalance: string | null;
  };
  proof: {
    engine: string;
    verifierMode: string;
    proverUrl: string | null;
  };
  updatedAt: string;
}

export function useProtocolStatus() {
  const [data, setData] = useState<ProtocolStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/protocol/status", { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`Protocol status returned ${response.status}`);
      }
      setData((await response.json()) as ProtocolStatus);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load protocol status");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { data, error, isLoading, refresh };
}
