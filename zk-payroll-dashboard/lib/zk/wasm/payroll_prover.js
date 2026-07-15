export default async function init() {
  return undefined;
}

export function generate_proof() {
  throw new Error(
    "Payroll prover WASM binding is not generated. Run wasm-pack build for app/crates/payroll-prover and copy payroll_prover_bg.wasm before using NEXT_PUBLIC_ZK_ENGINE=real.",
  );
}

export function version() {
  return "missing-payroll-prover-wasm";
}
