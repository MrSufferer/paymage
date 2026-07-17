import { NextRequest } from "next/server";
import * as StellarSdk from "@stellar/stellar-sdk";
import { Server } from "@stellar/stellar-sdk/rpc";
import { successResponse, errorResponse } from "@/lib/api/response";
import { withCors, handleOptions } from "@/lib/api/cors";
import { transactionQuerySchema } from "@/lib/api/validation";
import { getServerEnv } from "@/lib/env";
import { PAYMAGE_COMPANY } from "@/lib/protocol/paymage";
import type { PayrollTransaction } from "@/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const EVENT_LOOKBACK_LEDGERS = 20_000;

const PRODUCTION_EVENT_FALLBACKS: PayrollTransaction[] = [
  {
    id: "payroll-1",
    companyId: PAYMAGE_COMPANY.id,
    timestamp: "2026-07-16T07:52:22Z",
    createdAt: "2026-07-16T07:52:22Z",
    totalAmount: 500_000,
    employeeCount: 10,
    proof: "12619325169626986653218159332759082090146355822194684049292146930677168356489",
    status: "verified",
    txHash: "faebdaa3c213054b3d834f16f59f1f3b23627e42c04b3707e412a0902aa3792e",
    ledger: 3_634_300,
    eventType: "payroll_verified",
    contractId: "CBH7BYNPDIFPLCERBYAYNWALFGWSM6UB3FUEJGEKVGPLH5LTYRULRYFR",
  },
  {
    id: "auditor_granted-d5065ac9350a574d0643579c1e2908eb0243ce86f2df32b2869a6ecbaa9cb7c2",
    companyId: PAYMAGE_COMPANY.id,
    timestamp: "2026-07-16T07:14:48Z",
    createdAt: "2026-07-16T07:14:48Z",
    totalAmount: 0,
    employeeCount: 0,
    proof: "GDWWKPNN5SS4TRI5FAHRCKPJ2QI7AQUZIGCML2S6RUDDJB3N64RTBWNK",
    status: "verified",
    txHash: "d5065ac9350a574d0643579c1e2908eb0243ce86f2df32b2869a6ecbaa9cb7c2",
    ledger: 3_633_850,
    eventType: "auditor_granted",
    contractId: "CBH7BYNPDIFPLCERBYAYNWALFGWSM6UB3FUEJGEKVGPLH5LTYRULRYFR",
  },
  {
    id: "auditor_granted-4b41aa29d3d6351da904c11a7965b06a2fb67e610f6dce96c110f9435d0f0d02",
    companyId: PAYMAGE_COMPANY.id,
    timestamp: "2026-07-17T04:31:33Z",
    createdAt: "2026-07-17T04:31:33Z",
    totalAmount: 0,
    employeeCount: 0,
    proof: "GBBTKIOKPCGILWKYJASL7LL3TSITQMOVTYOL3Q5KG3Y4L7KY4BIXXXJI",
    status: "verified",
    txHash: "4b41aa29d3d6351da904c11a7965b06a2fb67e610f6dce96c110f9435d0f0d02",
    ledger: 3_649_116,
    eventType: "auditor_granted",
    contractId: "CBH7BYNPDIFPLCERBYAYNWALFGWSM6UB3FUEJGEKVGPLH5LTYRULRYFR",
  },
  {
    id: "payroll-2",
    companyId: PAYMAGE_COMPANY.id,
    timestamp: "2026-07-17T05:24:35Z",
    createdAt: "2026-07-17T05:24:35Z",
    totalAmount: 500_010,
    employeeCount: 10,
    proof: "14238369317659710183511813923362588629277105237326634065875052132821308071501",
    status: "verified",
    txHash: "2bc6ce7f24e18895c2312b8d1cb0ca8d463b4891c40ec4df5be226fbe83bc983",
    ledger: 3_649_780,
    eventType: "payroll_verified",
    contractId: "CBH7BYNPDIFPLCERBYAYNWALFGWSM6UB3FUEJGEKVGPLH5LTYRULRYFR",
  },
];

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

  const merged = new Map<string, PayrollTransaction>();
  for (const fallback of PRODUCTION_EVENT_FALLBACKS) {
    if (fallback.contractId === env.NEXT_PUBLIC_PAYROLL_CONTRACT) {
      merged.set(fallback.txHash ?? fallback.id, fallback);
    }
  }
  for (const row of rows) {
    merged.set(row.txHash ?? row.id, row);
  }

  return Array.from(merged.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
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
