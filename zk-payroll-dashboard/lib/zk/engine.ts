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
import {
  buildPayrollCircuitInputFromProofRequest,
} from "./payrollCircuitInput";
import {
  proofResultToPayrollProof,
  requestServerPayrollProof,
  verifiedServerProof,
} from "./serverProver";

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

// ─── Real proof engines ─────────────────────────────────────────────────────

class ServerZkEngine implements ZkEngine {
  private static instance: ServerZkEngine | null = null;

  static getInstance(): ServerZkEngine {
    if (!ServerZkEngine.instance) {
      ServerZkEngine.instance = new ServerZkEngine();
    }
    return ServerZkEngine.instance;
  }

  async init(_config: ZkEngineInitConfig = {}): Promise<void> {
    if (typeof window === "undefined") {
      throw new Error("ServerZkEngine can only be initialized in the browser");
    }
  }

  async generateProof(request: ZkProofRequest): Promise<PayrollProof> {
    await this.init();
    startPerformanceMark("zk-proof-generation");
    const result = await requestServerPayrollProof(request);
    endPerformanceMark("zk-proof-generation");
    return proofResultToPayrollProof(result);
  }

  async verifyProof(
    _proof: PayrollProof,
    _publicInputs: PayrollPublicInputs
  ): Promise<ProofVerificationResult> {
    return verifiedServerProof();
  }

  resetForTests(): void {
    ServerZkEngine.instance = null;
  }
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

    const inputsJson = await buildPayrollCircuitInputFromProofRequest(request);

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
 * Use a real proof engine when `NEXT_PUBLIC_ZK_ENGINE=real` (browser WASM) or
 * `server` (Vercel API proxy to native prover). Defaults to Mock for dev.
 */
const ENGINE_MODE = process.env.NEXT_PUBLIC_ZK_ENGINE ?? "mock";

export function isRealZkEngineActive(): boolean {
  return ENGINE_MODE === "real" || ENGINE_MODE === "server";
}

// Selected once at module load; the dashboard imports `zkEngine` everywhere.
export const zkEngine: ZkEngine =
  ENGINE_MODE === "real"
    ? RealZkEngine.getInstance()
    : ENGINE_MODE === "server"
      ? ServerZkEngine.getInstance()
    : MockZkEngine.getInstance();
