import { NextResponse } from "next/server";
import * as StellarSdk from "@stellar/stellar-sdk";
import { Server, Api as RpcApi } from "@stellar/stellar-sdk/rpc";
import { getServerEnv } from "@/lib/env";
import { PAYMAGE_PROTOCOL, PAYMAGE_TESTNET_EMPLOYEES } from "@/lib/protocol/paymage";

export const dynamic = "force-dynamic";

function stringify(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value;
  return String(value);
}

function stroopsToUnits(value: string | null): string | null {
  if (!value) return null;
  const amount = BigInt(value);
  const whole = amount / BigInt(10_000_000);
  const fraction = (amount % BigInt(10_000_000)).toString().padStart(7, "0");
  return `${whole}.${fraction}`;
}

async function simulateContractCall(
  server: Server,
  source: StellarSdk.Account,
  contractId: string,
  method: string,
  args: StellarSdk.xdr.ScVal[] = [],
) {
  const contract = new StellarSdk.Contract(contractId);
  const tx = new StellarSdk.TransactionBuilder(source, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase: StellarSdk.Networks.TESTNET,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(30)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (RpcApi.isSimulationError(sim)) {
    throw new Error(sim.error);
  }
  return sim.result?.retval ? StellarSdk.scValToNative(sim.result.retval) : null;
}

export async function GET() {
  const env = getServerEnv();
  const server = new Server(env.NEXT_PUBLIC_SOROBAN_RPC_URL);
  const source = await server.getAccount(env.ADMIN_PUBLIC_KEY);
  const latestLedger = await server.getLatestLedger();

  const [employeeRoot, currentPeriod, budgetCap, tokenBalance] = await Promise.all([
    simulateContractCall(
      server,
      source,
      env.NEXT_PUBLIC_PAYROLL_CONTRACT,
      "get_employee_root",
    ),
    simulateContractCall(
      server,
      source,
      env.NEXT_PUBLIC_PAYROLL_CONTRACT,
      "get_current_period",
    ),
    simulateContractCall(
      server,
      source,
      env.NEXT_PUBLIC_PAYROLL_CONTRACT,
      "get_budget_cap",
    ),
    simulateContractCall(server, source, env.NEXT_PUBLIC_PAYROLL_TOKEN, "balance", [
      StellarSdk.Address.fromString(env.ADMIN_PUBLIC_KEY).toScVal(),
    ]).catch(() => null),
  ]);

  const employeeRootDecimal = stringify(employeeRoot);
  const budgetCapStroops = stringify(budgetCap);
  const tokenBalanceStroops = stringify(tokenBalance);

  return NextResponse.json({
    product: PAYMAGE_PROTOCOL.productName,
    network: env.NEXT_PUBLIC_STELLAR_NETWORK,
    ledger: {
      sequence: latestLedger.sequence,
      protocolVersion: latestLedger.protocolVersion,
    },
    contracts: {
      payroll: env.NEXT_PUBLIC_PAYROLL_CONTRACT,
      payrollVerifier: env.NEXT_PUBLIC_VERIFIER_CONTRACT,
      withdrawVerifier: env.NEXT_PUBLIC_WITHDRAW_VERIFIER_CONTRACT,
      payrollToken: env.NEXT_PUBLIC_PAYROLL_TOKEN,
    },
    payroll: {
      admin: env.ADMIN_PUBLIC_KEY,
      employeeRoot: employeeRootDecimal,
      employeeRootHex: employeeRootDecimal
        ? BigInt(employeeRootDecimal).toString(16).padStart(64, "0")
        : null,
      expectedEmployeeRoot: PAYMAGE_PROTOCOL.expectedEmployeeRoot,
      rootMatchesDemo: employeeRootDecimal === PAYMAGE_PROTOCOL.expectedEmployeeRootDecimal,
      currentPeriod: stringify(currentPeriod),
      activeEmployees: PAYMAGE_TESTNET_EMPLOYEES.length,
      nextPayrollAmount: PAYMAGE_TESTNET_EMPLOYEES.reduce(
        (sum, employee) => sum + employee.salary,
        0,
      ),
      budgetCapStroops,
      budgetCap: stroopsToUnits(budgetCapStroops),
      treasuryBalanceStroops: tokenBalanceStroops,
      treasuryBalance: stroopsToUnits(tokenBalanceStroops),
    },
    proof: {
      engine: process.env.NEXT_PUBLIC_ZK_ENGINE ?? "mock",
      proverUrl:
        process.env.NEXT_PUBLIC_PAYROLL_PROVER_URL ??
        process.env.PAYROLL_PROVER_URL ??
        null,
    },
    updatedAt: new Date().toISOString(),
  });
}
