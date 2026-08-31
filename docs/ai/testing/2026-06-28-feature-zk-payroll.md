---
phase: testing
title: Testing Strategy
description: Test scenarios for ZK payroll — circuit, contract, browser, and E2E coverage
---

# Testing Strategy

## Test Coverage Goals

- Circuit tests: 100% — `BUILD_TESTS=1 cargo test -p circuits -- --ignored`
- Contract tests: 100% — `cargo test -p payroll` (Soroban testutils)
- Browser tests: smoke + happy path — `npm test` in `zk-payroll-dashboard/`
- E2E: full payroll run + auditor decrypt demo
- All M5 criteria must pass for feature completion

---

## Circuit Tests (`circuits/`)

**Run**: `BUILD_TESTS=1 cargo test -p circuits -- --ignored`

- [x] **T1.1**: `circom 2.2.2 payroll_20.circom` compiles without error. R1CS (569.6MB), WASM (17.9MB). Public inputs: `[employeeRoot, totalPayrollAmount, payrollPeriodId]`. *(Done 2026-06-29)*

- [x] **T1.2**: Invalid sum — `BUILD_TESTS=1 cargo test -p circuits -- --ignored test_payroll_invalid_sum` passes. Sum constraint violation correctly detected at circuit layer. *(Done 2026-07-02)*

- [x] **T1.3**: Invalid Merkle path — `BUILD_TESTS=1 cargo test -p circuits -- --ignored test_payroll_invalid_merkle_path` passes. Merkle proof constraint violation correctly detected at circuit layer. *(Done 2026-07-02)*

- [ ] **T1.4**: Verification key matches expected hash — `payroll_vk.json` hash matches known-good reference value. (Covers: trusted setup correctness)

### Withdraw circuit tests (NEW — Phase 7)

- [ ] **T1.5**: `PayrollWithdraw(10)` compiles with circom 2.2.2 — withdraw proof circuit. *(Phase 7 Task 7.1)*

- [ ] **T1.6**: Invalid Merkle path in withdraw proof — `pathElements` incorrect for the commitment. Proof fails verification. (Covers: withdraw Merkle proof constraint)

- [ ] **T1.7**: Double-spend — same `nullifier` submitted twice to `withdraw()`. Second submission rejected with `NullifierAlreadySpent`. (Covers: nullifier double-spend protection)

---

## Contract Tests (`contracts/payroll/`)

**Run**: `cargo test -p payroll` — **20/20 pass, 0 warnings**

### Admin methods
- [x] **T2.1**: PayrollContract builds without compilation errors
- [x] **T2.2**: `set_employee_root()` called by non-employer → `Error::NotAuthorized` (tested via MockAuth enforcement)

### Budget enforcement
- [x] **T2.3**: `totalPayrollAmount > budgetCap` in `run_payroll()` → `Error::BudgetExceeded`

### Auditor management
- [x] **T2.4**: `set_view_key_for_auditor()` → `get_view_key()` returns same bytes → `revoke_auditor()` → `get_view_key()` → `Error::AuditorRevoked`

### Proof verification + USDC transfer
- [x] **T2.5**: Valid Groth16 proof passes `run_payroll()` — USDC transferred to contract escrow, period record stored, event emitted (tested with `MockPayrollVerifier`)
- [x] **T2.6**: `run_payroll()` with `totalPayrollAmount > budgetCap` (in `public_inputs[1]`) → reverts with `BudgetExceeded`
- [x] **T2.7**: `run_payroll()` with failing verifier (mock returns false) → reverts with `ProofVerificationFailed`

### Additional coverage added (2026-07-01)
- [x] **T2.8**: `run_payroll()` with wrong `employeeRoot` in public inputs → reverts with `ProofVerificationFailed`
- [x] **T2.9**: `run_payroll()` with non-canonical public input (≥ BN256 modulus) → rejects
- [x] **T2.10**: `run_payroll()` called without authorization → rejects
- [x] **T2.11**: `run_payroll()` amount is bound to the proof — stored `total_amount` equals `public_inputs[1]`, no caller-supplied amount arg exists
- [x] **T2.12**: `run_payroll()` with a duplicate `commitmentId` in `ipfs_cids` → reverts with `DuplicateCommitment`
- [x] **T2.12b**: Duplicate `commitmentId` across periods → reverts with `DuplicateCommitment`

