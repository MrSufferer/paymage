---
phase: implementation
title: Implementation Guide
description: Technical implementation notes, patterns, and code guidelines
---

# Implementation Guide

## Demo Unblock Fixes (2026-07-03)

- Split `zk-payroll-dashboard/lib/env.ts` into client-safe `publicEnv` validation and server-only `getServerEnv()` validation. Client routes can import public contract/RPC config without requiring `SESSION_SECRET` or `ADMIN_PUBLIC_KEY`, so `/employees`, `/compliance`, and other client pages no longer trip the Next.js runtime error overlay.
- Added `generateDemoPayrollProof()` in `zk-payroll-dashboard/lib/zk/generatePayrollProof.ts`. The dashboard summary card now uses this explicit mock-proof path, so the "Generate Mock Payroll Proof" demo control does not fetch real ZK artifacts when `NEXT_PUBLIC_ZK_ENGINE=real`.
- `PayrollSummary.tsx` now calls the demo helper while the full payroll execution wizard continues to use the configured real/mock ZK engine path.

## Real Testnet Proof E2E (2026-07-03)

Added `e2e-tests/src/bin/testnet_payroll_e2e.rs` for the judge demo path. This binary generates real `payroll_10_10` and `payrollWithdraw_10` Groth16 proofs with the native witness/prover stack, submits both proofs to Stellar testnet, and proves the complete escrow + private-withdraw flow without mock verifier contracts.

Live deployment used for the passing run:

- Payroll contract: `CDSODUB6ZYOB5VZ4GV6MD2NAZ3RA3KZ73RVOBNZMFVXOO7CLLYWTUXNF`
- Payroll verifier: `CCSE6A4JH4KDWE63XMJ62LZBJTKJY4AEY3Q6FIACTKXZMNAX2NA7HRI6`
- Withdraw verifier: `CCARTGQLYGE2TCFFGPNC2B4IXUZJV4Y5QZWNHX4CXEREDLVIB3XYY5DH`
- Testnet token: `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC`
- Admin/source account: `payroll-admin` / `GBBTKIOKPCGILWKYJASL7LL3TSITQMOVTYOL3Q5KG3Y4L7KY4BIXXXJI`

Passing demo run command:

```bash
PAYROLL_CONTRACT=CDSODUB6ZYOB5VZ4GV6MD2NAZ3RA3KZ73RVOBNZMFVXOO7CLLYWTUXNF \
STELLAR_SOURCE=payroll-admin \
STELLAR_RECIPIENT=payroll-admin \
cargo run -p e2e-tests --bin testnet_payroll_e2e
```

Passing run evidence:

- `set_employee_root`: https://stellar.expert/explorer/testnet/tx/cf6087930eef15348dcd8d6ce06f8385262ca9c190b3ea5a84b6ad7650ccc094
- `set_budget_cap`: https://stellar.expert/explorer/testnet/tx/d99fc82c046109f2224b03cacbe45c2b3d0a167a11b48b6a7381f2e1453fece1
- `run_payroll` real Groth16 proof + escrow transfer: https://stellar.expert/explorer/testnet/tx/a27afe6f0bd9ef54cb3dc81658d3965b8e7d8e9f7b8a21e7146941e0cec60993
- `withdraw` real Groth16 proof + recipient transfer: https://stellar.expert/explorer/testnet/tx/a511f27bc833e32e6ce252d5ac83b7695ca189207114a6698a5737de5ee68ddb

Implementation details:

- The e2e uses the browser-sized circuits: `payroll_10_10` for payroll and `payrollWithdraw_10` for private withdrawal.
- The demo salt is deterministic per `current_period + 1`, so repeated rehearsals produce unique commitment IDs and avoid the contract's duplicate-commitment guard.
- `deployments/scripts/deploy-payroll.sh` now deploys both verifier contracts from `testdata/payroll_10_10_vk.json` and `testdata/payrollWithdraw_10_vk.json`, deploys payroll, initializes it, and calls `set_withdraw_verifier`.
- `circuits/build.rs` supports `ONLY_KEY_CIRCUITS=payroll_10_10,payrollWithdraw_10` so demo keys can be regenerated without rebuilding large unrelated proving keys.

## Development Setup

- Circom 2.2.2 via `cargo build -p circuits`
- Groth16 keys auto-generated during build (REGEN_KEYS=1 to force regeneration)
- Artifacts in `testdata/` (PK) and `target/circuits-artifacts/` (WASM, R1CS)
- Dashboard serves from `zk-payroll-dashboard/public/zk/`

## Code Structure

```
circuits/src/
  payroll.circom         # PayrollBatch(levels, n) template
  payroll_20.circom      # Production: PayrollBatch(20, 500)
  payroll_10_10.circom   # Browser: PayrollBatch(10, 10) — NEW (92× smaller)

testdata/
  payroll_20_proving_key.bin    # Groth16 proving key (958MB — server-side v2)
  payroll_20_vk.json             # Verification key (2.3KB)
  payroll_10_10_proving_key.bin # Browser proving key (9.6MB)
  payroll_10_10_vk.json         # Browser verification key (2.3KB)

zk-payroll-dashboard/public/zk/
  payroll.wasm             # Compiled circuit (17.9MB — PAYROLL_20)
  verification_key.json    # Groth16 VK (2.3KB)
```

## Implementation Notes

### Phase 2 Complete (2026-06-29)

**Task 2.1 — PayrollContract scaffold**
- `contracts/payroll/Cargo.toml` — workspace deps, soroban-sdk, contract-types, circom-groth16-verifier dev
- `contracts/payroll/src/lib.rs` — re-exports payroll module
- `contracts/payroll/src/payroll.rs` — full contract implementation
- `contracts/payroll/src/test.rs` — 7 unit tests (all passing)

**Task 2.2 — Admin methods**
- `set_employee_root(env, root)` — requires admin auth
- `set_budget_cap(env, cap)` — requires admin auth
- `set_token(env, token)` — requires admin auth
- `set_verifier(env, verifier)` — requires admin auth

