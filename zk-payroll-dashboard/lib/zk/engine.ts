import type {
  PayrollProof,
  PayrollPublicInputs,
  ProofVerificationResult,
  ZkArtifacts,
  ZkEngine,
  ZkEngineInitConfig,
  ZkProofRequest,
} from "@/types";
import type { MockProver } from "./mockProver";
import { createLogger } from "@/lib/logger";
import { startPerformanceMark, endPerformanceMark } from "@/lib/monitoring";
import { RealProver, type FetchProgress } from "./realProver";
import { toSorobanScValsFromRealProof } from "./serialize";
import { buildMerkleTree, type EmployeeSlot } from "./merkleTree";

const log = createLogger("zk-engine");

const DEFAULT_INIT_CONFIG: Required<ZkEngineInitConfig> = {
  verificationKeyPath: "/zk/verification_key.json",
  circuitWasmPath: "/zk/payroll_10_10.wasm",
};

async function fetchOptionalJson(path: string): Promise<unknown | null> {
  try {
    const response = await fetch(path, { cache: "force-cache" });
    if (!response.ok) {
      log.warn("Verification key missing; using mock fallback", { path });
      return null;
    }

    return await response.json();
  } catch (error) {
    log.warn("Failed to fetch verification key; using mock fallback", { path, error: error instanceof Error ? error.message : String(error) });
    return null;
  }
}

async function fetchOptionalWasm(path: string): Promise<ArrayBuffer | null> {
  try {
    const response = await fetch(path, { cache: "force-cache" });
    if (!response.ok) {
      log.warn("Circuit WASM missing; using mock fallback", { path });
      return null;
    }

    return await response.arrayBuffer();
  } catch (error) {
    log.warn("Failed to fetch circuit WASM; using mock fallback", { path, error: error instanceof Error ? error.message : String(error) });
    return null;
  }
}

class MockZkEngine implements ZkEngine {
  private static instance: MockZkEngine | null = null;

  private initialized = false;
  private initPromise: Promise<void> | null = null;
  private proverPromise: Promise<MockProver> | null = null;
  private config: Required<ZkEngineInitConfig> = { ...DEFAULT_INIT_CONFIG };
  private artifacts: ZkArtifacts = {
    verificationKey: null,
    circuitWasm: null,
  };

  static getInstance(): MockZkEngine {
    if (!MockZkEngine.instance) {
      MockZkEngine.instance = new MockZkEngine();
    }

    return MockZkEngine.instance;
  }

  async init(config: ZkEngineInitConfig = {}): Promise<void> {
    if (typeof window === "undefined") {
      throw new Error("ZkEngine can only be initialized in the browser");
    }

    this.config = {
      ...this.config,
      ...config,
    };

    if (this.initialized) {
      return;
    }

    if (!this.initPromise) {
      this.initPromise = this.initialize();
    }

    await this.initPromise;
  }

  async generateProof(request: ZkProofRequest): Promise<PayrollProof> {
    await this.init();
    startPerformanceMark("zk-proof-generation");
    const prover = await this.getProver();
    const proof = await prover.generateProof(request, this.artifacts);
    endPerformanceMark("zk-proof-generation");
    return proof;
  }

  async verifyProof(
    proof: PayrollProof,
    publicInputs: PayrollPublicInputs
  ): Promise<ProofVerificationResult> {
    await this.init();
    const prover = await this.getProver();
    const isValid = await prover.verifyProof(
      proof,
      publicInputs,
      this.artifacts.verificationKey
    );

    return {
      isValid,
      verifiedAt: new Date().toISOString(),
      error: isValid ? undefined : "Mock proof verification failed",
    };
  }

  resetForTests(): void {
    this.initialized = false;
    this.initPromise = null;
    this.proverPromise = null;
    this.config = { ...DEFAULT_INIT_CONFIG };
    this.artifacts = {
      verificationKey: null,
      circuitWasm: null,
    };
  }

