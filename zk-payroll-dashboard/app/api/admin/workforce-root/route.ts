import { NextRequest, NextResponse } from "next/server";
import * as StellarSdk from "@stellar/stellar-sdk";
import { Server, Api as RpcApi } from "@stellar/stellar-sdk/rpc";
import { getServerEnv } from "@/lib/env";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth/session";
import { submitAndConfirmSorobanTransaction } from "@/lib/stellar/transactions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BN254_FR_MODULUS = BigInt(
  "21888242871839275222246405745257275088548364400416034343698204186575808495617",
);

function normalizeRoot(root: unknown): bigint {
  if (typeof root !== "string") {
    throw new Error("root must be a 32-byte hex string");
  }
  const hex = root.replace(/^0x/i, "");
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error("root must be a 32-byte hex string");
  }
  const value = BigInt(`0x${hex}`);
  if (value >= BN254_FR_MODULUS) {
    throw new Error("root exceeds BN254 field modulus");
  }
  return value;
}

export async function POST(request: NextRequest) {
  try {
    const env = getServerEnv();
    if (env.NEXT_PUBLIC_STELLAR_NETWORK !== "TESTNET") {
      return NextResponse.json(
        { error: "Delegated workforce root updates are testnet-only." },
        { status: 403 },
      );
    }

    const sessionToken = request.cookies.get(SESSION_COOKIE_NAME)?.value;
    const session = sessionToken ? await verifySessionToken(sessionToken) : null;
    if (!session?.publicKey) {
      return NextResponse.json(
        { error: "Connect and sign the wallet challenge before posting a delegated root." },
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

    const adminKeypair = StellarSdk.Keypair.fromSecret(adminSecret);
    if (adminKeypair.publicKey() !== env.ADMIN_PUBLIC_KEY) {
      return NextResponse.json(
        { error: "Delegated admin signer does not match ADMIN_PUBLIC_KEY." },
        { status: 500 },
      );
    }

    const body = await request.json();
    const rootValue = normalizeRoot(body.root);
    const rootScVal = StellarSdk.nativeToScVal(rootValue, { type: "u256" });

    const server = new Server(env.NEXT_PUBLIC_SOROBAN_RPC_URL);
    const source = await server.getAccount(adminKeypair.publicKey());
    const contract = new StellarSdk.Contract(env.NEXT_PUBLIC_PAYROLL_CONTRACT);
    const tx = new StellarSdk.TransactionBuilder(source, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: StellarSdk.Networks.TESTNET,
    })
      .addOperation(contract.call("set_employee_root", rootScVal))
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
      txHash: result.hash,
      root: rootValue.toString(16).padStart(64, "0"),
      requestedBy: session.publicKey,
      submittedBy: adminKeypair.publicKey(),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to post workforce root." },
      { status: 500 },
    );
  }
}
