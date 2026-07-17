import { NextRequest } from "next/server";
import * as StellarSdk from "@stellar/stellar-sdk";
import { Server, Api as RpcApi } from "@stellar/stellar-sdk/rpc";
import { badRequestResponse, errorResponse, successResponse } from "@/lib/api/response";
import { getServerEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

function bytesToHex(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") return Buffer.from(value).toString("hex");
  if (value instanceof Uint8Array || Buffer.isBuffer(value)) {
    return Buffer.from(value).toString("hex");
  }
  if (Array.isArray(value)) return Buffer.from(value).toString("hex");
  return Buffer.from(String(value)).toString("hex");
}

function bytesToUtf8(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (value instanceof Uint8Array || Buffer.isBuffer(value)) {
    return Buffer.from(value).toString("utf8");
  }
  if (Array.isArray(value)) return Buffer.from(value).toString("utf8");
  return String(value);
}

function stringify(value: unknown): string {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value;
  return String(value ?? "");
}

function toU64Arg(value: number): StellarSdk.xdr.ScVal {
  return StellarSdk.nativeToScVal(value, { type: "u64" });
}

function toU256Arg(value: string): StellarSdk.xdr.ScVal {
  return StellarSdk.nativeToScVal(BigInt(value), { type: "u256" });
}

function periodCommitmentsStorageKey(period: number): StellarSdk.xdr.ScVal {
  return StellarSdk.xdr.ScVal.scvVec([
    StellarSdk.xdr.ScVal.scvSymbol("PeriodCommitments"),
    toU64Arg(period),
  ]);
}

async function readPersistentContractData(
  server: Server,
  contractId: string,
  key: StellarSdk.xdr.ScVal,
) {
  const ledgerKey = StellarSdk.xdr.LedgerKey.contractData(
    new StellarSdk.xdr.LedgerKeyContractData({
      contract: StellarSdk.Address.fromString(contractId).toScAddress(),
      key,
      durability: StellarSdk.xdr.ContractDataDurability.persistent(),
    }),
  );
  const response = await server.getLedgerEntries(ledgerKey);
  if (response.entries.length === 0) return null;
  return StellarSdk.scValToNative(response.entries[0].val.contractData().val());
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

export async function GET(request: NextRequest) {
  const address = request.nextUrl.searchParams.get("address");
  if (!address) return badRequestResponse("address is required");

  let auditorAddress: StellarSdk.Address;
  try {
    auditorAddress = StellarSdk.Address.fromString(address);
  } catch {
    return badRequestResponse("Invalid Stellar address");
  }

  try {
    const env = getServerEnv();
    const server = new Server(env.NEXT_PUBLIC_SOROBAN_RPC_URL);
    const source = await server.getAccount(env.ADMIN_PUBLIC_KEY);
    const auditorArg = auditorAddress.toScVal();

    const isAuditor = Boolean(
      await simulateContractCall(
        server,
        source,
        env.NEXT_PUBLIC_PAYROLL_CONTRACT,
        "is_auditor",
        [auditorArg],
      ),
    );
    if (!isAuditor) {
      return errorResponse(
        "AUDITOR_NOT_GRANTED",
        "Connected wallet is not an active payroll auditor on Stellar testnet.",
        403,
      );
    }

    const encryptedViewKey = await simulateContractCall(
      server,
      source,
      env.NEXT_PUBLIC_PAYROLL_CONTRACT,
      "get_view_key",
      [auditorArg],
    );

    const currentPeriodRaw = await simulateContractCall(
      server,
      source,
      env.NEXT_PUBLIC_PAYROLL_CONTRACT,
      "get_current_period",
    );
    const currentPeriod = Number(stringify(currentPeriodRaw) || "0");
    const requestedPeriod = request.nextUrl.searchParams.get("period");
    const period = requestedPeriod ? Number(requestedPeriod) : currentPeriod;
    if (!Number.isInteger(period) || period < 0) {
      return badRequestResponse("period must be a non-negative integer");
    }

    if (period === 0) {
      return successResponse({
        address,
        contract: env.NEXT_PUBLIC_PAYROLL_CONTRACT,
        currentPeriod,
        period,
        encryptedViewKeyHex: bytesToHex(encryptedViewKey),
        payroll: null,
        commitments: [],
        updatedAt: new Date().toISOString(),
      });
    }

    const payrollPeriod = await simulateContractCall(
      server,
      source,
      env.NEXT_PUBLIC_PAYROLL_CONTRACT,
      "get_payroll_period",
      [toU64Arg(period)],
    );
    if (!Array.isArray(payrollPeriod) || payrollPeriod.length < 3) {
      return errorResponse("PERIOD_NOT_FOUND", "Payroll period not found on contract.", 404);
    }

    const commitmentIdsRaw = await simulateContractCall(
      server,
      source,
      env.NEXT_PUBLIC_PAYROLL_CONTRACT,
      "get_period_commitments",
      [toU64Arg(period)],
    ).catch(async (err) => {
      const message = err instanceof Error ? err.message : String(err);
      if (!message.includes("get_period_commitments")) throw err;
      return readPersistentContractData(
        server,
        env.NEXT_PUBLIC_PAYROLL_CONTRACT,
        periodCommitmentsStorageKey(period),
      );
    });
    const commitmentIds = Array.isArray(commitmentIdsRaw)
      ? commitmentIdsRaw.map((value) => stringify(value)).filter(Boolean)
      : [];

    const commitments = await Promise.all(
      commitmentIds.map(async (commitmentId) => {
        const record = await simulateContractCall(
          server,
          source,
          env.NEXT_PUBLIC_PAYROLL_CONTRACT,
          "get_commitment_record",
          [toU256Arg(commitmentId)],
        );
        const cid = Array.isArray(record) ? bytesToUtf8(record[1]) : "";
        return {
          commitmentId,
          ipfsCid: cid,
          gatewayUrl: cid ? `https://gateway.pinata.cloud/ipfs/${cid}` : null,
        };
      }),
    );

    const commitmentRoot = stringify(payrollPeriod[0]);
    return successResponse({
      address,
      contract: env.NEXT_PUBLIC_PAYROLL_CONTRACT,
      currentPeriod,
      period,
      encryptedViewKeyHex: bytesToHex(encryptedViewKey),
      payroll: {
        commitmentRoot,
        commitmentRootHex: BigInt(commitmentRoot).toString(16).padStart(64, "0"),
        totalAmount: stringify(payrollPeriod[1]),
        employeeCount: Number(stringify(payrollPeriod[2])),
      },
      commitments,
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    return errorResponse(
      "DISCLOSURE_READ_FAILED",
      err instanceof Error ? err.message : "Failed to read auditor disclosure.",
      500,
    );
  }
}
