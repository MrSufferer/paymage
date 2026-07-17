import { NextRequest, NextResponse } from "next/server";
import * as StellarSdk from "@stellar/stellar-sdk";
import { Server, Api as RpcApi } from "@stellar/stellar-sdk/rpc";
import { getServerEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

function bytesToHex(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") {
    return Buffer.from(value).toString("hex");
  }
  if (value instanceof Uint8Array || Buffer.isBuffer(value)) {
    return Buffer.from(value).toString("hex");
  }
  if (Array.isArray(value)) {
    return Buffer.from(value).toString("hex");
  }
  return Buffer.from(String(value)).toString("hex");
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
  if (!address) {
    return NextResponse.json({ error: "address is required" }, { status: 400 });
  }

  let auditorAddress: StellarSdk.Address;
  try {
    auditorAddress = StellarSdk.Address.fromString(address);
  } catch {
    return NextResponse.json({ error: "Invalid Stellar address" }, { status: 400 });
  }

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

  const encryptedViewKey = isAuditor
    ? await simulateContractCall(
        server,
        source,
        env.NEXT_PUBLIC_PAYROLL_CONTRACT,
        "get_view_key",
        [auditorArg],
      ).catch(() => null)
    : null;

  return NextResponse.json({
    address,
    isAuditor,
    encryptedViewKeyHex: bytesToHex(encryptedViewKey),
    contract: env.NEXT_PUBLIC_PAYROLL_CONTRACT,
    network: env.NEXT_PUBLIC_STELLAR_NETWORK,
    updatedAt: new Date().toISOString(),
  });
}