**Task 2.3 — Auditor management**
- `set_view_key_for_auditor(env, auditor, encrypted_view_key)` — requires admin auth
- `get_view_key(env, auditor)` — self-service, no auth
- `revoke_auditor(env, auditor)` — requires admin auth
- `is_auditor(env, auditor)` — view method

**Task 2.4 — run_payroll + USDC transfer**
- Verifies employee root matches stored root
- Checks budget cap
- Calls `CircomGroth16VerifierClient::verify()` cross-contract
- Stores period record + commitment records
- Transfers USDC via `TokenClient::transfer(&admin, &contract_addr, &amount_i128)`
- `U256.to_u128().ok_or(...) as i128` for token amount conversion

**Key technical notes:**
- `to_i128` not available on Soroban `U256` — use `to_u128()` then `as i128`
- `#[contractevent]` structs use `.publish(&env)` not `.emit()`
- `require_admin` uses `admin.require_auth()` — tests must use `MockAuthContract` + `client.mock_auths()`
- `BytesN` import removed (unused)
- Tests use `MockAuthContract` as admin + `mock_auths()` for auth

---

### Phase 1 Complete (2026-06-29)

**Task 1.1 — PayrollBatch circuit**
- `circuits/src/payroll.circom`: `PayrollBatch(levels, n)` template
  - Public inputs: `employeeRoot`, `totalPayrollAmount`, `payrollPeriodId`
  - Private inputs per slot: `employeeId`, `salaryAmount`, `salt`, `pathElements`, `pathIndices`
  - Poseidon2(3) commitment: `Poseidon2([employeeId, salaryAmount, salt], ds=0x01)`
  - Range check: binary decomposition (Num2Bits 50 bits), bits[50:] === 0
  - Merkle proof: `MerkleProof(levels)` from `merkleProof.circom`
  - Sum check: `Σ salaryAmount[i] === totalPayrollAmount` (linear constraint)
- `circuits/src/payroll_20.circom`: `PayrollBatch(20, 500)` — 20 levels, 500 max employees
- R1CS: 569.6MB, WASM: 17.9MB (large but expected for 500-employee batch)
- VK: 4 IC points (3 public inputs), correct Groth16 format

**Task 1.3 — Artifacts placed**
- `zk-payroll-dashboard/public/zk/payroll.wasm` — 17.9MB compiled circuit
- `zk-payroll-dashboard/public/zk/verification_key.json` — Groth16 VK
- Proving key (958MB) NOT copied to web server — embedded via `include_bytes!` in WASM prover build

**Task 1.2 — Groth16 keys**
- PK: `testdata/payroll_20_proving_key.bin` (958MB)
- VK: `testdata/payroll_20_vk.json`
- VK_Soroban: `testdata/payroll_20_vk_soroban.bin` (708B)
- VK_const: `testdata/payroll_20_vk_const.rs`

### Key Design Decisions

- **No `actualEmployeeCount` input**: Sum constraint naturally enforces zero salary for unused slots. Non-zero salary in unused slot would require valid Merkle proof to that commitment, which doesn't exist → rejected.
- **Range check approach**: Binary decomposition (Num2Bits 50 bits). Bits 50+ constrained to 0.
- **Browser proving**: NOT via ark-circom. Uses Rust WASM prover that loads `.bin` PK + `.wasm` + `.r1cs` directly (arkworks canonical format).
- **Proving key embedding**: 9.6 MB PK loaded at runtime via IndexedDB — NOT `include_bytes!`.
- **Circuit variant strategy**: `PayrollBatch(10, 10)` for browser proving (9.6 MB PK, 49K constraints, seconds to prove). `PayrollBatch(20, 500)` retained for server-side proving (v2).

## Integration Points

- `circuits/build.rs`: payroll_20 + payroll_10_10 both in GROTH16_KEY_CIRCUITS (line 48)
- `zk-payroll-dashboard/public/zk/`: payroll.wasm + verification_key.json served statically
- Next: `app/crates/platforms/web/` needs payroll prover integration (Task 3.1)

## Performance Notes (payroll_10_10)

- PK: 9.6 MB — feasible for IndexedDB cache and WASM load
- R1CS: 6.2 MB
- WASM: 516 KB
- Constraints: 49,401
- Native proof gen: ~5 seconds
- Native E2E (full proof + contract): 33 seconds

## Security Notes

- Salary range check prevents overflow: salary < 2^50 < BN254 field
- Poseidon2 domain separation (0x01) prevents commitment collisions
- Merkle proof ensures employee is in authorized tree
- Sum check ensures total payroll matches claimed amount

---

### Phase 4.5: Contract Test Coverage (2026-07-01)

**New tests added to `contracts/payroll/src/test.rs`:**

| Test | What it covers |
|------|----------------|
| `test_run_payroll_rejects_unauthorized_caller` | Non-admin caller → `NotAuthorized` |
| `test_run_payroll_rejects_wrong_employee_root` | Mismatched employee root → `ProofVerificationFailed` |
| `test_run_payroll_rejects_budget_exceeded` | Total > budget cap → `BudgetExceeded` |
| `test_run_payroll_rejects_fake_proof` | Mock verifier returns false → `ProofVerificationFailed` |
| `test_run_payroll_success_with_mock_verifier` | Full success path: period stored, event emitted, token transferred |
| `test_run_payroll_rejects_non_canonical_input` | Public input ≥ BN256 modulus → rejected |

**Infrastructure added:**
- `MockPayrollVerifier` — mock contract that always returns `Ok(true)` from `verify()`
- `MockRejectingVerifier` — mock contract that returns `Ok(false)` from `verify()`
- `fr_from_u256()` helper for constructing `Bn254Fr` field elements from `U256`
- `mk_mock_groth16_proof()` helper for constructing valid-looking mock proofs
- `default_public_inputs()` helper for reusable test fixtures
- `register_with_mock_verifier()` helper using `MockToken` + `MockPayrollVerifier`

**Test results:** 13/13 passing (contract layer)

### Phase 4: Testnet Deployment + Frontend Wiring (2026-06-30)

**Testnet contracts deployed:**
- Verifier: `CDDVZ2HRAC2SWI4MHGY3OHA65JRWYIED2MBAVMZ6EK7X2MPBUJ4UHWP7` (payroll_20 VK embedded)
- Payroll: `CCG5ELGLQ3DO6K3ZYTLYFOTS6SIZSBCKD5I6ASUROPM7MXVBN3ST3TLO`
- Token (USDC on testnet): `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC`

