/// <reference lib="webworker" />

import {
  getArtifact,
  requestPersistentStorage,
  type FetchProgress,
} from "./pkCache";
import { payrollArtifactRefs, withdrawArtifactRefs } from "./artifacts";
import init, {
  generate_proof,
  version as proverVersion,
} from "./wasm/payroll_prover.js";

interface InitMsg {
  type: "init";
  circuit?: "payroll" | "withdraw";
}
interface ProveMsg {
  type: "prove";
  inputsJson: string;
}
type Inbound = InitMsg | ProveMsg;

export interface InitDoneMsg {
  type: "init-done";
  proverVersion: string;
}
export interface ProgressMsg {
  type: "progress";
  phase: "pk" | "r1cs" | "circuitWasm" | "proving";
  progress: FetchProgress | null;
}
export interface ProveDoneMsg {
  type: "prove-done";
  proofHex: string;
  publicInputsHex: string[];
}
export interface ErrorMsg {
  type: "error";
  phase: "init" | "prove";
  message: string;
}
export type Outbound = InitDoneMsg | ProgressMsg | ProveDoneMsg | ErrorMsg;

let pkBytes: Uint8Array | null = null;
let r1csBytes: Uint8Array | null = null;
let circuitWasmBytes: Uint8Array | null = null;
let ready = false;

function post(msg: Outbound) {
  (self as unknown as Worker).postMessage(msg);
}

function postProgress(phase: ProgressMsg["phase"], progress: FetchProgress | null) {
  post({ type: "progress", phase, progress });
}

async function loadArtifacts(circuit: "payroll" | "withdraw") {
  const refs = circuit === "withdraw" ? withdrawArtifactRefs() : payrollArtifactRefs();
  const persisted = await requestPersistentStorage();
  console.info("[prover-worker] persistent storage requested, persisted =", persisted);

  const pkBuf = await getArtifact(refs.provingKey, (p) => postProgress("pk", p));
  pkBytes = new Uint8Array(pkBuf);

  const r1csBuf = await getArtifact(refs.r1cs, (p) => postProgress("r1cs", p));
  r1csBytes = new Uint8Array(r1csBuf);

  const wasmBuf = await getArtifact(refs.circuitWasm, (p) => postProgress("circuitWasm", p));
  circuitWasmBytes = new Uint8Array(wasmBuf);
}

async function ensureInit(circuit: "payroll" | "withdraw" = "payroll") {
  if (ready) return;
  await loadArtifacts(circuit);

  const wasmUrl = new URL("./wasm/payroll_prover_bg.wasm", import.meta.url);
  await init(wasmUrl);

  ready = true;
}

async function handleInit(circuit?: "payroll" | "withdraw") {
  try {
    await ensureInit(circuit);
    post({ type: "init-done", proverVersion: proverVersion() });
  } catch (err) {
    post({
      type: "error",
      phase: "init",
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

async function handleProve(inputsJson: string) {
  try {
    await ensureInit();
    postProgress("proving", null);

    if (!pkBytes || !r1csBytes || !circuitWasmBytes) {
      throw new Error("Artifacts not loaded");
    }
    const resultJson = generate_proof(
      pkBytes,
      r1csBytes,
      circuitWasmBytes,
      inputsJson
    );
    const parsed = JSON.parse(resultJson) as {
      proof_hex: string;
      public_inputs_hex: string[];
    };
    post({
      type: "prove-done",
      proofHex: parsed.proof_hex,
      publicInputsHex: parsed.public_inputs_hex,
    });
  } catch (err) {
    post({
      type: "error",
      phase: "prove",
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

self.onmessage = (ev: MessageEvent<Inbound>) => {
  const msg = ev.data;
  if (msg.type === "init") {
    void handleInit(msg.circuit);
  } else if (msg.type === "prove") {
    void handleProve(msg.inputsJson);
  }
};
