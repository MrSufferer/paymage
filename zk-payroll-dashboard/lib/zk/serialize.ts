import * as StellarSdk from "@stellar/stellar-sdk";
import { xdr } from "@stellar/stellar-base";
import type { PayrollProof, PayrollPublicInputs } from "@/types";
import type { RealProofResult } from "./realProver";

// Pure Uint8Array hex conversion — no Buffer dependency.
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Convert a hex string (with or without 0x prefix) to a Uint8Array of bytes.
// Pads to byteLength.
function hexToBytes(hex: string, byteLength: number): Uint8Array {
  const clean = hex.replace(/^0x/i, "");
  const bytes = new Uint8Array(byteLength);
  for (let i = 0; i < byteLength; i++) {
    const offset = clean.length - (byteLength - i) * 2;
    if (offset >= 0) {
      bytes[i] = parseInt(clean.slice(offset, offset + 2), 16);
    }
  }
  return bytes;
}

// Convert a decimal/bigint string to a Uint8Array big-endian uint256 (32 bytes).
function amountToBytes(amount: string, byteLength = 32): Uint8Array {
  let val = BigInt(amount);
  const bytes = new Uint8Array(byteLength);
  for (let i = byteLength - 1; i >= 0; i--) {
    bytes[i] = Number(val & BigInt(0xff));
    val >>= BigInt(8);
  }
  return bytes;
}

/**
 * Build Soroban ScVal args for `run_payroll` from a (mock) `PayrollProof`.
 *
 * Mock proofs are zero-filled points — the verifier contract will reject them,
 * which is fine: this path is dev-only and never produces a valid on-chain
 * proof. The ScVal *encoding* is the same as the real path
 * (`buildPayrollScVals`) so the contract call shape is exercised end-to-end
 * minus the crypto.
 */
export function toSorobanScVals(
  proof: PayrollProof,
  publicInputs: PayrollPublicInputs,
  ipfsCids?: Array<{ commitmentId: string; ipfsCid: string }>
): import("@stellar/stellar-base").xdr.ScVal[] {
  const isMock = proof.proof?.scheme === "mock";
  const proofBytes = new Uint8Array(256);
  if (!isMock && typeof proof.proof?.proofHex === "string") {
    const real = hexToBytes(proof.proof.proofHex as string, 256);
    proofBytes.set(real);
  } else if (!isMock) {
    proofBytes[64] = 1;
    proofBytes[192] = 1;
  }

  const rootHex = publicInputs.merkleRoot || "0".repeat(64);
  const amountHex = bytesToHex(
    amountToBytes(publicInputs.totalPayrollAmount || "0", 32)
  );
  const periodHex = publicInputs.payrollPeriodId || "0".repeat(64);

  return buildPayrollScVals(
    proofBytes,
    [rootHex, amountHex, periodHex],
    ipfsCids
  );
}

/**
 * Build the 3 Soroban ScVal args for `run_payroll(proof, public_inputs,
 * ipfs_cids)` from a 256-byte uncompressed proof blob and the
 * hex-encoded public inputs.
 *
 * Employee count is derived from `ipfs_cids.len()` in the contract.
 *
 * Mirrors the authoritative encoding in
 * `app/crates/core/stellar/src/soroban_encode.rs`.
 */
function buildPayrollScVals(
  proofBytes: Uint8Array,
  publicInputsHex: string[],
  ipfsCids?: Array<{ commitmentId: string; ipfsCid: string }>
): import("@stellar/stellar-base").xdr.ScVal[] {
  if (proofBytes.length !== 256) {
    throw new Error(`Invalid proof length: expected 256 bytes, got ${proofBytes.length}`);
  }
  if (publicInputsHex.length < 3) {
    throw new Error(`Expected ≥3 public inputs, got ${publicInputsHex.length}`);
  }

  const proofScVal = xdr.ScVal.scvMap([
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("a"),
      val: xdr.ScVal.scvBytes(Buffer.from(proofBytes.subarray(0, 64))),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("b"),
      val: xdr.ScVal.scvBytes(Buffer.from(proofBytes.subarray(64, 192))),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("c"),
      val: xdr.ScVal.scvBytes(Buffer.from(proofBytes.subarray(192, 256))),
    }),
  ]);

  const publicInputsScVal = xdr.ScVal.scvVec(
    publicInputsHex.map((hex) => u256ScVal(hex))
  );

  const ipfsCidsScVal = ipfsCids && ipfsCids.length > 0
    ? xdr.ScVal.scvVec(
        ipfsCids.map(({ commitmentId, ipfsCid }) =>
          xdr.ScVal.scvVec([
            u256ScVal(commitmentId),
            xdr.ScVal.scvBytes(Buffer.from(ipfsCid, "utf-8")),
          ])
        )
      )
    : xdr.ScVal.scvVec([]);

  return [proofScVal, publicInputsScVal, ipfsCidsScVal];
}