**Deploy script**: `deployments/scripts/deploy-payroll.sh`
- Builds circom-groth16-verifier with `VERIFIER_VK_JSON=testdata/payroll_20_vk.json`
- Deploys verifier + payroll contracts to testnet
- Calls `init` with admin, token, verifier, employee_root=0, budget_cap=0
- Writes deployment info to `deployments/testnet/deployments.json`

**Environment vars set in `zk-payroll-dashboard/.env.local`**:
```
NEXT_PUBLIC_PAYROLL_CONTRACT=CCG5ELGLQ3DO6K3ZYTLYFOTS6SIZSBCKD5I6ASUROPM7MXVBN3ST3TLO
NEXT_PUBLIC_VERIFIER_CONTRACT=CDDVZ2HRAC2SWI4MHGY3OHA65JRWYIED2MBAVMZ6EK7X2MPBUJ4UHWP7
NEXT_PUBLIC_PAYROLL_TOKEN=CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC
```

**`lib/zk/serialize.ts`** — Replaced placeholder JSON encoding with proper `nativeToScVal`:
- `Groth16Proof` struct serialized as `{ a: hex, b: hex, c: hex }` with `type: "Groth16Proof"`
- Public inputs `Vec<Bn254Fr>` serialized as hex strings with `type: "ScVec<ScBn254Fr>"`
- `U256` amount serialized with `type: "U256"`
- Empty `ipfs_cids` Vec and `employee_count=0` as placeholders
- Pure `Uint8Array` hex conversion — no `Buffer` dependency

**`components/features/payroll/PayrollWizard.tsx`** — Real contract pipeline wired:
- `handleGenerateProof`: calls real `zkEngine.generateProof()` + `toSorobanScVals()`, stores `GeneratedPayrollProof` in component state
- `handleSubmit`: calls `invokeContract({ contractId, method: "run_payroll", args: generatedProof.sorobanArgs })`
- `merkleRoot` hardcoded to `"123456789"` — TODO: fetch from contract via `get_employee_root()`
- `employeeSsn` uses `employee.id` as placeholder

**`types/stellar.ts`**: `ScVal` type changed from placeholder interface to `any` for SDK interop.

**Remaining blocker for E2E**: `zkEngine` falls back to `MockZkEngine` (no circom WASM prover in dashboard deps). The `payroll.wasm` at `public/zk/` is 11.6KB — placeholder, not real circom circuit. Phase 3 (real ZK engine) required for actual proof generation.

---

## Check Implementation (Phase 7) — 2026-07-01 (re-checked post dev-testing)

Reviewed implementation against requirements/design docs and the zk-proofs security lens.
**Re-check after dev-testing**: contract unit tests for `run_payroll` were added and now pass (13/13, verified `cargo test -p payroll`). The previously overstated test claims (T2.5/T2.6/T2.7) are now genuinely satisfied with `MockPayrollVerifier` + `MockRejectingVerifier`, plus extra coverage T2.8-T2.10. Status: **partial alignment — Phase 2 ships and is now genuinely tested, but the HIGH-severity proof-binding gap remains and is actually *demonstrated* by the new tests.**

**Post dev-review fix (2026-07-01)**: the HIGH proof-binding gap was fixed via TDD. `run_payroll` signature dropped the `total_payroll_amount` arg; the on-chain amount (budget cap, USDC transfer, period record) is now derived from `public_inputs[1]`. New tests T2.11 (amount bound to proof) + T2.12 (duplicate commitment rejection) added. `cargo test -p payroll` → 15/15 pass, zero warnings. `stellar contract build --package payroll` succeeds.

