import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the WASM module with deterministic hash functions for testing tree logic.
// Uses a simple BigInt-based hash to preserve full input entropy (no truncation).
function simpleHash(input: string): string {
  let h = BigInt(0);
  const mod = BigInt(1) << BigInt(256);
  for (let i = 0; i < input.length; i++) {
    h = (h * BigInt(31) + BigInt(input.charCodeAt(i))) % mod;
  }
  return h.toString(16).padStart(64, "0");
}

const mockCompress = (l: string, r: string) => simpleHash(`C:${l}:${r}`);
const mockCommitment = (emp: string, sal: string, salt: string, ds: string) =>
  simpleHash(`M:${emp}:${sal}:${salt}:${ds}`);

vi.mock("./wasm/poseidon/poseidon_wasm.js", () => ({
  default: vi.fn(async () => {}),
  poseidon2_commitment: vi.fn(mockCommitment),
  poseidon2_compress: vi.fn(mockCompress),
  version: vi.fn(() => "test-mock"),
}));

import { buildMerkleTree, computeCommitment } from "./merkleTree";

describe("merkleTree", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("buildMerkleTree", () => {
    it("throws on zero employees", async () => {
      await expect(buildMerkleTree([], 4, 8)).rejects.toThrow(
        "zero employees",
      );
    });

    it("throws when employees exceed batch size", async () => {
      const emps = Array.from({ length: 9 }, (_, i) => ({
        employeeId: String(i),
        salaryAmount: "100",
        salt: "0",
      }));
      await expect(buildMerkleTree(emps, 4, 8)).rejects.toThrow(
        "Too many employees",
      );
    });

    it("produces batchSize proofs", async () => {
      const emps = [{ employeeId: "1", salaryAmount: "500", salt: "0" }];
      const tree = await buildMerkleTree(emps, 4, 8);
      expect(tree.proofs).toHaveLength(8);
      expect(tree.actualEmployeeCount).toBe(1);
      expect(tree.levels).toBe(4);
    });

    it("root is deterministic for the same input", async () => {
      const emps = [{ employeeId: "1", salaryAmount: "500", salt: "0" }];
      const tree1 = await buildMerkleTree(emps, 4, 8);
      const tree2 = await buildMerkleTree(emps, 4, 8);
      expect(tree1.root).toBe(tree2.root);
    });

    it("root changes when employee data changes", async () => {
      const tree1 = await buildMerkleTree(
        [{ employeeId: "1", salaryAmount: "500", salt: "0" }],
        4,
        8,
      );
      const tree2 = await buildMerkleTree(
        [{ employeeId: "1", salaryAmount: "501", salt: "0" }],
        4,
        8,
      );
      expect(tree1.root).not.toBe(tree2.root);
    });

    it("pathElements has exactly `levels` entries per proof", async () => {
      const emps = [{ employeeId: "1", salaryAmount: "500", salt: "0" }];
      const tree = await buildMerkleTree(emps, 5, 8);
      for (const proof of tree.proofs) {
        expect(proof.pathElements).toHaveLength(5);
      }
    });

    it("pathIndices matches the slot index", async () => {
      const emps = [{ employeeId: "1", salaryAmount: "500", salt: "0" }];
      const tree = await buildMerkleTree(emps, 4, 8);
      tree.proofs.forEach((proof, i) => {
        expect(proof.pathIndices).toBe(String(i));
      });
    });

    it("padding slots have the zero-commitment as their commitment", async () => {
      const emps = [{ employeeId: "1", salaryAmount: "500", salt: "0" }];
      const tree = await buildMerkleTree(emps, 4, 8);
      // Slot 0 is real, slots 1-7 are padding (zero-employee).
      expect(tree.proofs[0].commitment).not.toBe(tree.proofs[1].commitment);
      // All padding slots share the same commitment (zero-employee).
      for (let i = 1; i < 8; i++) {
        expect(tree.proofs[i].commitment).toBe(tree.proofs[1].commitment);
      }
    });

    it("root differs from any leaf or zero hash", async () => {
      const emps = [{ employeeId: "1", salaryAmount: "500", salt: "0" }];
      const tree = await buildMerkleTree(emps, 4, 8);
      for (const proof of tree.proofs) {
        expect(tree.root).not.toBe(proof.commitment);
      }
    });

    it("proofs for different slots have different pathElements", async () => {
      const emps = [{ employeeId: "1", salaryAmount: "500", salt: "0" }];
      const tree = await buildMerkleTree(emps, 4, 8);
      // Slot 0 and slot 1 are siblings — their pathElements differ at level 0.
      expect(tree.proofs[0].pathElements[0]).not.toBe(
        tree.proofs[1].pathElements[0],
      );
    });

    it("supports multiple real employees", async () => {
      const emps = [
        { employeeId: "1", salaryAmount: "500", salt: "10" },
        { employeeId: "2", salaryAmount: "600", salt: "20" },
        { employeeId: "3", salaryAmount: "700", salt: "30" },
      ];
      const tree = await buildMerkleTree(emps, 4, 8);
      expect(tree.actualEmployeeCount).toBe(3);
      // First 3 commitments are unique (real employees).
      const realCommitments = new Set(
        tree.proofs.slice(0, 3).map((p) => p.commitment),
      );
      expect(realCommitments.size).toBe(3);
      // Padding commitments are all the same.
      const padCommitments = new Set(
        tree.proofs.slice(3).map((p) => p.commitment),
      );
      expect(padCommitments.size).toBe(1);
    });
  });

  describe("computeCommitment", () => {
    it("returns a 64-char hex string", async () => {
      const c = await computeCommitment("1", "500", "0");
      expect(c).toHaveLength(64);
    });

    it("is deterministic", async () => {
      const c1 = await computeCommitment("1", "500", "0");
      const c2 = await computeCommitment("1", "500", "0");
      expect(c1).toBe(c2);
    });

    it("differs for different inputs", async () => {
      const c1 = await computeCommitment("1", "500", "0");
      const c2 = await computeCommitment("2", "500", "0");
      expect(c1).not.toBe(c2);
    });
  });
});