### Withdrawal tests (Phase 7 — DONE 2026-07-03)

**Run**: `cargo test -p payroll` — **20/20 pass, 0 warnings** (Soroban testutils)

**Note**: 5 new withdraw tests added. `test_init_rejects_reinitialization` removed (inapplicable with `__constructor`).

- [x] **T2.13**: Valid withdrawal — proof passes, nullifier marked spent, `WithdrawalEvent` emitted
- [x] **T2.14**: Double-spend — same `nullifier` submitted twice → `NullifierAlreadySpent`
- [x] **T2.15**: Wrong commitment root (not a known period) → `PeriodNotInitialized`
- [x] **T2.16**: Fake proof — failing mock verifier → `ProofVerificationFailed`
- [x] **T2.17**: Withdraw verifier not set → `WithdrawVerifierNotSet`

---

## Browser / WASM Tests (`zk-payroll-dashboard/`)

**Run**: `npm test`

- [x] **T3.6**: Browser payroll input preparation preserves generated salts in the real proof request, maps app employee IDs to deterministic BN254 field elements, and derives `commitmentId` with the withdraw circuit domain. `npm test -- lib/zk/payrollInputs.test.ts` passes. *(Added 2026-07-14)*

- [x] **T3.7**: Middleware CSP allowlists `NEXT_PUBLIC_ZK_ARTIFACTS_URL` origin in `connect-src` so large proving artifacts can be fetched by the real prover. `npm test -- __tests__/middleware.test.ts` passes. *(Added 2026-07-14)*

- [x] **T3.8**: Soroban dApp transaction helper waits for RPC confirmation and rejects failed/non-confirmed transactions. `npm test -- lib/stellar/transactions.test.ts` passes. *(Added 2026-07-15)*

- [x] **T3.9**: Server proof-provider boundary builds padded payroll circuit inputs, normalizes browser hex Merkle values to decimal Circom inputs, rejects malformed prover responses, and surfaces missing `PAYROLL_PROVER_URL`. `npm test -- app/api/zk/payroll/prove/route.test.ts lib/zk/payrollCircuitInput.test.ts lib/zk/serverProver.test.ts` passes. *(Added 2026-07-15)*

- [x] **T3.10**: Native `payroll_prover_service` compile + proof smoke emits a 256-byte proof and 3 public inputs from the regenerated `payroll_10_10` artifacts. Passing evidence:
  - `BUILD_TESTS=1 ONLY_KEY_CIRCUITS=payroll_10_10,payrollWithdraw_10 cargo build -p e2e-tests --bin payroll_prover_service` completed.
  - Dashboard helper-generated input was piped into `cargo run -p e2e-tests --bin payroll_prover_service -- --once`.
  - Output contained 256-byte `proofHex` and public inputs:
    `[3047185273bc91e8f524602b45d7f1b4544166272254f58007de24cd664b9552, 00000000000000000000000000000000000000000000000000000000004c4b40, 0000000000000000000000000000000000000000000000000000000000000001]`.
  *(Completed 2026-07-15)*

