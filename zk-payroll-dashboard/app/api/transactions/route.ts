import { NextRequest } from "next/server";
import * as StellarSdk from "@stellar/stellar-sdk";
import { Server } from "@stellar/stellar-sdk/rpc";
import { successResponse, errorResponse } from "@/lib/api/response";
import { withCors, handleOptions } from "@/lib/api/cors";
import { transactionQuerySchema } from "@/lib/api/validation";
import { getServerEnv } from "@/lib/env";
import { PAYMAGE_COMPANY, EVENT_LOOKBACK_LEDGERS } from "@/lib/protocol/paymage";
import type { PayrollTransaction } from "@/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function OPTIONS(request: NextRequest) {
  return handleOptions(request);
}

function stringifyNative(value: unknown): string {
  if (typeof value === "bigint") return value.toString();
  if (value === null || value === undefined) return "";
  return String(value);
}

function queryValue(searchParams: URLSearchParams, key: string): string | undefined {
  return searchParams.get(key) ?? undefined;
}

async function loadProtocolTransactions(): Promise<PayrollTransaction[]> {
  const env = getServerEnv();
  const server = new Server(env.NEXT_PUBLIC_SOROBAN_RPC_URL);
  const latest = await server.getLatestLedger();
  const startLedger = Math.max(1, latest.sequence - EVENT_LOOKBACK_LEDGERS);
  const response = await server.getEvents({
    startLedger,
    filters: [
      {
        type: "contract",
        contractIds: [env.NEXT_PUBLIC_PAYROLL_CONTRACT],
      },
    ],
    limit: 200,
  });

  const rows: PayrollTransaction[] = [];
  for (const event of response.events ?? []) {
    const topics = event.topic.map((topic) => StellarSdk.scValToNative(topic));
    const eventName = stringifyNative(topics[0]);
    const data = StellarSdk.scValToNative(event.value) as Record<string, unknown>;
    const createdAt = event.ledgerClosedAt;
    const periodOrAddress = stringifyNative(topics[1]);

    if (eventName === "payroll_verified_event") {
      rows.push({
        id: `payroll-${periodOrAddress || event.txHash}`,
        companyId: PAYMAGE_COMPANY.id,
        timestamp: createdAt,
        createdAt,
        totalAmount: Number(data.total_amount ?? 0),
        employeeCount: Number(data.employee_count ?? 0),
        proof: stringifyNative(data.commitment_root),
        status: "verified",
        txHash: event.txHash,
        ledger: event.ledger,
        eventType: "payroll_verified",
        contractId: env.NEXT_PUBLIC_PAYROLL_CONTRACT,
      });
    }

    if (eventName === "employee_root_updated_event") {
      rows.push({
        id: `root-${event.txHash}`,
        companyId: PAYMAGE_COMPANY.id,
        timestamp: createdAt,
        createdAt,
        totalAmount: 0,
        employeeCount: 0,
        proof: periodOrAddress,
        status: "verified",
        txHash: event.txHash,
        ledger: event.ledger,
        eventType: "employee_root_updated",
        contractId: env.NEXT_PUBLIC_PAYROLL_CONTRACT,
      });
    }

    if (eventName === "auditor_granted_event" || eventName === "auditor_revoked_event") {
      rows.push({
        id: `${eventName.replace("_event", "")}-${event.txHash}`,
        companyId: PAYMAGE_COMPANY.id,
        timestamp: createdAt,
        createdAt,
        totalAmount: 0,
        employeeCount: 0,
        proof: periodOrAddress,
        status: "verified",
        txHash: event.txHash,
        ledger: event.ledger,
        eventType: eventName === "auditor_granted_event" ? "auditor_granted" : "auditor_revoked",
        contractId: env.NEXT_PUBLIC_PAYROLL_CONTRACT,
      });
    }
  }

  const deduped = new Map<string, PayrollTransaction>();
  for (const row of rows) {
    deduped.set(row.txHash ?? row.id, row);
  }

  return Array.from(deduped.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    const query = transactionQuerySchema.parse({
      page: queryValue(searchParams, "page"),
      limit: queryValue(searchParams, "limit"),
      status: queryValue(searchParams, "status"),
      from: queryValue(searchParams, "from"),
      to: queryValue(searchParams, "to"),
    });

    let results = await loadProtocolTransactions();

    if (query.status) {
      results = results.filter((t) => t.status === query.status);
    }

    if (query.from) {
      results = results.filter((t) => t.createdAt >= query.from!);
    }
    if (query.to) {
      results = results.filter((t) => t.createdAt <= query.to!);
    }

    const { page, limit } = query;
    const start = (page - 1) * limit;
    const paginated = results.slice(start, start + limit);

    return withCors(
      successResponse(paginated, {
        page,
        limit,
        total: results.length,
        totalPages: Math.ceil(results.length / limit),
        source: "stellar-testnet",
      }),
      request,
    );
  } catch (err) {
    return withCors(
      errorResponse(
        "INTERNAL_ERROR",
        "Failed to fetch protocol transactions.",
        500,
        err instanceof Error ? err.message : undefined,
      ),
      request,
    );
  }
}
