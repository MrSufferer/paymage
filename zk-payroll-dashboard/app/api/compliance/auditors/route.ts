import { NextRequest } from "next/server";
import * as StellarSdk from "@stellar/stellar-sdk";
import { Server, Api as RpcApi } from "@stellar/stellar-sdk/rpc";
import { errorResponse, successResponse } from "@/lib/api/response";
import { getServerEnv } from "@/lib/env";
import { EVENT_LOOKBACK_LEDGERS } from "@/lib/protocol/paymage";

export const dynamic = "force-dynamic";

type AuditorEventType = "auditor_granted" | "auditor_revoked";

interface AuditorEvent {
  address: string;
  eventType: AuditorEventType;
  txHash: string;
  ledger: number;
  timestamp: string;
}

interface TransactionRow {
  proof?: string;
  eventType?: string;
  txHash?: string;
  ledger?: number;
  createdAt?: string;
  timestamp?: string;
}

function stringifyNative(value: unknown): string {
  if (typeof value === "bigint") return value.toString();
  if (value === null || value === undefined) return "";
  return String(value);
}

function bytesToHex(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") return Buffer.from(value).toString("hex");
  if (value instanceof Uint8Array || Buffer.isBuffer(value)) {
    return Buffer.from(value).toString("hex");
  }
  if (Array.isArray(value)) return Buffer.from(value).toString("hex");
  return Buffer.from(String(value)).toString("hex");
}

function keyIdFromEnvelopeHex(hex: string | null): string | null {
  if (!hex) return null;
  const value = Buffer.from(hex, "hex").toString("utf8");
  return value.startsWith("enc:") ? value.slice(4) : null;
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

async function loadAuditorEventsFromTransactions(request: NextRequest): Promise<AuditorEvent[]> {
  const response = await fetch(new URL("/api/transactions?limit=100", request.url), {
    cache: "no-store",
  });
  if (!response.ok) return [];
  const body = await response.json();
  if (!body.success || !Array.isArray(body.data)) return [];

  return (body.data as TransactionRow[])
    .filter(
      (row) =>
        row.eventType === "auditor_granted" || row.eventType === "auditor_revoked",
    )
    .filter((row) => row.proof && row.txHash && row.ledger)
    .map((row) => ({
      address: row.proof!,
      eventType: row.eventType as AuditorEventType,
      txHash: row.txHash!,
      ledger: row.ledger!,
      timestamp: row.createdAt ?? row.timestamp ?? new Date(0).toISOString(),
    }));
}

export async function GET(request: NextRequest) {
  try {
    const env = getServerEnv();
    const server = new Server(env.NEXT_PUBLIC_SOROBAN_RPC_URL);
    const source = await server.getAccount(env.ADMIN_PUBLIC_KEY);
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

    const latestByAuditor = new Map<string, AuditorEvent>();
    for (const event of response.events ?? []) {
      const topics = event.topic.map((topic) => StellarSdk.scValToNative(topic));
      const eventName = stringifyNative(topics[0]);
      if (eventName !== "auditor_granted_event" && eventName !== "auditor_revoked_event") {
        continue;
      }

      const address = stringifyNative(topics[1]);
      if (!address) continue;

      latestByAuditor.set(address, {
        address,
        eventType:
          eventName === "auditor_granted_event" ? "auditor_granted" : "auditor_revoked",
        txHash: event.txHash,
        ledger: event.ledger,
        timestamp: event.ledgerClosedAt,
      });
    }

    if (latestByAuditor.size === 0) {
      for (const event of await loadAuditorEventsFromTransactions(request)) {
        latestByAuditor.set(event.address, event);
      }
    }

    const auditors = await Promise.all(
      Array.from(latestByAuditor.values()).map(async (event) => {
        const auditorArg = StellarSdk.Address.fromString(event.address).toScVal();
        const isAuditor = Boolean(
          await simulateContractCall(
            server,
            source,
            env.NEXT_PUBLIC_PAYROLL_CONTRACT,
            "is_auditor",
            [auditorArg],
          ),
        );
        const encryptedViewKey = isAuditor
          ? await simulateContractCall(
              server,
              source,
              env.NEXT_PUBLIC_PAYROLL_CONTRACT,
              "get_view_key",
              [auditorArg],
            ).catch(() => null)
          : null;
        const encryptedViewKeyHex = bytesToHex(encryptedViewKey);

        return {
          address: event.address,
          status: isAuditor ? "active" : "revoked",
          eventType: event.eventType,
          isAuditor,
          encryptedViewKeyHex,
          keyId: keyIdFromEnvelopeHex(encryptedViewKeyHex),
          latestTxHash: event.txHash,
          latestLedger: event.ledger,
          latestEventAt: event.timestamp,
        };
      }),
    );

    return successResponse(
      {
        contract: env.NEXT_PUBLIC_PAYROLL_CONTRACT,
        network: env.NEXT_PUBLIC_STELLAR_NETWORK,
        auditors: auditors.sort((a, b) => b.latestEventAt.localeCompare(a.latestEventAt)),
        updatedAt: new Date().toISOString(),
      },
      {
        latestLedger: latest.sequence,
        startLedger,
        source: "stellar-testnet-events",
      },
    );
  } catch (err) {
    return errorResponse(
      "AUDITOR_LIST_FAILED",
      err instanceof Error ? err.message : "Failed to list auditor grants.",
      500,
    );
  }
}