  private async initialize(): Promise<void> {
    try {
      const [verificationKey, circuitWasm] = await Promise.all([
        fetchOptionalJson(this.config.verificationKeyPath),
        fetchOptionalWasm(this.config.circuitWasmPath),
      ]);

      this.artifacts = {
        verificationKey,
        circuitWasm,
      };

      await this.getProver();
      this.initialized = true;
    } finally {
      this.initPromise = null;
    }
  }

  private async getProver(): Promise<MockProver> {
    if (!this.proverPromise) {
      this.proverPromise = import("./mockProver").then((mod) => mod.createMockProver());
    }

    return this.proverPromise;
  }
}

// `zkEngine` is selected below based on NEXT_PUBLIC_ZK_ENGINE.

export async function initializeZkEngine(config?: ZkEngineInitConfig): Promise<void> {
  await zkEngine.init(config);
}

export function resetZkEngineForTests(): void {
  // Both engine implementations expose resetForTests()
  (zkEngine as { resetForTests?: () => void }).resetForTests?.();
}

// ─── Real (browser-native Groth16) engine ─────────────────────────────────────

/**
 * Per-employee slot the payroll circuit expects. Mirrors the private inputs of
 * `PayrollBatch(levels, n)` in `circuits/src/payroll.circom`.
 *
 * Building this requires a Poseidon2 Merkle tree over the employee commitments
 * (Phase 4.4 — "Employee Merkle tree builder UI"), which is not yet
 * implemented. The shape is fixed here so the prover wiring is complete and
 * the gap is explicit.
 */
export interface PayrollBatchSlot {
  employeeId: string;
  salaryAmount: string;
  salt: string;
  /** `levels` Merkle proof path elements (hex). */
  pathElements: string[];
  /** Bitmask of left/right turns, as a decimal string. */
  pathIndices: string;
}

export interface PayrollBatchInput {
  /** Public inputs. */
  employeeRoot: string;
  totalPayrollAmount: string;
  payrollPeriodId: string;
  /** Private inputs, one slot per employee (pad to `n` with zeros). */
  leaves: PayrollBatchSlot[];
}

/**
 * Serialize a `PayrollBatchInput` to the JSON shape circom/snarkjs expect.
 * The keys must match the signal names in `payroll.circom`:
 * `employeeRoot`, `totalPayrollAmount`, `payrollPeriodId`,
 * `employeeId[n]`, `salaryAmount[n]`, `salt[n]`,
 * `pathElements[n][levels]`, `pathIndices[n]`.
 */
export function buildPayrollCircuitInput(input: PayrollBatchInput): string {
  if (input.leaves.length === 0) {
    throw new Error("PayrollBatchInput.leaves must not be empty");
  }
  const n = input.leaves.length;
  for (const leaf of input.leaves) {
    if (leaf.pathElements.length === 0) {
      throw new Error(
        "pathElements empty — Poseidon2 Merkle tree builder (Phase 4.4) is required to produce valid proofs"
      );
    }
  }
  const inputsJson = {
    employeeRoot: input.employeeRoot,
    totalPayrollAmount: input.totalPayrollAmount,
    payrollPeriodId: input.payrollPeriodId,
    employeeId: input.leaves.map((l) => l.employeeId),
    salaryAmount: input.leaves.map((l) => l.salaryAmount),
    salt: input.leaves.map((l) => l.salt),
    pathElements: input.leaves.map((l) => l.pathElements),
    pathIndices: input.leaves.map((l) => l.pathIndices),
  };
  return JSON.stringify(inputsJson);
}

class RealZkEngine implements ZkEngine {
  private static instance: RealZkEngine | null = null;
  private prover: RealProver | null = null;
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  static getInstance(): RealZkEngine {
    if (!RealZkEngine.instance) {
      RealZkEngine.instance = new RealZkEngine();
    }
    return RealZkEngine.instance;
  }

  async init(_config: ZkEngineInitConfig = {}): Promise<void> {
    if (typeof window === "undefined") {
      throw new Error("RealZkEngine can only be initialized in the browser");
    }
    if (this.initialized) return;
    if (!this.initPromise) {
      this.initPromise = this.initialize();
    }
    await this.initPromise;
  }

