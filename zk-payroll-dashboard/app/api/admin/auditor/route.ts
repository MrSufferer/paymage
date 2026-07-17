import { NextRequest, NextResponse } from "next/server";
import * as StellarSdk from "@stellar/stellar-sdk";
import { Server, Api as RpcApi } from "@stellar/stellar-sdk/rpc";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth/session";
import { getServerEnv } from "@/lib/env";
import { PAYMAGE_AUDITOR_DISCLOSURE_KEY_ID } from "@/lib/protocol/paymage";
import { submitAndConfirmSorobanTransaction } from "@/lib/stellar/transactions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function parseAuditor(value: unknown): StellarSdk.Address {
  if (typeof value !== "string") {
    throw new Error("auditor address is required");
  }
  return StellarSdk.Address.fromString(value);
}

export async function POST(request: NextRequest) {
  try {
    const env = getServerEnv();
    if (env.NEXT_PUBLIC_STELLAR_NETWORK !== "TESTNET") {
      return NextResponse.json(
        { error: "Delegated auditor grants are testnet-only." },
        { status: 403 },
      );
    }

    const sessionToken = request.cookies.get(SESSION_COOKIE_NAME)?.value;
    const session = sessionToken ? await verifySessionToken(sessionToken) : null;
    if (!session?.publicKey) {
      return NextResponse.json(
        { error: "Connect and sign the wallet challenge before granting auditor access." },
        { status: 401 },
      );
    }

    const adminSecret = process.env.ADMIN_SECRET_KEY;
    if (!adminSecret) {
      return NextResponse.json(
        { error: "Delegated admin signer is not configured on the server." },
        { status: 503 },
      );
    }

    const body = await request.json();
    const auditor = parseAuditor(body.auditor ?? session.publicKey);
    if (auditor.toString() !== session.publicKey) {
      return NextResponse.json(
        { error: "Delegated testnet grants can only grant the connected wallet." },
        { status: 403 },
      );
    }

    const adminKeypair = StellarSdk.Keypair.fromSecret(adminSecret);
    if (adminKeypair.publicKey() !== env.ADMIN_PUBLIC_KEY) {
      return NextResponse.json(
        { error: "Delegated admin signer does not match ADMIN_PUBLIC_KEY." },
        { status: 500 },
      );
    }

    const encryptedKey = StellarSdk.nativeToScVal(
      `enc:${PAYMAGE_AUDITOR_DISCLOSURE_KEY_ID}`,
      { type: "bytes" },
    );
    const server = new Server(env.NEXT_PUBLIC_SOROBAN_RPC_URL);
    const source = await server.getAccount(adminKeypair.publicKey());
    const contract = new StellarSdk.Contract(env.NEXT_PUBLIC_PAYROLL_CONTRACT);
    const tx = new StellarSdk.TransactionBuilder(source, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: StellarSdk.Networks.TESTNET,
    })
      .addOperation(
        contract.call("set_view_key_for_auditor", auditor.toScVal(), encryptedKey),
      )
      .setTimeout(60)
      .build();

    const sim = await server.simulateTransaction(tx);
    if (RpcApi.isSimulationError(sim)) {
      return NextResponse.json(
        { error: `Simulation failed: ${sim.error}` },
        { status: 400 },
      );
    }

    const prepared = StellarSdk.rpc.assembleTransaction(tx, sim).build();
    prepared.sign(adminKeypair);
    const result = await submitAndConfirmSorobanTransaction(server, prepared, {
      maxAttempts: 60,
      pollMs: 1000,
    });

    return NextResponse.json({
      success: true,
      auditor: auditor.toString(),
      keyId: PAYMAGE_AUDITOR_DISCLOSURE_KEY_ID,
      txHash: result.hash,
      requestedBy: session.publicKey,
      submittedBy: adminKeypair.publicKey(),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to grant auditor." },
      { status: 500 },
    );
  }
}
