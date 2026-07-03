import type { FetchProgress } from "./pkCache";

export type { FetchProgress };

/** Messages exchanged with realProver.worker.ts (mirrored for type-safety). */
interface InitDoneMsg {
  type: "init-done";
  proverVersion: string;
}
interface ProgressMsg {
  type: "progress";
  phase: "pk" | "r1cs" | "circuitWasm" | "proving";
  progress: FetchProgress | null;
}
interface ProveDoneMsg {
  type: "prove-done";
  proofHex: string;
  publicInputsHex: string[];
}
interface ErrorMsg {
  type: "error";
  phase: "init" | "prove";
  message: string;
}
type Outbound = InitDoneMsg | ProgressMsg | ProveDoneMsg | ErrorMsg;

export interface RealProofResult {
  proofHex: string;
  publicInputsHex: string[];
}

export interface RealProverOptions {
  onProgress?: (phase: ProgressMsg["phase"], progress: FetchProgress | null) => void;
}

export type CircuitKind = "payroll" | "withdraw";

/**
 * Host-side handle to the real Groth16 prover running in a Web Worker.
 *
 * Supports configurable circuit artifacts — default is "payroll" (PayrollBatch),
 * pass "withdraw" for PayrollWithdrawCircuit.
 */
export class RealProver {
  private worker: Worker | null = null;
  private initPromise: Promise<string> | null = null;
  private initResolvers: ((v: string) => void)[] = [];
  private initRejecters: ((e: Error) => void)[] = [];
  private progressListener: RealProverOptions["onProgress"];
  private circuit: CircuitKind;

  constructor(circuit: CircuitKind = "payroll", opts: RealProverOptions = {}) {
    this.circuit = circuit;
    this.progressListener = opts.onProgress;
  }

  private ensureWorker() {
    if (this.worker) return;
    this.worker = new Worker(
      new URL("./realProver.worker.ts", import.meta.url),
      { type: "module" }
    );
    this.worker.onmessage = (ev: MessageEvent<Outbound>) => this.onMessage(ev.data);
    this.worker.onerror = (e) => {
      const err = new Error(`prover worker error: ${e.message ?? "unknown"}`);
      this.initRejecters.forEach((r) => r(err));
      this.initRejecters = [];
    };
  }

  private onMessage(msg: Outbound) {
    switch (msg.type) {
      case "progress":
        this.progressListener?.(msg.phase, msg.progress);
        return;
      case "init-done":
        this.initResolvers.forEach((r) => r(msg.proverVersion));
        this.initResolvers = [];
        this.initRejecters = [];
        this.initPromise = null;
        return;
      case "error":
        if (msg.phase === "init") {
          const err = new Error(msg.message);
          this.initRejecters.forEach((r) => r(err));
          this.initRejecters = [];
          this.initPromise = null;
        }
        return;
    }
  }

  /** Initialize the worker + load artifacts. Resolves with the prover version. */
  init(): Promise<string> {
    this.ensureWorker();
    if (this.initPromise) return this.initPromise;
    this.initPromise = new Promise<string>((resolve, reject) => {
      this.initResolvers.push(resolve);
      this.initRejecters.push(reject);
      this.worker!.postMessage({ type: "init", circuit: this.circuit } as const);
    });
    return this.initPromise;
  }

  /** Generate a proof. Must be called after init() resolves. */
  async prove(inputsJson: string): Promise<RealProofResult> {
    await this.init();
    return new Promise<RealProofResult>((resolve, reject) => {
      const handler = (ev: MessageEvent<Outbound>) => {
        const msg = ev.data;
        if (msg.type === "prove-done") {
          this.worker!.removeEventListener("message", handler);
          resolve({ proofHex: msg.proofHex, publicInputsHex: msg.publicInputsHex });
        } else if (msg.type === "error" && msg.phase === "prove") {
          this.worker!.removeEventListener("message", handler);
          reject(new Error(msg.message));
        } else if (msg.type === "progress") {
          this.progressListener?.(msg.phase, msg.progress);
        }
      };
      this.worker!.addEventListener("message", handler);
      this.worker!.postMessage({ type: "prove", inputsJson } as const);
    });
  }

  terminate() {
    this.worker?.terminate();
    this.worker = null;
    this.initPromise = null;
    this.initResolvers = [];
    this.initRejecters = [];
  }
}
