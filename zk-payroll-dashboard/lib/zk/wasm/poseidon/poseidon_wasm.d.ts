/* tslint:disable */
/* eslint-disable */

/**
 * Salary commitment leaf: `Poseidon2(3)` = `Permutation(4)([emp, sal, salt, ds])[0]`.
 */
export function poseidon2_commitment(employee_id_hex: string, salary_hex: string, salt_hex: string, ds_hex: string): string;

/**
 * Commitment identifier: `Poseidon2(1)` = `Permutation(2)([commitment, ds])[0]`.
 */
export function poseidon2_commitment_id(commitment_hex: string, ds_hex: string): string;

/**
 * Merkle internal-node hash: `PoseidonCompress()` =
 * `(Permutation(2)([l, r]) + [l, r])[0]`.
 */
export function poseidon2_compress(left_hex: string, right_hex: string): string;

/**
 * Crate version — lets the JS side assert compatibility before hashing.
 */
export function version(): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly poseidon2_commitment: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => void;
    readonly poseidon2_commitment_id: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly poseidon2_compress: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly version: (a: number) => void;
    readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
    readonly __wbindgen_export: (a: number, b: number) => number;
    readonly __wbindgen_export2: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_export3: (a: number, b: number, c: number) => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