- [x] **T3.0a**: Client pages can import public env config without server secrets. `__tests__/env.test.ts` covers `publicEnv` loading with no `SESSION_SECRET` / `ADMIN_PUBLIC_KEY`, while `getServerEnv()` still rejects missing server secrets.
- [x] **T3.0b**: Dashboard demo proof generation is artifact-independent. `__tests__/zk.demoProof.test.ts` verifies `generateDemoPayrollProof()` succeeds with `NEXT_PUBLIC_ZK_ENGINE=real` and an unavailable artifact server.
- [x] **T3.1**: `RealZkEngine.init()` loads PK/R1CS/circom WASM via IndexedDB cache + initializes the wasm-pack prover in a Web Worker (verified by `npm run build` emitting the worker chunk; runtime init awaits testnet artifact server). *(Stage 3, 2026-07-01)*
- [x] **T3.2**: `RealZkEngine` throws (not silent mock) when artifacts missing — `buildPayrollCircuitInput` throws on empty `pathElements`, surfacing the Phase 4.4 gap explicitly. *(Stage 3)*
- [ ] **T3.3**: `generatePayrollProof()` with 10 employees produces proof in < 10s — **practically achievable** (`payroll_10_10` proves in seconds with 9.6 MB PK; browser WASM test pending artifacts deployment).
  - **2026-07-14 update**: still blocked in this checkout because the real payroll prover binding (`payroll_prover_bg.wasm`) and large artifact files are not present. The dashboard now fails loudly rather than silently producing mock proof data when `NEXT_PUBLIC_ZK_ENGINE=real`.
- [ ] **T3.4**: `generatePayrollProof()` with 100 employees — not supported by `payroll_10_10` (max 10). Revisit with `payroll_20` for v2 server-side proving.
- [x] **T3.5**: `toSorobanScValsFromRealProof` correctly slices the 256-byte proof into `scvMap{a,b,c}` and encodes public inputs as `scvU256` — 4 vitest tests pass (`zk.serialize.real.test.ts`). *(Stage 3)*

### Serializer tests
- [x] `toSorobanScValsFromRealProof` splits 256-byte proof into A(64)/B(128)/C(64) `scvBytes`
- [x] rejects proof shorter than 256 bytes (512 hex chars)
- [x] rejects fewer than 3 public inputs
- [x] defaults `employeeCount` to 0

---

## E2E Integration Tests

### Native E2E (Rust)
- [x] **T5.5**: Merkle tree + witness — builds tree, computes circom witness, verifies tree root matches between zkhash Rust and circom circuit. **Re-verified 2026-07-02: 49,514 field elements, root matches.**
- [x] **T5.6**: Full proof + contract — real Groth16 proof generated (10 MB PK, 49,401 constraints), verified off-chain, accepted by contract in local Soroban Env. **Re-verified 2026-07-02: 2/2 e2e pass in 32.62s (`cargo test -p e2e-tests e2e_payroll`); 15/15 contract tests pass.**

### Native Testnet E2E (Rust + Stellar Testnet)

- [x] **T5.7**: Real payroll proof on Stellar testnet — `payroll_10_10` Groth16 proof generated locally and accepted by deployed payroll contract. Passing tx: https://stellar.expert/explorer/testnet/tx/a27afe6f0bd9ef54cb3dc81658d3965b8e7d8e9f7b8a21e7146941e0cec60993
- [x] **T5.8**: Real withdraw proof on Stellar testnet — `payrollWithdraw_10` Groth16 proof generated locally, nullifier accepted once, escrowed token transferred to recipient. Passing tx: https://stellar.expert/explorer/testnet/tx/a511f27bc833e32e6ce252d5ac83b7695ca189207114a6698a5737de5ee68ddb

Fresh rerun note (2026-07-15): `PAYROLL_CONTRACT=... cargo run -p e2e-tests --bin testnet_payroll_e2e` was started but produced no output for several minutes after compilation and was interrupted. No fresh tx hashes were produced in that session.

Run:

```bash
PAYROLL_CONTRACT=CDSODUB6ZYOB5VZ4GV6MD2NAZ3RA3KZ73RVOBNZMFVXOO7CLLYWTUXNF \
STELLAR_SOURCE=payroll-admin \
STELLAR_RECIPIENT=payroll-admin \
cargo run -p e2e-tests --bin testnet_payroll_e2e
```

Live deployment:

- Payroll: `CDSODUB6ZYOB5VZ4GV6MD2NAZ3RA3KZ73RVOBNZMFVXOO7CLLYWTUXNF`
- Payroll verifier: `CCSE6A4JH4KDWE63XMJ62LZBJTKJY4AEY3Q6FIACTKXZMNAX2NA7HRI6`
- Withdraw verifier: `CCARTGQLYGE2TCFFGPNC2B4IXUZJV4Y5QZWNHX4CXEREDLVIB3XYY5DH`
- Token: `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC`
- Setup txs: root https://stellar.expert/explorer/testnet/tx/cf6087930eef15348dcd8d6ce06f8385262ca9c190b3ea5a84b6ad7650ccc094, budget cap https://stellar.expert/explorer/testnet/tx/d99fc82c046109f2224b03cacbe45c2b3d0a167a11b48b6a7381f2e1453fece1

