import type { ArtifactRef } from "./pkCache";

/**
 * ZK artifact references for the payroll circuit (PayrollBatch(10, 10)).
 *
 * The proving key (~10 MB) and R1CS (~6.5 MB) are small enough to serve
 * from the artifact server (configured via `NEXT_PUBLIC_ZK_ARTIFACTS_URL`).
 * The circom witness WASM (~528 KB) and verification key (~2 KB) ship via
 * `public/zk/`.
 *
 * Configure the large-artifact base URL via `NEXT_PUBLIC_ZK_ARTIFACTS_URL`
 * (e.g. `http://localhost:8001` for a local `python -m http.server` in
 * `testdata/`, or a CDN URL in production).
 */

const LARGE_ARTIFACT_BASE =
  process.env.NEXT_PUBLIC_ZK_ARTIFACTS_URL ?? "http://localhost:8001";

const PUBLIC_BASE = "/zk";

/** Default artifact refs. Hashes/lengths can be pinned via env for integrity. */
export function payrollArtifactRefs(): {
  provingKey: ArtifactRef;
  r1cs: ArtifactRef;
  circuitWasm: ArtifactRef;
} {
  return {
    provingKey: {
      name: "payroll_10_10_proving_key",
      url: `${LARGE_ARTIFACT_BASE}/payroll_10_10_proving_key.bin`,
      expectedSha256: process.env.NEXT_PUBLIC_PAYROLL_PK_SHA256,
      expectedLength: process.env.NEXT_PUBLIC_PAYROLL_PK_LENGTH
        ? Number(process.env.NEXT_PUBLIC_PAYROLL_PK_LENGTH)
        : undefined,
    },
    r1cs: {
      name: "payroll_10_10_r1cs",
      url: `${LARGE_ARTIFACT_BASE}/payroll_10_10.r1cs`,
      expectedSha256: process.env.NEXT_PUBLIC_PAYROLL_R1CS_SHA256,
    },
    circuitWasm: {
      name: "payroll_10_10_circuit_wasm",
      url: `${PUBLIC_BASE}/payroll_10_10.wasm`,
      expectedSha256: process.env.NEXT_PUBLIC_PAYROLL_CIRCUIT_WASM_SHA256,
    },
  };
}

/** Verification key JSON (small, shipped in public/zk/). */
export const VERIFICATION_KEY_URL = `${PUBLIC_BASE}/verification_key.json`;

/**
 * ZK artifact references for the withdraw circuit (PayrollWithdraw(10)).
 * PK ~1.1 MB, R1CS ~759 KB, WASM ~466 KB.
 */
export function withdrawArtifactRefs(): {
  provingKey: ArtifactRef;
  r1cs: ArtifactRef;
  circuitWasm: ArtifactRef;
} {
  return {
    provingKey: {
      name: "payrollWithdraw_10_proving_key",
      url: `${LARGE_ARTIFACT_BASE}/payrollWithdraw_10_proving_key.bin`,
      expectedSha256: process.env.NEXT_PUBLIC_WITHDRAW_PK_SHA256,
      expectedLength: process.env.NEXT_PUBLIC_WITHDRAW_PK_LENGTH
        ? Number(process.env.NEXT_PUBLIC_WITHDRAW_PK_LENGTH)
        : undefined,
    },
    r1cs: {
      name: "payrollWithdraw_10_r1cs",
      url: `${LARGE_ARTIFACT_BASE}/payrollWithdraw_10.r1cs`,
      expectedSha256: process.env.NEXT_PUBLIC_WITHDRAW_R1CS_SHA256,
    },
    circuitWasm: {
      name: "payrollWithdraw_10_circuit_wasm",
      url: `${PUBLIC_BASE}/payrollWithdraw_10.wasm`,
      expectedSha256: process.env.NEXT_PUBLIC_WITHDRAW_CIRCUIT_WASM_SHA256,
    },
  };
}