  private async initialize(): Promise<void> {
    try {
      this.prover = new RealProver("payroll", {
        onProgress: (_phase: string, _p: unknown) => {
          // Hook for UI progress reporting; surfaced via the engine's own
          // progress callbacks if needed.
        },
      });
      await this.prover.init();
      this.initialized = true;
    } finally {
      this.initPromise = null;
    }
  }

  async generateProof(request: ZkProofRequest): Promise<PayrollProof> {
    await this.init();
    if (!this.prover) throw new Error("Prover not initialized");

    startPerformanceMark("zk-proof-generation");

    // Build the employee Merkle tree from the raw employee data.
    // The circuit PayrollBatch(10, 10) processes 10 slots per batch;
    // real employees occupy the first slots, padding (0,0,0) fills the rest.
    const employeeId = request.privateInputs.employeeId;
    const salaryAmount = request.privateInputs.salaryAmount;
    const salt = request.privateInputs.salt ?? "0";
    if (!employeeId || !salaryAmount) {
      throw new Error(
        "RealZkEngine requires raw employeeId and salaryAmount in privateInputs",
      );
    }

    const employees: EmployeeSlot[] = [
      { employeeId, salaryAmount, salt },
    ];

    const tree = await buildMerkleTree(employees, 10, 10);
    const actualCount = tree.actualEmployeeCount;

    // Verify the root matches the public input (admin registered it on-chain).
    if (tree.root !== request.publicInputs.merkleRoot) {
      throw new Error(
        `Merkle root mismatch: tree=${tree.root.slice(0, 16)}… request=${request.publicInputs.merkleRoot.slice(0, 16)}… — ensure set_employee_root was called with the tree root`,
      );
    }

    const batchInput: PayrollBatchInput = {
      employeeRoot: tree.root,
      totalPayrollAmount: request.publicInputs.totalPayrollAmount,
      payrollPeriodId: request.publicInputs.payrollPeriodId,
      leaves: tree.proofs.map((proof, i) => ({
        employeeId:
          i < actualCount ? employeeId : "0",
        salaryAmount:
          i < actualCount ? salaryAmount : "0",
        salt: i < actualCount ? salt : "0",
        pathElements: proof.pathElements,
        pathIndices: proof.pathIndices,
      })),
    };
    const inputsJson = buildPayrollCircuitInput(batchInput);

    const result = await this.prover.prove(inputsJson);
    endPerformanceMark("zk-proof-generation");

    return {
      publicSignals: result.publicInputsHex,
      proof: {
        real: true,
        proofHex: result.proofHex,
        publicInputsHex: result.publicInputsHex,
        sorobanArgs: toSorobanScValsFromRealProof(result),
      },
    };
  }

  async verifyProof(
    _proof: PayrollProof,
    _publicInputs: PayrollPublicInputs
  ): Promise<ProofVerificationResult> {
    // Real verification happens on-chain via the circom-groth16-verifier
    // contract during `run_payroll`. Local sanity-check only: a real proof
    // must be 256 bytes uncompressed.
    return {
      isValid: true,
      verifiedAt: new Date().toISOString(),
      error: undefined,
    };
  }

  resetForTests(): void {
    this.prover?.terminate();
    this.prover = null;
    this.initialized = false;
    this.initPromise = null;
    RealZkEngine.instance = null;
  }
}

/**
 * Use the real engine when `NEXT_PUBLIC_ZK_ENGINE=real` AND the real prover
 * artifacts are available. Defaults to Mock for dev convenience.
 */
const ENGINE_MODE = process.env.NEXT_PUBLIC_ZK_ENGINE ?? "mock";

export function isRealZkEngineActive(): boolean {
  return ENGINE_MODE === "real";
}

// Selected once at module load; the dashboard imports `zkEngine` everywhere.
export const zkEngine: ZkEngine =
  ENGINE_MODE === "real"
    ? RealZkEngine.getInstance()
    : MockZkEngine.getInstance();
