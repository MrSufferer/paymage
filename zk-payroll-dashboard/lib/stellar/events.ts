import { xdr } from "@stellar/stellar-sdk";
import { Api, Server } from "@stellar/stellar-sdk/rpc";
import type { PayrollTransaction } from "@/types";

export const PAYROLL_CONTRACT_ID =
  process.env.NEXT_PUBLIC_PAYROLL_CONTRACT_ID ??
  "CDSODUB6ZYOB5VZ4GV6MD2NAZ3RA3KZ73RVOBNZMFVXOO7CLLYWTUXNF";

export const PAYROLL_EVENT_NAMES = [
  "PayrollVerifiedEvent",
  "WithdrawalEvent",
] as const;

export type PayrollEventName = (typeof PAYROLL_EVENT_NAMES)[number];

export interface PayrollEventsRpc {
  getEvents: (
    request: Api.GetEventsRequest,
  ) => Promise<Pick<Api.GetEventsResponse, "events">>;
}

export interface FetchPayrollEventsOptions {
  startLedger?: number;
  endLedger?: number;
  limit?: number;
}

function eventTopic(name: PayrollEventName): string {
  return xdr.ScVal.scvSymbol(name).toXDR("base64");
}

export function payrollEventFilters(): Api.EventFilter[] {
  return PAYROLL_EVENT_NAMES.map((name) => ({
    type: "contract" as const,
    contractIds: [PAYROLL_CONTRACT_ID],
    topics: [[eventTopic(name)]],
  }));
}

function eventNameFromTopic(topic: xdr.ScVal | undefined): PayrollEventName | undefined {
  if (!topic) return undefined;

  try {
    const kind = topic.switch().name;
    const name = kind === "scvSymbol" ? topic.sym().toString() : kind === "scvString" ? topic.str().toString() : "";
    return PAYROLL_EVENT_NAMES.includes(name as PayrollEventName)
      ? (name as PayrollEventName)
      : undefined;
  } catch {
    return undefined;
  }
}

function toPayrollTransaction(event: Api.EventResponse): PayrollTransaction | null {
  const eventType = eventNameFromTopic(event.topic[0]);
  if (
    event.type !== "contract" ||
    event.contractId?.toString() !== PAYROLL_CONTRACT_ID ||
    !event.inSuccessfulContractCall ||
    !eventType
  ) {
    return null;
  }

  return {
    id: event.id,
    companyId: PAYROLL_CONTRACT_ID,
    timestamp: event.ledgerClosedAt,
    createdAt: event.ledgerClosedAt,
    totalAmount: 0,
    employeeCount: 0,
    proof: event.value.toXDR("base64"),
    status: "verified",
    txHash: event.txHash,
    eventType,
  };
}

export async function fetchPayrollEvents(
  rpc: PayrollEventsRpc,
  { startLedger = 1, endLedger, limit = 100 }: FetchPayrollEventsOptions = {},
): Promise<PayrollTransaction[]> {
  const request: Api.GetEventsRequest = {
    filters: payrollEventFilters(),
    startLedger,
    ...(endLedger === undefined ? {} : { endLedger }),
    limit,
  };
  const response = await rpc.getEvents(request);

  return response.events
    .map(toPayrollTransaction)
    .filter((event): event is PayrollTransaction => event !== null);
}

export function createPayrollEventsRpc(rpcUrl: string): PayrollEventsRpc {
  return new Server(rpcUrl);
}