### Browser E2E
- [x] **T4.1a**: Playwright drives the dashboard server-proof payroll path through login + wizard proof generation. `E2E_STELLAR_SECRET_KEY=$(stellar keys show payroll-admin) npm run test:e2e -- --project=chromium e2e/payroll-server-proof.spec.ts` passed locally on 2026-07-15. The test mocks Freighter, signs the real auth challenge, seeds 10 active employees, hits `/api/zk/payroll/prove`, verifies a 256-byte proof and 3 public inputs, and reaches the confirmation step.
- [ ] **T4.1**: Full payroll run UI — "review" → "proof generation" → "confirm" → "submit" → tx confirmed on Soroban testnet. Transaction hash non-null. Server-proof Vercel preview is live at https://paymage-vercel-server-proof-hmubvs0jb-gadillacers-projects.vercel.app, but manual Freighter submission has not yet been completed in this session. The preview is currently behind Vercel Deployment Protection; `/login`, `/api/health`, and `/api/auth/challenge` return `302` to Vercel SSO unless a share/bypass link or `VERCEL_AUTOMATION_BYPASS_SECRET` is used.
- [ ] **T4.1b**: PayrollWizard fetches `get_employee_root()` from contract on Review step. Root shown when available.
- [ ] **T4.1c**: PayrollWizard "Start Payroll Run" loads active employees from store (not MOCK_EMPLOYEES).
- [ ] **T4.1d**: PayrollWizard "Submit" passes `employeeCount` as 4th arg to `run_payroll()`.
- [ ] **T4.2**: Proof generation progress UI visible — employee count shown, estimated time updates during generation
- [ ] **T4.3**: Auditor grant — employer calls `set_view_key_for_auditor()`, auditor calls `get_view_key()`, key decrypts successfully with auditor's wallet private key
- [ ] **T4.3b**: ComplianceManager "Generate" with valid Stellar address calls `set_view_key_for_auditor()` and records key locally.
- [ ] **T4.3c**: ComplianceManager form validates Stellar address format (G... 56 chars). Invalid addresses rejected.
- [ ] **T4.4**: Auditor revoke — employer calls `revoke_auditor()`, auditor calls `get_view_key()` → `Error::AuditorRevoked` (contract-side enforcement)
- [ ] **T4.4b**: ComplianceManager "Revoke" calls `revoke_auditor()` on contract. Key marked inactive.
- [ ] **T4.5**: Set Employee Root UI — "Build Tree" builds Merkle tree from active employees. Root displayed.
- [ ] **T4.5b**: Set Employee Root UI — "Post Root" calls `set_employee_root()` on contract with wallet signing.
- [ ] **T4.5**: Encrypted salary blob uploaded to IPFS (Pinata), CID returned and stored in contract
- [ ] **T4.6**: Auditor retrieves blob from IPFS via CID, decrypts with view key → `(employeeId, salaryAmount)` matches original input
- [ ] **T4.7**: Add employee → new `employeeRoot` computed → `set_employee_root()` called → next payroll uses new root
- [ ] **T4.8**: Employee generates withdraw proof in browser (< 5s), submits `withdraw()` to testnet via Freighter, receives USDC from escrow. Native testnet proof flow is verified in T5.8; browser wallet UX remains pending.

---

## M5 Demo Criteria (Feature Complete)

