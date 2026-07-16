import type { PayrollProof, ProofVerificationResult, ZkProofRequest } from "@/types";
import type { RealProofResult } from "./realProver";
import { toSorobanScValsFromRealProof } from "./serialize";
import { buildPayrollCircuitInputFromProofRequest } from "./payrollCircuitInput";

interface ApiSuccess<T> {
  success: true;
  data: T;
}

interface ApiError {
  success: false;
  error: {
    message: string;
  };
}

type ApiResponse<T> = ApiSuccess<T> | ApiError;

export interface ServerPayrollProofRequest {
  inputsJson: string;
  publicInputs: ZkProofRequest["publicInputs"];
}

export interface ServerPayrollProofResult extends RealProofResult {
  proverVersion?: string;
}

function configuredBrowserProverUrl(): string | null {
  const value = process.env.NEXT_PUBLIC_PAYROLL_PROVER_URL?.trim();
  return value ? value : null;
}

function assertProofResult(value: unknown): ServerPayrollProofResult {
  const result = value as Partial<ServerPayrollProofResult>;
  if (typeof result.proofHex !== "string" || result.proofHex.replace(/^0x/i, "").length !== 512) {
    throw new Error("Server prover returned an invalid proofHex");
  }
  if (
    !Array.isArray(result.publicInputsHex) ||
    result.publicInputsHex.length < 3 ||
    result.publicInputsHex.some((input) => typeof input !== "string" || input.replace(/^0x/i, "").length !== 64)
  ) {
    throw new Error("Server prover returned invalid publicInputsHex");
  }

  return {
    proofHex: result.proofHex,
    publicInputsHex: result.publicInputsHex,
    proverVersion: result.proverVersion,
  };
}

export async function requestServerPayrollProof(
  request: ZkProofRequest,
  endpoint = configuredBrowserProverUrl() ?? "/api/zk/payroll/prove",
): Promise<ServerPayrollProofResult> {
  const inputsJson = await buildPayrollCircuitInputFromProofRequest(request);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ inputsJson, publicInputs: request.publicInputs }),
  });

  const payload = (await response.json()) as ApiResponse<ServerPayrollProofResult> | ServerPayrollProofResult | null;
  if (!payload || !response.ok) {
    const apiPayload = payload as ApiError | null;
    const message =
      apiPayload && "success" in apiPayload && !apiPayload.success
        ? apiPayload.error.message
        : "Server prover failed";
    throw new Error(message);
  }

  if ("success" in payload && !payload.success) {
    const message =
      payload.error.message;
    throw new Error(message);
  }

  return assertProofResult("success" in payload ? payload.data : payload);
}

export function proofResultToPayrollProof(result: ServerPayrollProofResult): PayrollProof {
  return {
    publicSignals: result.publicInputsHex,
    proof: {
      real: true,
      source: "server",
      proofHex: result.proofHex,
      publicInputsHex: result.publicInputsHex,
      proverVersion: result.proverVersion,
      sorobanArgs: toSorobanScValsFromRealProof(result),
    },
  };
}

export function verifiedServerProof(): ProofVerificationResult {
  return {
    isValid: true,
    verifiedAt: new Date().toISOString(),
  };
}
