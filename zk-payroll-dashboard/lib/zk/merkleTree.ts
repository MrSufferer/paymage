/**
 * Poseidon2 Merkle tree builder for the payroll employee commitment tree.
 *
 * Uses the same `zkhash` Rust crate (compiled to WASM) that the circom
 * circuits use — parameters are generated from the same Sage script, so
 * hashes are guaranteed consistent between browser and on-chain proof.
 *
 * Tree structure:
 * - Binary tree of depth `levels` (default 10 = 1K leaf capacity, matching
 *   `PayrollBatch(10, 10)` browser variant; `PayrollBatch(20, 500)` for server-side v2).
 * - Leaf = `Poseidon2(3)([employeeId, salaryAmount, salt, ds=0x01])[0]`.
 * - Internal node = `PoseidonCompress(left, right)`.
 * - Unfilled positions use the zero-commitment leaf =
 *   `Poseidon2(3)([0, 0, 0, 0x01])[0]` (NOT field-element 0 — the circuit
 *   computes a commitment for every slot, so padding slots produce this
 *   fixed commitment).
 *
 * Sparse representation: only non-zero nodes are stored, so a tree with 500
 * employees in 1M slots uses ~500 × 20 = 10K map entries, not 1M.
 */

import { z as zod } from "zod";

// ─── WASM loader ──────────────────────────────────────────────────────────

type PoseidonWasm = {
  poseidon2_commitment: (
    emp: string,
    sal: string,
    salt: string,
    ds: string,
  ) => string;
  poseidon2_compress: (l: string, r: string) => string;
  version: () => string;
};

let wasmReady: Promise<PoseidonWasm> | null = null;