- [ ] Employer runs payroll for 10 employees, total = $500,000 (500000000000 stroops)
- [ ] Each individual salary hidden from on-chain data (only `commitmentRoot` + `totalPayrollAmount` visible)
- [x] Groth16 proof verified on-chain in single transaction. Native testnet e2e verified `run_payroll` in tx `a27afe6f0bd9ef54cb3dc81658d3965b8e7d8e9f7b8a21e7146941e0cec60993`.
- [ ] Employer grants auditor view key via contract
- [ ] Auditor retrieves encrypted blob from IPFS, decrypts to correct `(employeeId, salaryAmount)` for one employee
- [x] **Employee withdraws their salary via ZK proof** — native testnet e2e verified `withdraw()` transfers escrowed token to the recipient in tx `a511f27bc833e32e6ce252d5ac83b7695ca189207114a6698a5737de5ee68ddb`. Browser UX remains pending.

---

## Test Data

- **Employee fixtures**: 10 test employees with known `employeeId` + `salaryAmount` pairs
- **Salt**: `cryptographically randomBytes(32)` per commitment — not reused across tests
- **USDC**: Minted via `soroban token` CLI to employer account on Quickstart Docker
- **IPFS**: Pinata sandbox or local IPFS node for blob storage during tests
- **Verification key**: Committed reference hash in test fixture to detect tampering

---

## Performance Benchmarks

| Operation | Target | Max acceptable |
|-----------|--------|----------------|
| Circuit compile | — | 60s |
| WASM prove (10 employees, payroll_10_10) | < 5s | 10s |
| WASM prove (500 employees, payroll_20) | < 15s | 30s (v2, server-side) |
| Local verify | < 100ms | 500ms |
| On-chain verify (Soroban) | < 1s | 5s |
| Tx confirmation | < 5s | 15s |

---

## Manual Testing Checklist

- [ ] PayrollWizard: "Connect Wallet" → Freighter popup → wallet connected
- [ ] PayrollWizard: entering employee salaries updates total in real-time
- [ ] ComplianceManager: generate view key → Freighter signs tx → auditor added
- [ ] ComplianceManager: revoke auditor → subsequent `get_view_key()` call fails
- [ ] Browser console: no unhandled promise rejections during proof generation
- [ ] Chrome DevTools: WASM heap stays under 512MB during 500-employee proof

---

## Grant-Funded Feature Tests (NEW — added 2026-07-06)

Test scenarios for SCF Build grant Tranches 1-3. Derived from design doc
success criteria and planning doc Phase 8-10 tasks.

### Tranche 1 — KYC & Compliance Onboarding

**Run**: `npm test` in `zk-payroll-dashboard/` (integration tests in `__tests__/integration/tranche1/`)

- [ ] **T8.1**: Sumsub KYC flow completes — employer KYB + employee KYC end-to-end; webhook updates backend status
- [ ] **T8.2**: Allowlist maps wallet → KYC status correctly — verified wallet appears in API response; rejected wallet does not
- [ ] **T8.3**: Passkey smart account creation works — FaceID/TouchID enrollment creates Stellar smart account wallet; address displayable
- [ ] **T8.4**: Employee with passkey wallet can sign `withdraw()` tx — smart-account-kit `signAndSubmit()` completes; USDC received
- [ ] **T8.5**: Auditor retrieves view key, decrypts IPFS blob, gets correct salary — `(employeeId, salaryAmount)` matches original input
- [ ] **T8.6**: Privacy guarantee — no PII in contract storage / events / proof public inputs after full KYC → payroll → withdrawal cycle
- [ ] **T8.7**: KYC-rejected employee excluded from Merkle tree — employer cannot include rejected wallet in payroll batch

### Tranche 2 — Fiat On-Ramp & Funding

**Run**: `npm test` in `zk-payroll-dashboard/` (integration tests in `__tests__/integration/tranche2/`)

- [ ] **T9.1**: Employer funds USDC via SEP-24 anchor — fiat deposit → USDC arrives in employer's Stellar wallet
- [ ] **T9.2**: SEP-24 interactive flow completes in dashboard — widget/iframe opens, flow completes without external redirect (or clean redirect + return)
- [ ] **T9.3**: Reconciliation maps fiat deposits to payroll cycles — reconciliation export matches on-chain USDC transfers
- [ ] **T9.4**: Employee cashes out USDC → VND — SEP-24 cash-out flow → VND arrives in local bank/mobile wallet (test env)
- [ ] **T9.5**: FX rate displayed pre-withdrawal — employee sees conversion breakdown before confirming cash-out
- [ ] **T9.6**: Full flow: fiat funding → ZK payroll → private withdrawal → VND cash-out — end-to-end in staging with test users