/**
 * Build Soroban ScVal args for `run_payroll` from the *real* prover's output.
 *
 * The Rust prover returns:
 * - `proofHex`        — 256 bytes uncompressed (A||B||C)
 * - `publicInputsHex` — N × 32-byte big-endian BN254 Fr elements, in circuit
 *   order: `[employeeRoot, totalPayrollAmount, payrollPeriodId]`.
 */
export function toSorobanScValsFromRealProof(
  real: RealProofResult,
  ipfsCids?: Array<{ commitmentId: string; ipfsCid: string }>
): import("@stellar/stellar-base").xdr.ScVal[] {
  const proofHex = real.proofHex.replace(/^0x/i, "");
  if (proofHex.length !== 512) {
    throw new Error(
      `Invalid proof length: expected 256 bytes (512 hex chars), got ${proofHex.length / 2} bytes`
    );
  }
  const proofBytes = hexToBytes(proofHex, 256);
  return buildPayrollScVals(proofBytes, real.publicInputsHex, ipfsCids);
}

/**
 * Encode a 32-byte big-endian field element as `ScVal::U256` (`UInt256Parts`).
 * Mirrors `field_to_scval_u256` in `app/crates/core/stellar/src/conversions.rs`:
 * hiHi = bytes[0..8], hiLo = bytes[8..16], loHi = bytes[16..24], loLo = bytes[24..32].
 */
function u256ScVal(hex32: string): import("@stellar/stellar-base").xdr.ScVal {
  const bytes = hexToBytes(hex32, 32);
  return xdr.ScVal.scvU256(
    new xdr.UInt256Parts({
      hiHi: new xdr.Uint64(readU64BE(bytes, 0)),
      hiLo: new xdr.Uint64(readU64BE(bytes, 8)),
      loHi: new xdr.Uint64(readU64BE(bytes, 16)),
      loLo: new xdr.Uint64(readU64BE(bytes, 24)),
    })
  );
}

/** Read 8 bytes starting at `offset` as a big-endian unsigned 64-bit BigInt. */
function readU64BE(bytes: Uint8Array, offset: number): bigint {
  let v = BigInt(0);
  for (let i = 0; i < 8; i++) {
    v = (v << BigInt(8)) | BigInt(bytes[offset + i]);
  }
  return v;
}

/**
 * Build Soroban ScVal args for `withdraw(proof, public_inputs, recipient)`.
 *
 * Public inputs for PayrollWithdrawCircuit: [commitmentRoot, commitmentId, nullifier, salaryAmount]
 * Recipient is a Stellar address (ScVal::Address).
 */
export function buildWithdrawScVals(
  proofHex: string,
  publicInputsHex: string[],
  recipientAddress: string
): import("@stellar/stellar-base").xdr.ScVal[] {
  const cleanProof = proofHex.replace(/^0x/i, "");
  if (cleanProof.length !== 512) {
    throw new Error(`Invalid proof length: expected 256 bytes (512 hex chars), got ${cleanProof.length / 2} bytes`);
  }
  const proofBytes = hexToBytes(cleanProof, 256);

  const proofScVal = xdr.ScVal.scvMap([
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("a"),
      val: xdr.ScVal.scvBytes(Buffer.from(proofBytes.subarray(0, 64))),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("b"),
      val: xdr.ScVal.scvBytes(Buffer.from(proofBytes.subarray(64, 192))),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("c"),
      val: xdr.ScVal.scvBytes(Buffer.from(proofBytes.subarray(192, 256))),
    }),
  ]);

  const publicInputsScVal = xdr.ScVal.scvVec(
    publicInputsHex.map((hex) => u256ScVal(hex))
  );

  const recipientScVal = xdr.ScVal.scvAddress(
    StellarSdk.Address.fromString(recipientAddress).toScAddress()
  );

  return [proofScVal, publicInputsScVal, recipientScVal];
}
