import { describe, it, expect } from "vitest";
import { toSorobanScValsFromRealProof } from "@/lib/zk/serialize";
import type { RealProofResult } from "@/lib/zk/realProver";

/** 64-byte hex pattern "00..03" repeated — valid-looking uncompressed G1. */
function hexOf(bytes: number[]): string {
  return bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** 256-byte proof = A(64) || B(128) || C(64), each byte = its offset mod 256. */
function fakeProofHex(): string {
  const bytes = Array.from({ length: 256 }, (_, i) => i);
  return hexOf(bytes);
}

/** 32-byte Fr element, all bytes = `fill`. */
function fakeFrHex(fill: number): string {
  return hexOf(Array.from({ length: 32 }, () => fill));
}

describe("toSorobanScValsFromRealProof", () => {
  it("splits the 256-byte proof into A(64) || B(128) || C(64) and emits 3 args", () => {
    const real: RealProofResult = {
      proofHex: fakeProofHex(),
      publicInputsHex: [fakeFrHex(0x11), fakeFrHex(0x22), fakeFrHex(0x33)],
    };

    const args = toSorobanScValsFromRealProof(real);

    expect(args).toHaveLength(3);
  });

  it("rejects a proof shorter than 256 bytes", () => {
    const real: RealProofResult = {
      proofHex: hexOf(Array.from({ length: 255 }, (_, i) => i)),
      publicInputsHex: [fakeFrHex(1), fakeFrHex(2), fakeFrHex(3)],
    };

    expect(() => toSorobanScValsFromRealProof(real)).toThrow(/256 bytes/);
  });

  it("rejects fewer than 3 public inputs", () => {
    const real: RealProofResult = {
      proofHex: fakeProofHex(),
      publicInputsHex: [fakeFrHex(1), fakeFrHex(2)],
    };

    expect(() => toSorobanScValsFromRealProof(real)).toThrow(/3 public inputs/);
  });

  it("works without ipfsCids", () => {
    const real: RealProofResult = {
      proofHex: fakeProofHex(),
      publicInputsHex: [fakeFrHex(1), fakeFrHex(2), fakeFrHex(3)],
    };

    expect(() => toSorobanScValsFromRealProof(real)).not.toThrow();
  });
});
