import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequestResponse, errorResponse, successResponse } from "@/lib/api/response";

export const runtime = "nodejs";
export const maxDuration = 60;

const publicInputsSchema = z.object({
  merkleRoot: z.string().min(1),
  totalPayrollAmount: z.string().min(1),
  payrollPeriodId: z.string().min(1),
});

const requestSchema = z.object({
  inputsJson: z.string().min(2),
  publicInputs: publicInputsSchema,
});

const proverResponseSchema = z.object({
  proofHex: z.string().regex(/^(0x)?[0-9a-fA-F]{512}$/),
  publicInputsHex: z.array(z.string().regex(/^(0x)?[0-9a-fA-F]{64}$/)).min(3),
  proverVersion: z.string().optional(),
});

function configuredProverUrl(): string | null {
  return process.env.PAYROLL_PROVER_URL ?? process.env.ZK_PROVER_URL ?? null;
}

function bearerHeaders(): HeadersInit {
  const token = process.env.PAYROLL_PROVER_TOKEN ?? process.env.ZK_PROVER_TOKEN;
  return token ? { authorization: `Bearer ${token}` } : {};
}

function fieldToBigInt(value: string): bigint {
  const trimmed = value.trim();
  if (/^0x[0-9a-fA-F]+$/i.test(trimmed)) {
    return BigInt(trimmed);
  }
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return BigInt(`0x${trimmed}`);
  }
  if (/^[0-9]+$/.test(trimmed)) {
    return BigInt(trimmed);
  }
  throw new Error(`Invalid field element: ${value}`);
}

function assertInputsMatchPublicRequest(inputsJson: string, publicInputs: z.infer<typeof publicInputsSchema>) {
  const parsed = JSON.parse(inputsJson) as Record<string, unknown>;
  if (fieldToBigInt(String(parsed.employeeRoot)) !== fieldToBigInt(publicInputs.merkleRoot)) {
    throw new Error("inputsJson employeeRoot does not match publicInputs");
  }
  if (String(parsed.totalPayrollAmount) !== publicInputs.totalPayrollAmount) {
    throw new Error("inputsJson totalPayrollAmount does not match publicInputs");
  }
  if (String(parsed.payrollPeriodId) !== publicInputs.payrollPeriodId) {
    throw new Error("inputsJson payrollPeriodId does not match publicInputs");
  }
}

export async function POST(request: Request) {
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return badRequestResponse("Invalid payroll proof request", z.treeifyError(parsed.error));
  }

  try {
    assertInputsMatchPublicRequest(parsed.data.inputsJson, parsed.data.publicInputs);
  } catch (error) {
    return badRequestResponse(
      error instanceof Error ? error.message : "Invalid payroll circuit input",
    );
  }

  const proverUrl = configuredProverUrl();
  if (!proverUrl) {
    return errorResponse(
      "PROVER_NOT_CONFIGURED",
      "PAYROLL_PROVER_URL is not configured. Deploy or run the native payroll prover service and set this server-side env var.",
      503,
    );
  }

  try {
    const upstream = await fetch(proverUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...bearerHeaders(),
      },
      body: JSON.stringify(parsed.data),
    });

    const payload = await upstream.json().catch(() => null);
    if (!upstream.ok) {
      return errorResponse(
        "PROVER_UPSTREAM_ERROR",
        "Payroll prover service rejected the proof request.",
        upstream.status,
        payload,
      );
    }

    const proof = proverResponseSchema.safeParse(payload?.data ?? payload);
    if (!proof.success) {
      return errorResponse(
        "PROVER_BAD_RESPONSE",
        "Payroll prover service returned an invalid proof response.",
        502,
        z.treeifyError(proof.error),
      );
    }

    return successResponse(proof.data);
  } catch (error) {
    return errorResponse(
      "PROVER_UNAVAILABLE",
      error instanceof Error ? error.message : "Payroll prover service is unavailable.",
      502,
    );
  }
}

export function GET() {
  return NextResponse.json({
    status: configuredProverUrl() ? "configured" : "missing PAYROLL_PROVER_URL",
  });
}