### Tranche 3 — Payroll Automation & Production Hardening

**Run**: `npm test` in `zk-payroll-dashboard/` (integration tests in `__tests__/integration/tranche3/`); `cargo test -p payroll` (contract); `cargo run -p e2e-tests --bin testnet_automation_e2e` (native E2E)

- [ ] **T10.1**: `set_authorized_signer()` authorizes delegated key — admin method works; unauthorized address rejected
- [ ] **T10.2**: `run_payroll()` accepts authorized signer — delegated key can call; revocation blocks future calls
- [ ] **T10.3**: Keeper submits `run_payroll()` on schedule — cron fires at due time; tx confirmed on testnet
- [ ] **T10.4**: Pre-generated proof decrypts + submits correctly — keeper decrypts proof blob, submits, run succeeds; keeper never sees salary preimages
- [ ] **T10.5**: Period ID mismatch → skip + alert — keeper detects mismatch, skips submission, alerts employer
- [ ] **T10.6**: Schedule config UI creates/edits/pauses schedules — template library, pause/resume, audit log all work
- [ ] **T10.7**: Vietnam pilot — 2-3 employers, 10-15 contractors complete full flow (KYC → funding → payroll → withdrawal → VND cash-out)
- [ ] **T10.8**: Production monitoring — failed KYC/funding/payroll triggers alerts; monitoring dashboard shows system health; audit-log export works

### Grant-Feature Test Data & Fixtures

- **Sumsub sandbox**: Sumsub test applicant IDs + mock ID documents for KYC flow testing
- **SEP-24 anchor sandbox**: Anchor test environment for fiat deposit simulation + VND cash-out simulation
- **Passkey fixtures**: Mock WebAuthn credentials for smart-account-kit testing in Node.js (no real biometric needed for unit tests)
- **Keeper fixtures**: Mock schedule entries + pre-generated encrypted proof blobs for keeper service tests
- **Vietnam pilot data**: Real employer/contractor data collected during pilot with informed consent

### Phase 11 — Production Backend Architecture (Cross-Tranche, NEW 2026-07-06)

**Run**: `npm test` in `zk-payroll-dashboard/` (integration tests in `__tests__/integration/backend/`)

- [ ] **T11.1**: Event store append-only — no event mutations; all state changes persisted as events
- [ ] **T11.2**: Projections match live state — read models (balance, payroll history, KYC status, reconciliation) match event-derived state
- [ ] **T11.3**: Subscribers react to events — Sumsub/Anchor/Notification/Accounting subscribers fire on matching events
- [ ] **T11.4**: Subscribers idempotent — replaying an event doesn't double-execute side effects
- [ ] **T11.5**: Ledger balances after full flow — funding → payroll → withdrawal → cash-out; debit total == credit total
- [ ] **T11.6**: Running balances match on-chain USDC balances — ledger operational account balance matches actual USDC wallet balance
- [ ] **T11.7**: Operator manual payroll trigger — operator can trigger `run_payroll()` when keeper fails; role-based access enforced
- [ ] **T11.8**: Operator custom report export — CSV/JSON exports for finance teams, regulators, auditors
- [ ] **T11.9**: Account state machine enforced — created → seeded → active → frozen transitions only; invalid transitions rejected
- [ ] **T11.10**: Low XLM balance triggers alert — keeper fee wallet below threshold → operator alert

### Phase 11 Test Data & Fixtures

- **Event store fixtures**: Pre-seeded event sequences for projection testing (KYCApproved → PayrollRunStarted → PayrollRunCompleted → WithdrawalCompleted)
- **Ledger fixtures**: Expected debit/credit pairs for each event type; expected running balances after each transaction
- **Operator fixtures**: Mock operator session with role-based access; test cases for unauthorized access attempts
