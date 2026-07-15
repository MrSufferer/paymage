export default function init(input?: RequestInfo | URL | WebAssembly.Module): Promise<void>;
export function generate_proof(
  provingKey: Uint8Array,
  r1cs: Uint8Array,
  circuitWasm: Uint8Array,
  inputsJson: string,
): string;
export function version(): string;