async function loadWasm(): Promise<PoseidonWasm> {
  if (!wasmReady) {
    wasmReady = (async () => {
      const mod = await import("./wasm/poseidon/poseidon_wasm.js");
      if (typeof window === "undefined") {
        const importer = new Function("specifier", "return import(specifier)") as (
          specifier: string,
        ) => Promise<typeof import("node:fs/promises")>;
        const { readFile } = await importer("node:fs/promises");
        const wasmBytes = await readFile(
          new URL("./wasm/poseidon/poseidon_wasm_bg.wasm", import.meta.url),
        );
        await mod.default(wasmBytes);
      } else {
        await mod.default();
      }
      return mod as unknown as PoseidonWasm;
    })();
  }
  return wasmReady;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

/** 32-byte zero hex (Fr = 0). */
const ZERO_HEX = "0".padStart(64, "0");

/** Domain separator for salary commitments (DOMAIN_COMMITMENT = 0x01). */
const DS_COMMITMENT = "1".padStart(64, "0");

/** Convert a decimal string to a 32-byte big-endian hex string. */
function decimalToHex32(decimal: string): string {
  const big = BigInt(decimal);
  if (big < BigInt(0)) throw new Error(`negative value: ${decimal}`);
  return big.toString(16).padStart(64, "0");
}

/**
 * Precompute zero hashes for each tree level.
 * zeros[0] = zeroCommitment (the commitment of a zero employee),
 * zeros[k] = compress(zeros[k-1], zeros[k-1]).
 */
async function precomputeZeros(
  compress: (l: string, r: string) => string,
  zeroCommitment: string,
  levels: number,
): Promise<string[]> {
  const zeros: string[] = [zeroCommitment];
  for (let i = 1; i <= levels; i++) {
    zeros[i] = compress(zeros[i - 1], zeros[i - 1]);
  }
  return zeros;
}

// ─── Public types ─────────────────────────────────────────────────────────

export const EmployeeSlotSchema = zod.object({
  employeeId: zod.string(),
  salaryAmount: zod.string(),
  salt: zod.string(),
});
export type EmployeeSlot = zod.infer<typeof EmployeeSlotSchema>;

export interface MerkleProof {
  /** Sibling hashes from leaf to root (levels elements, hex). */
  pathElements: string[];
  /** Leaf index as a decimal string (bits = path directions). */
  pathIndices: string;
  /** The commitment hash for this employee (hex). */
  commitment: string;
}

export interface MerkleTreeResult {
  /** Root hash (hex) — submit to the contract via `set_employee_root`. */
  root: string;
  /**
   * Per-slot proofs for the full batch (real + padding).
   * First `actualEmployeeCount` entries are real; the rest are zero-employee
   * padding slots with `(employeeId=0, salaryAmount=0, salt=0)`.
   */
  proofs: MerkleProof[];
  /** Tree depth. */
  levels: number;
  /** Number of real employees (non-padding). */
  actualEmployeeCount: number;
}

// ─── Tree builder ─────────────────────────────────────────────────────────

/**
 * Build the employee commitment Merkle tree and produce batch proofs.
 *
 * The circuit `PayrollBatch(levels, n)` loops over all `n` slots and verifies
 * a Merkle proof for each. Padding slots use `(employeeId=0, salaryAmount=0,
 * salt=0)` whose commitment is a fixed value — the zero-commitment leaf.
 *
 * @param employees  Real employees (decimal-string fields).
 * @param levels     Tree depth (default 10 = 1K leaves, matching `PayrollBatch(10, 10)`
 *                    browser variant; use 20 for `PayrollBatch(20, 500)` server-side v2).
 * @param batchSize  Circuit batch size `n` (default 10, matching `PayrollBatch(10, 10)`
 *                    browser variant; use 500 for `PayrollBatch(20, 500)` server-side v2).
 * @returns Root + per-slot Merkle proofs (batchSize entries).
 */
export async function buildMerkleTree(
  employees: EmployeeSlot[],
  levels: number = 10,
  batchSize: number = 10,
): Promise<MerkleTreeResult> {
  if (employees.length === 0) {
    throw new Error("Cannot build Merkle tree with zero employees");
  }
  if (employees.length > batchSize) {
    throw new Error(
      `Too many employees (${employees.length}) for batch size ${batchSize}`,
    );
  }
  if (batchSize > 2 ** levels) {
    throw new Error(
      `Batch size ${batchSize} exceeds tree capacity ${2 ** levels}`,
    );
  }

  const wasm = await loadWasm();

  // Zero-commitment = commitment(0, 0, 0, ds=0x01) — the leaf for padding slots.
  const zeroCommitment = wasm.poseidon2_commitment(
    ZERO_HEX,
    ZERO_HEX,
    ZERO_HEX,
    DS_COMMITMENT,
  );

  // Precompute zero hashes for each level.
  const zeros = await precomputeZeros(
    wasm.poseidon2_compress,
    zeroCommitment,
    levels,
  );

  // Compute commitment leaves for real employees.
  const realCommitments = employees.map((emp) => {
    const empHex = decimalToHex32(emp.employeeId);
    const salHex = decimalToHex32(emp.salaryAmount);
    const saltHex = decimalToHex32(emp.salt);
    return wasm.poseidon2_commitment(empHex, salHex, saltHex, DS_COMMITMENT);
  });

  // Sparse tree: layers[k] = Map<nodeIndex, hash> for non-zero-commitment nodes.
  // A node is "non-zero" if it differs from zeros[k] (the precomputed zero hash
  // for that level). This keeps the sparse representation minimal.
  const layers: Map<number, string>[] = [];
  for (let k = 0; k <= levels; k++) {
    layers.push(new Map());
  }

  // Insert real commitments into the sparse tree, propagating hashes upward.
  for (let i = 0; i < realCommitments.length; i++) {
    let nodeIndex = i;
    let hash = realCommitments[i];
    for (let k = 0; k <= levels; k++) {
      // Only store if different from the zero hash (keeps sparse).
      if (hash !== zeros[k]) {
        layers[k].set(nodeIndex, hash);
      }
      if (k === levels) break;
      const siblingIndex = nodeIndex ^ 1;
      const siblingHash = layers[k].get(siblingIndex) ?? zeros[k];
      const parentIndex = nodeIndex >> 1;
      const [left, right] =
        nodeIndex % 2 === 0 ? [hash, siblingHash] : [siblingHash, hash];
      hash = wasm.poseidon2_compress(left, right);
      nodeIndex = parentIndex;
    }
  }

  // Root: stored root at layer[levels][0] or zeros[levels] if tree is all-zero.
  const root = layers[levels].get(0) ?? zeros[levels];

  // Build Merkle proofs for all batchSize slots.
  // Slots 0..n-1: real employees. Slots n..batchSize-1: zero-employee padding.
  const proofs: MerkleProof[] = [];
  for (let slotIdx = 0; slotIdx < batchSize; slotIdx++) {
    const commitment =
      slotIdx < realCommitments.length
        ? realCommitments[slotIdx]
        : zeroCommitment;

    const pathElements: string[] = [];
    let nodeIndex = slotIdx;
    for (let k = 0; k < levels; k++) {
      const siblingIndex = nodeIndex ^ 1;
      const siblingHash = layers[k].get(siblingIndex) ?? zeros[k];
      pathElements.push(siblingHash);
      nodeIndex >>= 1;
    }
    proofs.push({
      pathElements,
      pathIndices: String(slotIdx),
      commitment,
    });
  }

  return {
    root,
    proofs,
    levels,
    actualEmployeeCount: employees.length,
  };
}

/**
 * Compute a single commitment hash without building the full tree.
 * Useful for the admin UI to display commitments before tree construction.
 */
export async function computeCommitment(
  employeeId: string,
  salaryAmount: string,
  salt: string,
): Promise<string> {
  const wasm = await loadWasm();
  return wasm.poseidon2_commitment(
    decimalToHex32(employeeId),
    decimalToHex32(salaryAmount),
    decimalToHex32(salt),
    DS_COMMITMENT,
  );
}

/** WASM poseidon module version (for compatibility checks). */
export async function poseidonVersion(): Promise<string> {
  const wasm = await loadWasm();
  return wasm.version();
}