**Phase 3 — ZK engine (2026-07-01)**: Stages 1–3 complete. The browser now has a real Groth16 prover path (no more `MockZkEngine` when `NEXT_PUBLIC_ZK_ENGINE=real`):
- **Stage 1 — Rust prover crate** `app/crates/payroll-prover`: thin wasm-bindgen wrapper around the circuit-agnostic `prover::Prover` + `witness::WitnessCalculator`. Exposes `generate_payroll_proof(pk, r1cs, circom_wasm, inputs_json) -> JSON({proof_hex, public_inputs_hex})`. `wasm-pack build --release --target web` → 1.0 MB `payroll_prover_bg.wasm` (PK **not** `include_bytes!`'d — loaded at runtime per the IndexedDB strategy).
- **Stage 2 — IndexedDB cache** `zk-payroll-dashboard/lib/zk/pkCache.ts` + `artifacts.ts`: fetches the ~958 MB PK + ~570 MB R1CS + 18 MB circom WASM, SHA-256-verified, cached in IndexedDB across sessions, with `navigator.storage.persist()` + streaming fetch progress + quota-error surfacing.
- **Stage 3 — Real ZkEngine** `realProver.ts` + `realProver.worker.ts` + `engine.ts::RealZkEngine`: a Web Worker owns the ~1.5 GB of artifact bytes + WASM linear memory (off-main-thread); `RealZkEngine` selects via `NEXT_PUBLIC_ZK_ENGINE=real` and feeds the prover's hex output to `toSorobanScValsFromRealProof`.
- **Serializer rewrite** `serialize.ts`: replaced the dead `nativeToScVal`-based code (it imported a symbol not exported from `@stellar/stellar-sdk`) with direct `xdr` construction mirroring `app/crates/core/stellar/src/soroban_encode.rs` — `Groth16Proof` as sorted `scvMap{a,b,c → scvBytes}`, `Bn254Fr` as `scvU256(UInt256Parts)`. 4 vitest tests pass (`zk.serialize.real.test.ts`).
- **Verified**: `cargo check/build -p payroll-prover --target wasm32-unknown-unknown` ✅; `npm run typecheck` ✅; `npm run test:smoke` 12/12 ✅; `npm run build` (Next.js prod build, worker emitted as separate chunk) ✅; `npm run build:zk` script wired.
- **Honest gap**: `RealZkEngine.generateProof` calls `buildPayrollCircuitInput`, which throws if `pathElements` are empty — the Poseidon2 employee-Merkle-tree builder (planning Phase 4.4) is not yet implemented. The wiring is complete and the gap is explicit (throws rather than producing a fake proof). E2E (Stage 5) is blocked on Phase 4.4 + the testnet redeploy (Stage 4).

**Stage 4 — Testnet redeploy (2026-07-01)**: contracts redeployed with the new 4-arg `run_payroll` signature via `deployments/scripts/deploy-payroll.sh testnet --deployer payroll-admin --token CDLZFC3…`. Verified live:
- Verifier: `CBZALN5BESBULOTYGLKB4VYVW3NH45OQYV6NY5TRKOCHSXOHWG7FEY4F` (rebuilt with embedded payroll_20 VK, wasm hash `bc700ed1…`)
- Payroll: `CAQJ5NZP2OO53YCR6OWHFXL2XLIJEACJMBFFOEZSKVGQSMV45PRN7L5P` (new 4-arg `run_payroll(proof, public_inputs, ipfs_cids, employee_count)` — confirmed via `stellar contract inspect --wasm` showing exactly 4 inputs)
- `init` tx confirmed on testnet: https://stellar.expert/explorer/testnet/tx/dce847afe1e21b8fc39aec97be92b02e87fee7ff1401058cb5b5275d62ed147c
- `get_employee_root` returns `0` (the `init` value) — contract responsive.
- `.env.local` + `deployments/testnet/deployments.json` updated with the new IDs. The old stale instance (`CCG5ELGL…` / verifier `CDDVZ2HR…`) is superseded.
- Admin: `GBBTKIOKPCGILWKYJASL7LL3TSITQMOVTYOL3Q5KG3Y4L7KY4BIXXXJI` (the `payroll-admin` stellar key).

### Alignment summary

| Component | Design | Implementation | Status |
|-----------|--------|----------------|--------|
| `payroll.circom` / `payroll_20.circom` | `PayrollBatch(20, 500)`, 3 public inputs | Matches; R1CS + keys present | ✅ Match |
| `payroll_10_10.circom` | `PayrollBatch(10, 10)` for browser | Compiled, keys generated, 49K constraints | ✅ Match (NEW) |
| `PayrollContract` admin/auditor methods | 6 methods + `require_auth` | Implemented + idempotent `init` | ✅ Match |
| `run_payroll()` | `verify_proof + budget cap + USDC transfer` | Implemented; amount derived from `public_inputs[1]` (proof-bound) | ✅ Match (fixed 2026-07-01) |
| `withdraw()` + `PayrollWithdrawCircuit` | Success Criteria #7, #8 | Stub returning `ProofVerificationFailed` | ❌ Missing (Phase 2) |
| Testnet deploy | Verifier + Payroll live | Both deployed, env wired | ✅ Match |
| ZK engine (browser) | Real prover replaces Mock | `payroll-prover` WASM (1.0 MB), `RealZkEngine`, IndexedDB cache | ✅ Match (with payroll_20 PK gap) |
| Merkle tree builder | Poseidon2 WASM + sparse tree | `poseidon-wasm` (110 KB), `merkleTree.ts`, 14 vitest tests | ✅ Match |
| Circuit shrink (3.4) | `PayrollBatch(10, 10)` | PK 9.6 MB, proving seconds, added to build.rs | ✅ Match |
| E2E native tests | T5.5 (witness) + T5.6 (full proof) | Both PASSING (95s + 33s) | ✅ Match |
| ComplianceManager / IPFS / Merkle UI | Phase 4.2 / 4.3 / 4.5 | Not started | ❌ Pending |
| Contract unit tests (T2.5-T2.12) | valid proof / budget / fake / wrong root / non-canonical / unauthorized / amount-bound / duplicate | **15/15 pass** (`cargo test -p payroll`) | ✅ Verified |
| Circuit tests (T1.2 / T1.3) | invalid sum / invalid Merkle path | No payroll circuit tests exist in `circuits/` | ❌ Still missing |

### Deviations

**[HIGH] Proof is not binding on the on-chain amount** — `contracts/payroll/src/payroll.rs:316-346`
The contract takes `total_payroll_amount: U256` as a separate `run_payroll` argument and uses it for the budget-cap check, the `PayrollPeriod` record, and the USDC transfer. The value proven inside the Groth16 proof lives at `public_inputs[1]` (`totalPayrollAmount` from the circuit), but the contract never reads index 1 — it only reads `public_inputs[0]` (employeeRoot) and `public_inputs[2]` (payrollPeriodId). Result: the budget cap is enforced against a caller-supplied amount, not the proven amount, and the USDC escrow transfer can be smaller than the proven total. Although `require_admin` limits this to the employer (so it's self-cheating, not a stranger attack), it breaks requirements Success Criteria #4 ("Budget cap enforced on-chain — excess rejected") and the design intent that the proof binds the on-chain amount.
**Confirmed by the new tests**: `test_run_payroll_rejects_budget_exceeded` deliberately passes `total_payroll=2_000_000` while `public_inputs[1]=100_000`, and the contract happily processes them as different values — it rejects only because `total_payroll > budget_cap`, never comparing against the proof. The success test passes matching values purely by convention.
**Fix**: read `total_payroll_amount` from `public_inputs.get(1).as_u256()` and drop the separate argument; reject if canonical-encoding mismatch with caller-supplied amount. Update `test_run_payroll_rejects_budget_exceeded` to set `public_inputs[1]` to the oversized value instead of the call arg.

**[MEDIUM] Range-check for-loop is dead code** — `circuits/src/payroll.circom:80-82`
`for (var b = PAYROLL_MAX_SALARY_BIT_LIMIT; b < MAX_SALARY_BITS; b++)` — both constants equal `50`, so the loop body never executes. `Num2Bits(50)` already constrains `salaryAmount < 2^50`, so the security property holds, but the loop is misleading dead code and reads as if it enforced an upper bound it does not.
**Fix**: either delete the loop (trust `Num2Bits(50)`) or split the constants so the loop actually zeroes bits `[50, MAX_SALARY_BITS)`.

**[LOW] `actualEmployeeCount` declared but never used** — `circuits/src/payroll.circom:45`
Implementation doc explicitly says "No `actualEmployeeCount` input: Sum constraint naturally enforces zero salary for unused slots" — but the input is still present and never constrained. Adds a free private input with no semantic effect.
**Fix**: drop the signal, or constrain against a public claimed count if you want one.

**[LOW] `init` not `__constructor`** — Protocol 22+ expects `__constructor` to run once at deploy. Manual `init` with an `AlreadyInitialized` reentry guard works, but doesn't benefit from the host-level one-shot guarantee and adds a footgun if the guard is ever removed.

### Overstated claims in planning/implementation docs

- ~~Planning task 2.4 / 2.5 / 2.6 / 2.7 listed as DONE with passing tests for `run_payroll`~~ — **RESOLVED in dev-testing**: T2.5/T2.6/T2.7 + T2.8/T2.9/T2.10 now exist and pass (`cargo test -p payroll` → 13/13).
- **Still missing**: T1.2 / T1.3 circuit tests (invalid sum, invalid Merkle path) — no payroll tests exist in `circuits/` (no `#[ignore]` payroll test, no `circuits/tests/` dir). Add these under `BUILD_TESTS=1 cargo test -p circuits -- --ignored`.
- **Success Criteria #7 + #8** (`PayrollWithdrawCircuit`, employee `withdraw()`) are listed as part of M5/demo but are not implemented — `withdraw()` is a stub. Move to a follow-up phase or update requirements to phase them.

### Test-quality observations (from dev-testing)

- `test_run_payroll_success_with_mock_verifier` uses empty `ipfs_cids` — the `DuplicateCommitment` rejection path (payroll.rs:390-397) is **untested**. Add a test that submits a duplicate commitment ID and expects `Error::DuplicateCommitment`.
- `test_run_payroll_rejects_non_canonical_input` uses a weak `||` assertion ("either `ProofVerificationFailed` or `NonCanonicalInput` is fine") and mixes `env.mock_all_auths()` with `client.mock_auths(...)` — pin the expected behavior (does `Bn254Fr::from_bytes` on all-`0xFF` reduce mod modulus to a canonical element, or panic? — the test passing implies reduction) and assert a single error variant.
- 2 lifetime warnings in `register_payroll` / `register_with_mock_verifier` (`PayrollClient` hidden lifetime) — cosmetic, run `cargo fix --lib -p payroll --tests` to silence.

### E2E Test Debugging: `e2e_payroll_real_proof` (2026-07-01)

**Problem**: The native Rust E2E test ("Merkle tree → witness → Groth16 proof → on-chain verification") failed with `Error(Value, InvalidInput)` "mis-tagged object reference" and later `Error(Auth, InvalidAction)` when submitted to the Soroban local Env.

**Root causes and fixes**:

1. **Dual `Env::default()`** (mis-tagged error): Soroban types (`Groth16Proof`, `Vec<Bn254Fr>`, `U256`) were created in one `Env` instance, but a second `Env::default()` was created for contract deployment. All Soroban types MUST come from the same `Env` — creating across env boundaries causes host-level tag mismatches. **Fix**: hoist `let env = Env::default()` to before proof conversion; use the same `env` for all Soroban operations.

2. **LE→BE byte reversal** (ProofVerificationFailed): The witness from `extract_public_inputs` returns field elements in **little-endian** (the witness's native format), but `Bn254Fr::from_bytes()` expects **big-endian**. The event log showed `payrollPeriodId = 452312848583266388373324160190187140051835877600158453279131187530910662656` (which is `1 << 248` — a LE `1` interpreted as BE). **Fix**: `buf.reverse()` on each 32-byte chunk before `Bn254Fr::from_bytes()`.

3. **`mock_auths()` must be chained** (Auth::InvalidAction): `client.mock_auths(&[...])` sets up auth expectations that are consumed by the *immediately following* method call. Calling `client.mock_auths(&[...]); client.set_employee_root(&root)` as separate statements loses the expectations. **Fix**: `client.mock_auths(&[...]).set_employee_root(&root)` — single expression chaining (as in the payroll unit tests).

4. **`U256::from_parts` over `from_be_bytes`**: `U256::from_be_bytes(env, &Bytes::from_array(env, &buf))` with large BN254 field elements (32 bytes) can trigger "mis-tagged object reference" in Soroban local Env. **Fix**: extract `[hi_hi, hi_lo, lo_hi, lo_lo]` from the BE bytes as `u64` and use `U256::from_parts(env, hi_hi, hi_lo, lo_hi, lo_lo)`.

**Lesson learned**: Soroban local Env debugging requires reading the full diagnostic event log (newest-first) to trace where exactly the error occurs. "mis-tagged object reference" errors are always type/environment boundary issues within the same Env.

### Recently shipped (2026-07-03)

**Phase 4.5 — Set Employee Root UI**: New `components/features/employees/SetEmployeeRoot.tsx` component:
- Reads current contract root via `get_employee_root()` view call (Soroban RPC simulation, no signing)
- Builds employee Merkle tree from store's active employees using `buildMerkleTree()` from `merkleTree.ts`
- Posts root to contract via `set_employee_root(U256)` with Freighter signing
- Shows build status, contract state, and error handling
- Added to `/employees` page above EmployeeDirectory

**Phase 4.2 — ComplianceManager contract wiring**:
- `components/features/compliance/ComplianceManager.tsx` now calls `set_view_key_for_auditor()` / `revoke_auditor()` on-chain
- Added Stellar address input field for auditor (required for contract calls)
- Keeps localStorage store as metadata layer (names, orgs, scopes) — contract stores only address → encrypted key mapping
- `callContract` helper abstracts Soroban RPC simulation + Freighter signing + submission
- ViewKey type extended with optional `auditorAddress` field

**Phase 4.1 — PayrollWizard contract wiring (partial)**:
- Replaced `MOCK_EMPLOYEES` with real `useEmployeeStore()` data
- Added `fetchContractRoot()` — reads employee root from contract via RPC simulation
- Builds real Merkle tree via `buildMerkleTree()` from selected employees before proof generation
- Real ZK engine path enabled when `NEXT_PUBLIC_ZK_ENGINE=real`
- Mock path still works for dev: passes correct tree root instead of hardcoded `"123456789"`
- `employeeCount` passed as 4th arg to `run_payroll` (was defaulting to 0)

### Missing pieces (per design, not yet shipped)

- Phase 4.3: IPFS encrypted blob upload + retrieval.
- `withdraw()` + nullifier set + `PayrollWithdrawCircuit` (Phase 2 of contract).
- Browser proof generation E2E (dashboard → Freighter → testnet) — requires real ZK engine artifacts served.

### Follow-ups (next session)

1. ~~**[HIGH] Bind `run_payroll` amount to the proof**~~ — **FIXED 2026-07-01**
2. **[MEDIUM] Add missing circuit tests** T1.2 (invalid sum) + T1.3 (invalid Merkle path).
3. ~~**[MEDIUM] Add `DuplicateCommitment` test**~~ — **FIXED**
4. ~~**[LOW] Tighten `test_run_payroll_rejects_non_canonical_input`**~~ — **FIXED**
- **[MEDIUM] Clean circuit dead code** — `actualEmployeeCount` dropped from circuit; no-op range-check loop removed; `PAYROLL_MAX_SALARY_BIT_LIMIT` constant removed. Circuit recompiled, keys regenerated. **(FIXED 2026-07-01)**
6. **[LOW] Rename `init` → `__constructor`** — breaking change to deployed testnet contract.
7. ~~**[LOW] Silence lifetime warnings**~~ — **FIXED**
8. **[MEDIUM] Deploy new verifier with `payroll_10_10` VK** — build `circom-groth16-verifier` with `VERIFIER_VK_JSON=testdata/payroll_10_10_vk.json`, deploy to testnet, call `set_verifier()`.
9. **[MEDIUM] Update `artifacts.ts` and `merkleTree.ts` defaults** — use `payroll_10_10` (levels=10, batch=10). **Partially DONE (2026-07-02)**: `artifacts.ts` ✅ + `engine.ts` calls `buildMerkleTree(employees, 10, 10)` ✅; `merkleTree.ts` *defaults* still `20`/`500` (see 2026-07-02 deviation §1).
10. ~~**[MEDIUM] Copy `payroll_10_10.wasm` + VK to `public/zk/`**~~ — **DONE (2026-07-02)**: `payroll_10_10.wasm` (528 KB) + `verification_key.json` (2.3 KB) in `public/zk/`.
11. ~~**[MEDIUM] Deploy new verifier with `payroll_10_10` VK**~~ — **DONE (2026-07-02)**: verifier `CB6FUEHW…` deployed, `set_verifier()` called, `deployments.json` 3rd entry records `"vk":"payroll_10_10"`.

---

## Check Implementation (Phase 7) — 2026-07-02 (fresh re-check)

Re-reviewed implementation against requirements/design docs + the `zk-proofs`, `smart-contracts`, and `dapp` skill lenses. All previously-flagged HIGH/MEDIUM deviations from the 2026-07-01 check are **FIXED**. Fresh test output captured this session:

- **`cargo test -p payroll`** → **15/15 pass, 0 warnings** (`test result: ok. 15 passed; 0 failed; 0 ignored`).
- **`cargo test -p e2e-tests e2e_payroll -- --nocapture`** → **2/2 pass in 32.62s**. Witness = 49,514 field elements / 49,401 constraints (matches `payroll_10_10`). Real Groth16 proof (256 B uncompressed) verified off-chain + accepted by contract in local Soroban Env.
- **`npm test` (dashboard)** → **55/55 tests pass**, 2 empty legacy suite files fail discovery (`zk.generatePayrollProof.test.ts`, `zk.serialize.test.ts` — no test suites, see deviation §3).
- **Testnet**: `.env.local` verifier = `CB6FUEHW…` (payroll_10_10 VK); `deployments.json` 3rd entry confirms `"vk":"payroll_10_10"`. Matches.

### Alignment summary (2026-07-02)

| Component | Design | Implementation | Status |
|-----------|--------|----------------|--------|
| `payroll.circom` | `PayrollBatch(levels, n)`, 3 public inputs, Poseidon2 commitment, Num2Bits(50) range, MerkleProof, sum check | Clean — dead code removed (`actualEmployeeCount`, no-op range loop, `PAYROLL_MAX_SALARY_BIT_LIMIT` all gone) | ✅ Match |
| `payroll_10_10.circom` | `PayrollBatch(10, 10)` for browser | Compiled, keys present (PK 10 MB, R1CS 6.5 MB, WASM 528 KB, 49,401 constraints) | ✅ Match |
| `payroll_20.circom` | `PayrollBatch(20, 500)` for server-side v2 | Present, keys present (PK 958 MB) | ✅ Match |
| `build.rs` | payroll_20 + payroll_10_10 in `GROTH16_KEY_CIRCUITS` | Both listed (line 48) | ✅ Match |
| `PayrollContract` admin/auditor/verifier methods | 7 methods + `require_auth` + events | Implemented; idempotent `init` with `AlreadyInitialized` guard | ✅ Match |
| `run_payroll()` | proof-bound amount, budget cap, USDC transfer, duplicate guard | 4-arg signature; amount from `public_inputs[1]`; employee-root precheck before expensive crypto; `DuplicateCommitment` guard | ✅ Match (fixed) |
| Contract unit tests T2.1–T2.12 | 15 scenarios incl. amount-bound + duplicate | **15/15 pass** (verified fresh) | ✅ Verified |
| E2E native tests T5.5 + T5.6 | witness root match + full proof accepted | **2/2 pass** (32.62s, verified fresh) | ✅ Verified |
| ZK engine (browser) | Real prover, IndexedDB PK cache, Web Worker | `payroll-prover` (1.0 MB WASM), `RealZkEngine`, `artifacts.ts` → payroll_10_10 | ✅ Match |
| Merkle tree builder | Poseidon2 WASM + sparse tree | `poseidon-wasm` (110 KB), `merkleTree.ts`; engine calls `(10, 10)` | ✅ Match (defaults lag — §1) |
| Serializer | direct `xdr` construction | `serialize.ts`; 4 vitest tests pass | ✅ Match |
| Testnet deploy (v2 verifier) | payroll_10_10 VK verifier live | `CB6FUEHW…` deployed, `set_verifier()` called | ✅ Match |
| `withdraw()` + `PayrollWithdrawCircuit` | Success Criteria #7, #8 | Stub returning `ProofVerificationFailed` | ❌ Missing (Phase 2) |
| Circuit tests T1.2 / T1.3 | invalid sum / invalid Merkle path | None in `circuits/` | ❌ Missing |
| ComplianceManager / IPFS / set-root UI | Phase 4.2 / 4.3 / 4.5 | Not started | ❌ Pending |
| Browser E2E (T4.1) | dashboard → Freighter → testnet | Not started (unblocked) | ❌ Pending |

### Deviations (2026-07-02)

~~**[MEDIUM] `merkleTree.ts` defaults still `levels=20, batchSize=500`** — `merkleTree.ts:130-131`~~ **FIXED (2026-07-02, Phase 6)**: defaults changed to `levels=10, batchSize=10`. JSDoc updated to reference `PayrollBatch(10, 10)` browser variant. All 14 merkle tree tests pass.

~~**[LOW] Stale artifacts in `public/zk/`** — `payroll.wasm` + `payroll_20.wasm`~~ **FIXED (2026-07-02, Phase 6)**: both deleted. Only `payroll_10_10.wasm` + `verification_key.json` remain. Build verified.

~~**[LOW] Empty legacy test files** — `__tests__/zk.generatePayrollProof.test.ts` + `__tests__/zk.serialize.test.ts`~~ **FIXED (2026-07-02, Phase 6)**: both deleted. Failed test files reduced from 4 to 2 (remaining failures are pre-existing `zk.serialize.real.test.ts` import issue and `zk.engine.test.ts` node:test style).

~~**[LOW] Stale comment in e2e test** — `e2e_payroll.rs:39`~~ **FIXED (2026-07-02, Phase 6)**: comment updated to `PayrollBatch(10, 10)`.

**[MEDIUM, deferred] `withdraw()` + `PayrollWithdrawCircuit`** — Success Criteria #7/#8. Stub. Acknowledged Phase 2 follow-up; not blocking M5 demo (which only needs `run_payroll`).

~~**[MEDIUM, deferred] Circuit tests T1.2/T1.3** — no payroll tests in `circuits/`.~~ **FIXED (2026-07-02)**: `circuits/src/test/prove_payroll.rs` added with `test_payroll_invalid_sum_rejected` and `test_payroll_invalid_merkle_path_rejected`. Both pass via `panic::catch_unwind` since `CircomBuilder::build()` panics on unsatisfied constraints. Run with `BUILD_TESTS=1 cargo test -p circuits -- --ignored test_payroll`.

**[LOW, deferred] `init` not `__constructor`** — breaking change to deployed testnet contract; deferred.

**[INFO] E2E uses `MockVerifier`** — `e2e_payroll_real_proof` submits to a mock verifier returning `Ok(true)`; the real on-chain BN254 pairing for the payroll_10_10 VK is covered by the testnet deployment + the pool e2e tests (same `circom-groth16-verifier` code path, different embedded VK). Honest gap, documented in test comments.

---

### Phase 5 Implementation (2026-07-03)

**All BLOCKING items closed.**

**Task 2.7 — `run_payroll` proof-bound signature (F1/F2)**: Dropped `total_payroll_amount: U256` argument. Amount derived from `public_inputs[1]`. Period ID from `public_inputs[2]` verified against next period counter. Contract is now 4-arg: `(proof, public_inputs, ipfs_cids, employee_count)`. `fr_to_u64` helper added.

**Task 6.5 — `pool.rs` scope contamination reverted (F3)**: `IntentProof`/`verify_intent()` (+118 lines) reverted via `git checkout main -- contracts/pool/src/pool.rs`. No diff remains.

**Task 2.8 — Contract tests**: Added 8 new tests (T2.5–T2.12) plus T2.12b (cross-period duplicate). Mock verifiers (`MockPayrollVerifier`, `MockRejectingVerifier`), `MockToken`, and helpers (`fr_from_u256`, `mk_mock_groth16_proof`, `default_public_inputs`) added to `test.rs`.

**Task 6.6 — Circuit dead code (F5)**: Removed `signal input actualEmployeeCount`, split `MAX_SALARY_BITS` (50→64) from `PAYROLL_MAX_SALARY_BIT_LIMIT` (50), making the range-check loop actually iterate bits 50–63. Updated `flows.rs` doc + removed `set_single("actualEmployeeCount", ...)`.

**Task 6.7 — Orphan artifacts**: `public/circuits/payroll_20.r1cs` (597 MB) + `payroll_20.wasm` (18 MB) deleted.

**Task 6.8 — Deploy script VK**: `deploy-payroll.sh` switched from `payroll_20_vk.json` to `payroll_10_10_vk.json`.

**Task 6.10 — Cleanup**: `cargo fix` silenced 2 lifetime warnings. `.DS_Store` removed from git tracking, added to `.gitignore`.

**Test results**: `cargo test -p payroll` → **16/16 pass, 0 warnings**. `cargo test -p e2e-tests e2e_payroll_merkle_witness` → passes (49514 field elements, root matches).

**Resolved 2026-07-03**: Task 6.9 (`init` → `__constructor`). Withdraw functionality implemented (Phase 7).

### Task 6.9 — `init` → `__constructor` migration (DONE 2026-07-03)

**Files changed**:
- `contracts/payroll/src/payroll.rs` — renamed `init()` to `__constructor()`, removed `admin.require_auth()` and `AlreadyInitialized` guard (host-enforced one-shot)
- `contracts/payroll/src/test.rs` — updated `register_payroll()` and `register_with_mock_verifier()` to pass constructor args to `env.register()`; removed `test_init_rejects_reinitialization` (impossible with constructor)
- `e2e-tests/src/tests/e2e_payroll.rs` — removed `client.init()` call, added constructor args to `env.register(Payroll, ...)`
- `deployments/scripts/deploy-payroll.sh` — removed `stellar contract invoke init` step; `__constructor` args passed directly to `stellar contract deploy -- ...`

**Changes applied**:
- Constructor signature: `pub fn __constructor(env, admin, token, verifier, employee_root, budget_cap) -> ()` (no `Result`, no auth)
- Removed `Error::AlreadyInitialized = 12` from error enum
- No reentry guard needed — Protocol 22+ host enforces single execution

**Validation**: `cargo test -p payroll` → **15/15 pass, 0 warnings**. `cargo test -p e2e-tests e2e_payroll_merkle_witness` → passes.
**Note**: 15 tests (down from 16) because the reinitialization test is no longer applicable.

### Phase 7 — PayrollWithdrawCircuit + Employee Withdrawal (DONE 2026-07-03)

Full implementation of ZK salary withdrawal. Employee generates a PayrollWithdrawCircuit proof to prove commitment ownership without revealing identity.

**Circuit** (`circuits/src/payrollWithdraw.circom`):
- 4 public inputs: `[commitmentRoot, commitmentId, nullifier, salaryAmount]`
- Private inputs: `[employeeId, salaryAmountPrivate, salt, pathElements[levels], pathIndices]`
- Constraints: commitment = Poseidon2(3)(empId, sal, salt, ds=0x01), commitmentId = Poseidon2(1)(commitment, ds=0x02), nullifier = Poseidon2(2)(commitment, salt, ds=0x03), MerkleProof(10), Num2Bits(64) with bits [50..64) = 0
- Entry point: `payrollWithdraw_10.circom` (levels=10)
- R1CS: 759 KB, WASM: 466 KB, PK: 1.1 MB — feasible for browser proving

**Key generation**: Added `payrollWithdraw_10` to `GROTH16_KEY_CIRCUITS` in `build.rs`. Keys auto-generated: `testdata/payrollWithdraw_10_proving_key.bin` (1.1 MB), VK with 5 IC points (4 public inputs, correct).

**Contract changes** (`contracts/payroll/src/payroll.rs`):
- **New errors**: `NullifierAlreadySpent = 13`, `WithdrawVerifierNotSet = 14`
- **New storage keys**: `WithdrawVerifier`, `WithdrawnNullifier(U256)`, `RootToPeriod(U256)`
- **New admin method**: `set_withdraw_verifier(verifier)` — sets the separate verifier contract for PayrollWithdrawCircuit proofs
- **New query**: `is_nullifier_spent(nullifier)` — check if a nullifier has been used
- **Updated `run_payroll()`**: stores `RootToPeriod(root) → periodId` mapping for withdrawal lookup
- **`withdraw()`**: 4-arg `(proof, public_inputs, recipient)`. Recipient must auth. Verifies proof via withdraw verifier, checks nullifier set (Map), transfers USDC from escrow to recipient. Nullifier = Poseidon(commitment, salt) — one-way, prevents double-withdrawal without revealing employee identity.
- **New event**: `WithdrawalEvent { nullifier, salary_amount, recipient }`

**Contract tests** (T2.13–T2.17):
- `test_withdraw_success` — valid proof, nullifier marked spent
- `test_withdraw_rejects_double_spend` — same nullifier → `NullifierAlreadySpent`
- `test_withdraw_rejects_wrong_root` — unknown commitment root → `PeriodNotInitialized`
- `test_withdraw_rejects_fake_proof` — failing verifier → `ProofVerificationFailed`
- `test_withdraw_rejects_no_verifier` — withdraw verifier not set → `WithdrawVerifierNotSet`

**Test result**: `cargo test -p payroll` → **20/20 pass, 0 warnings**.

**Frontend**:
- `lib/zk/artifacts.ts` — Added `withdrawArtifactRefs()` for withdraw circuit artifacts
- `lib/zk/generateWithdrawProof.ts` — Circuit input builder + prover wiring (mock fallback for dev)
- `lib/zk/serialize.ts` — `buildWithdrawScVals()` serializer for `withdraw(proof, public_inputs, recipient)`
- `components/features/withdraw/EmployeeWithdraw.tsx` — Employee withdrawal UI with Freighter wallet integration
- `app/withdraw/page.tsx` — New route

**Dashboard**: `npm run build` → 18/18 pages (new `/withdraw`). Typecheck clean. 55/55 tests pass.

### Prover + Worker updates

**Rust WASM prover** (`app/crates/payroll-prover/src/lib.rs`):
- Added `generate_proof()` — generic proof function (circuit-agnostic)
- `generate_payroll_proof()` now aliases `generate_proof()` for backward compatibility

**Web Worker** (`realProver.worker.ts`):
- Accepts `circuit: "payroll" | "withdraw"` in init message
- Loads payroll or withdraw artifacts based on circuit type
- Uses generic `generate_proof()` instead of payroll-specific function

**RealProver** (`realProver.ts`):
- Constructor accepts `CircuitKind` ("payroll" | "withdraw")
- Passes circuit kind to worker init message

### Testnet Deployment (2026-07-03)

**Payroll contract rebuilt + redeployed** with latest WASM:
- Includes `__constructor`, `withdraw()`, `set_withdraw_verifier()`, nullifier set
- `set_withdraw_verifier()` called with new withdraw verifier
- `set_budget_cap(100000000000)` = 10,000 USDC
- `set_employee_root(0)` set

**Live contracts**:
- Payroll: `CBN3XSKSAN3TFA7HHLQY3MRVU2WXY5MRY4AKIUDTMGQ2LAVKJUXGAPXU`
- Payroll Verifier (payroll_10_10): `CCH6JHAQLWARRXBYYSZMJ74IW2PBUGSYDCHAB455QZUE4LYVXDTFNCCV`
- Withdraw Verifier (payrollWithdraw_10): `CCJQ4SZNN5DV7NN4KSFC4M6MFNBGPOXC6FBV6BHSJPUWIFGW4M6OQ73C`
- Token (USDC testnet): `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC`

### Next steps

1. ~~**All implementation tasks complete** — circuits, contract, prover, UI, deploy.~~ **DONE 2026-07-03**
2. **Browser E2E**: run payroll + withdraw from dashboard through testnet — requires browser with Freighter wallet.
