---
phase: requirements
title: Requirements & Problem Understanding
description: Compliant confidential payroll pool on Stellar - per-employee salary commitments, batch deposit proofs, ASP-enforced private withdrawals via privacy pool integration
date-updated: 2026-07-01
---

# Requirements & Problem Understanding

## Problem Statement

Payroll on Stellar Soroban today: salary amounts, employee identities, and payment metadata are fully public on-chain. Employers can't hide salary details from competitors. Employees' compensation is visible to everyone. Regulators see everything. No privacy for sensitive financial data.

**Current state (zk-payroll-dashboard)**:
- Salary amounts visible in plain text on-chain
- Employee identities tied to every payment
- Compliance auditors see everything or nothing
- ZK proof system is a mock - no real cryptography (SHA-256 "proofs", localStorage "compliance")

**Current state (in-repo payroll implementation)**:
- `circuits/src/payroll.circom` (`PayrollBatch`) - real batch proof circuit with Poseidon2 commitments, Merkle membership, sum conservation, and range checks. Has two known bugs: dead `actualEmployeeCount` input and no-op range-check loop (see Key design decisions).
- `contracts/payroll/src/payroll.rs` - real on-chain contract: verifies Groth16 proof, enforces budget cap, escrows USDC. However `withdraw()` is a stub returning `ProofVerificationFailed`; `PayrollWithdrawCircuit.circom` does not exist; no nullifier set is stored on-chain.
- `contracts/pool/` + `contracts/asp-membership/` + `contracts/asp-non-membership/` - complete, tested privacy pool with ASP membership (approved-list) and ASP non-membership (sanctions-list) enforcement inside `policyTransaction.circom`, checked on-chain at transaction time. **This infrastructure is built but not connected to payroll.**
- Browser WASM prover layer (`realProver.ts`, `realProver.worker.ts`, `pkCache.ts`, `merkleTree.ts`) added to the dashboard fork but not wired to the UI (PayrollWizard still uses `merkleRoot: "123456789"`, `salt: "default-salt"`, mock employees).

**What we need**: Individual employee salary commitments that sum to a verifiable total, held in escrow by a standalone payroll contract. Employees withdraw privately via a `PayrollWithdrawCircuit` ZK proof (proves commitment ownership without revealing which employee). Full compliance audit suite via auditor view keys. Browser-native ZK proving for deposits. No trusted third parties.

## Goals & Objectives

**Primary goals**:
1. Each employee's salary committed via `Poseidon2(employeeId, salaryAmount, salt)` - amount hidden until auditor reveals
2. Batch ZK proof aggregates all employee commitments - verifies `sum(salaries) = totalPayrollAmount` without revealing individuals
3. Employee Merkle tree membership proof - auditor verifies every payroll recipient is an authorized employee
4. On-chain budget cap enforcement - `totalPayrollAmount <= companyBudgetCap`
5. Groth16 deposit proofs generated in-browser (WASM) for <=500 employees; server-side for larger batches
6. USDC-denominated payroll on Stellar Soroban
7. **Standalone payroll contract** - own escrow, own withdrawal, no dependency on privacy pool contract
8. **ZK withdrawal via `PayrollWithdrawCircuit`** - employee proves commitment ownership without revealing which employee; nullifier set prevents double-withdrawal
9. **Auditor view key access** - encrypted salary blobs on IPFS; auditor decrypts with X25519 private key

**Secondary goals**:
- Selective disclosure: auditors see individual salaries only via view key / disclosure receipt
- Multi-period payroll: new commitments per period, old commitments preserved
- Revocation: employers can deactivate employees, new payroll runs exclude them
- Merkle root aggregation for large companies (>500 employees): aggregate multiple batch roots into a single on-chain deposit to reduce on-chain cost
- **Future v2**: Pool integration for multi-employer anonymity set and ASP compliance on withdrawals

**Non-goals**:
- **Pool integration (v1)** - standalone payroll contract; pool integration deferred to v2 for multi-employer anonymity
- **Recursive proof aggregation (Groth16-in-Groth16)** - pairing-check-in-circuit overhead (~15-25M constraints per pairing) exceeds the batch proof itself (~2M constraints for 500 employees). Merkle root aggregation + sequential batches are the scaling path instead.
- Multi-token support - USDC only initially
- Cross-chain payroll - Stellar only
- Automatic payroll scheduling - manual trigger only
- Employee self-onboarding to employee Merkle tree - employer manages tree (v2 may add registry)
- Jurisdictional tax-withholding proof circuit - future phase
- Credit/payment terms (net-30/net-60) - future phase
- RWA collateralization - future phase

## Success Criteria

1. `PayrollBatch` circuit (`circuits/src/payroll.circom`) compiles with `circom 2.2.2` - bugs fixed (`actualEmployeeCount` removed, range-check constants split)
2. `PayrollWithdrawCircuit` (`circuits/src/payrollWithdraw.circom`) compiles with `circom 2.2.2` - proves commitment ownership + nullifier freshness without revealing employee identity
3. Browser WASM prover generates Groth16 deposit proofs locally (< 10s for 100 employees, < 30s for 500 employees)
4. Payroll contract verifies deposit proof in single Soroban transaction, stores period record, transfers USDC to escrow
5. Budget cap enforced on-chain - excess rejected (amount derived from proof, not call arg)
6. Employee Merkle tree membership checked on-chain - unauthorized employees rejected
7. View key reveals individual salary + employeeId to authorized auditor (X25519-XSalsa20-Poly1305)
8. Employee can withdraw their salary via `PayrollWithdrawCircuit` ZK proof - contract verifies proof, marks nullifier spent, transfers USDC to employee; employer never learns which employee withdrew
9. Encrypted salary blobs stored off-chain (IPFS), payroll contract stores only `commitmentId -> IPFS_CID`
10. Demo: employer deposits payroll for 10 employees, total = $500K, each individual salary hidden; auditor with view key can decrypt one employee's salary; one employee withdraws privately via ZK proof



## User Stories & Use Cases

**As an employer**, I want to pay employees without revealing individual salaries to competitors, regulators, or the public.

**As an employee**, I want my salary to be private - only visible to me and authorized auditors. I want to withdraw my salary to a fresh address using a ZK proof so that nobody - not the employer, not the chain - can link the withdrawal to my identity.

**As a compliance auditor**, I want to verify: (1) all payroll recipients are on the company employee list, (2) total amount doesn't exceed budget cap, (3) each commitment is valid, (4) encrypted salary blobs are retrievable via IPFS CIDs stored on-chain - all without seeing individual salaries unless explicitly granted view key access.

**As a company accountant**, I want to see aggregate payroll totals per period without linking to specific employees.

**As a regulator**, I want to verify that the pool enforces sanctions screening (ASP non-membership) at the proof level - sanctioned entities cannot produce valid withdrawal proofs - without deanonymizing compliant users.

**Use cases**:
1. Seed-stage startup pays engineers $80k-$200k - salaries hidden from public, investors, and competitors
2. HR compliance audit - auditor proves every recipient is a real employee, total is under board-approved budget, and each commitment is valid
3. Board salary review - view key reveals department averages, not individual names
4. Payroll for 1-500 employees per period (single batch); 500-50,000 via sequential batches + Merkle root aggregation
5. **Private withdrawal**: employee withdraws salary via ZK proof to a fresh address; employer cannot determine which employee withdrew
6. **Multi-period payroll**: employer runs payroll monthly; each period creates new commitments; old commitments preserved in Merkle tree

**Assumptions**:
- Employer has sufficient USDC balance to cover payroll
- Employee Merkle tree managed off-chain by employer - root posted to payroll contract via `set_employee_root()`
- View key transmission: `set_view_key_for_auditor(auditorAddress, encryptedKey)` on contract - auditor retrieves via `get_view_key()` (auditor must have Soroban wallet)
- View key is an X25519-encrypted symmetric key - decrypts encrypted salary blob stored on IPFS
- Salt generated client-side, never transmitted unencrypted
- Payroll period ID is a monotonic `u64` counter - prevents replay
- Target network supports Protocol 25 (CAP-0074 BN254 host functions) - verify before mainnet deployment
- `total_payroll_amount` is derived from `public_inputs[1]` (proof-bound), not a separate call argument
- `employee_count` is derived from `ipfs_cids.len()`, not a separate call argument

## Constraints & Assumptions

**Technical constraints**:
- Browser WASM proving for deposits <=500 employees; server-side Rust prover for larger batches
- Two Groth16 circuits: `PayrollBatch` (deposit) + `PayrollWithdrawCircuit` (withdrawal). Both share the same Powers of Tau (Phase 1) + per-circuit Phase 2 ceremony.
- Groth16 with BN254. CAP-0074 (BN254 host functions) is **Final** (Protocol 25, created 2025-09-25). `soroban-sdk` 26 ships `crypto::bn254` module. BN254 offers ~100-bit security - acceptable for payroll; document for institutional buyers.
- Poseidon2 hash inside circuits (same as privacy pool - shared `circuits/src/poseidon2/` and `circuits/src/merkleProof.circom`)
- Soroban smart contracts (same network as privacy pool)
- USDC as payroll token (SOROBAN_USDC)
- Trusted setup: Powers of Tau (Phase 1, universal) + **per-circuit Phase 2 ceremony** required for each Groth16 circuit. Use existing `tools/ceremony-cli/`.
- Encrypted salary blobs stored off-chain (IPFS) - payroll contract stores only `commitmentId -> IPFS_CID`
- Scaling: 500 employees/batch (flat). >500 -> sequential batches. >5,000 -> Merkle root aggregation circuit (batch roots -> period root, ~80K constraints, 20:1 on-chain cost reduction). No recursive proofs (see Non-goals).
- Nullifier set stored on-chain in payroll contract (Map<U256, bool>) - prevents double-withdrawal

**Key design decisions**:
- **Standalone payroll (reversal of pool integration)**: The original requirements proposed depositing into the privacy pool for multi-employer anonymity. This is reversed (2026-07-03 design review) — standalone payroll contract with own escrow and own `PayrollWithdrawCircuit`. Rationale: simpler, self-contained, no dependency on pool contract lifecycle. Pool integration deferred to v2.
- **`PayrollWithdrawCircuit` for ZK withdrawals**: Employee proves commitment ownership without revealing which employee. Uses nullifier set to prevent double-withdrawal. Same pattern as privacy pool but standalone.
- **Proof-bound amounts**: `total_payroll_amount` derived from `public_inputs[1]`, not a separate call arg. Prevents employer from proving amount A while escrowing amount B.
- **`actualEmployeeCount` dead input**: `circuits/src/payroll.circom` declares `signal input actualEmployeeCount` but never reads or constrains it. The sum constraint naturally enforces zero salary for padding slots. Remove the signal.
- **Range-check no-op bug**: `MAX_SALARY_BITS = 50` and `PAYROLL_MAX_SALARY_BIT_LIMIT = 50` are equal, so the zeroing loop runs zero iterations. Fix: set `MAX_SALARY_BITS = 64`, keep `PAYROLL_MAX_SALARY_BIT_LIMIT = 50` so bits [50,64) are constrained to zero.
- **`init` -> `__constructor`**: Payroll contract uses manual `init` with `AlreadyInitialized` guard. Every other contract in the repo uses `__constructor` (Protocol 22+ one-shot). Rename + redeploy.

## Questions & Open Items

| Question | Answer / Decision |
|---|---|
| Should we build a standalone `PayrollWithdrawCircuit`? | **Yes.** The standalone architecture requires a payroll-specific withdrawal circuit. Employee proves commitment ownership + nullifier freshness without revealing identity. Same pattern as pool's nullifier set but standalone. |
| Should we use recursive proofs (Groth16-in-Groth16) for scaling? | **No.** A single BN254 pairing inside a circuit is ~15-25M constraints - 10x larger than the entire 500-employee batch proof. Aggregating 10 batches would be ~500M+ constraints (tens-of-GB proving key, hours of browser proving). Merkle root aggregation (~80K constraints, 20:1 on-chain cost reduction) is the scaling path instead. |
| Can an employee self-prove their salary to a third party? | **Yes - via selective disclosure receipt**: employee generates a `selectiveDisclosure` proof (existing circuit) proving ownership of a salary commitment, bound to an audit context. Third party verifies the receipt walletlessly (proof valid + context valid + root fresh). Does NOT reveal salary unless employee explicitly shares the IPFS-encrypted blob + view key. |
| What happens to commitments when an employee is removed? | **Existing commitments persist** on-chain (in the pool Merkle tree). New payroll periods exclude deactivated employees (employer rebuilds employee tree without them). Pool leaves are immutable once inserted. |
| Who performs the Groth16 trusted setup ceremony? | **Powers of Tau** (Phase 1, universal, BN254) + **per-circuit Phase 2 ceremony** for `PayrollBatch` and `PayrollDeposit`. Use `tools/ceremony-cli/`. For mainnet, a real multi-party ceremony is required, not a single-contributor dev setup. |
| Is there a maximum employee count per payroll proof? | **500 max** per single `PayrollDeposit` proof. Larger companies run multiple sequential batches. >5,000 employees: add Merkle root aggregation circuit to reduce on-chain tx count. |
| Where are encrypted salary blobs stored? | **IPFS off-chain** - payroll contract stores only `commitmentId -> IPFS_CID`. Blobs uploaded by employer at payroll time, retrieved by auditor from IPFS. This is complementary to (not replacing) the pool's per-note X25519 encryption. |
| How do employees withdraw their salary? | **Via `PayrollWithdrawCircuit` ZK proof**: employee generates a proof proving ownership of a salary commitment in the employee Merkle tree, without revealing which employee. Contract verifies proof, marks nullifier spent, transfers USDC to employee's fresh address. No pool integration needed. |
| What is the on-chain cost of a payroll deposit? | One BN254 pairing check per `PayrollDeposit` batch (via `circom-groth16-verifier`). CAP-0074 `Bn254Pairing` cost type is linear in input length. Budget via `--send=no` simulation before committing to per-transaction verification at scale. |
| Is Protocol 25 (CAP-0074) live on target network? | **Verify before mainnet.** CAP-0074 is Final and targets Protocol 25. Testnet deployment is confirmed (existing contract IDs). Check Stellar software-versions page for mainnet protocol version before mainnet deployment. |

## Architecture Summary

```
Browser (employer - deposit)
  |-- Employee Merkle tree builder (off-chain)
  |-- PayrollBatch WASM prover (Groth16, browser-native for <=500)
  |-- encryptSalary(X25519 pubkey) -> encrypted blob (X25519-XSalsa20-Poly1305)
  |-- uploadToIPFS(blob) -> ipfsCid
  `-- call set_employee_root(), set_view_key_for_auditor(), run_payroll()
      `-- run_payroll() verifies PayrollBatch proof -> escrows USDC -> stores period + commitments

Browser (employee - withdrawal)
  |-- PayrollWithdrawCircuit WASM prover (Groth16, single commitment)
  |-- generateWithdrawProof(commitment, salt, merklePath, nullifierPath)
  `-- call PayrollContract.withdraw() - NOT pool contract
      `-- PayrollContract verifies: proof valid + nullifier unspent + commitment in tree
      `-- PayrollContract transfers USDC to employee's fresh address

Soroban PayrollContract (standalone)
  |-- employeeRoot: U256 - set by employer via set_employee_root()
  |-- budgetCap: U256 - max totalPayrollAmount per period
  |-- usdcToken: Address - SOROBAN_USDC
  |-- verifier: Address - circom-groth16-verifier contract
  |-- currentPeriod: u64 - monotonic counter
  |-- periods: Map<periodId, PayrollPeriod { commitmentRoot, totalAmount, employeeCount }>
  |-- commitments: Map<commitmentId, CommitmentRecord { commitmentId, ipfsCid }>
  |-- nullifiers: Map<nullifier, bool> - prevents double-withdrawal
  |-- auditorViewKeys: Map<auditorAddress, AuditorRecord { encryptedViewKey, revoked }>
  |-- __constructor(env, admin, token, verifier, employeeRoot, budgetCap)
  |-- set_employee_root(root)
  |-- set_budget_cap(cap)
  |-- set_view_key_for_auditor(auditor, encryptedKey)
  |-- get_view_key(auditor) -> Bytes (auditor self-service)
  |-- revoke_auditor(auditor)
  |-- run_payroll(proof, publicInputs, ipfsCids) - verify proof, escrow USDC
  |-- withdraw(proof, publicInputs) - verify PayrollWithdrawCircuit proof, transfer to employee
  `-- get_payroll_period(periodId) -> { commitmentRoot, totalAmount, employeeCount }

Soroban CircomGroth16Verifier (existing, unchanged)
  |-- verify(proof, publicInputs) -> bool - BN254 pairing check via env.crypto().bn254()
  `-- VK embedded at compile time (build.rs from verification_key.json)

IPFS
  `-- Stores encrypted salary blobs: (employeeId, salaryAmount, salt) encrypted with X25519-XSalsa20-Poly1305

Auditor (has Soroban wallet + X25519 private key)
  |-- get_view_key() -> encrypted view key
  |-- fetchFromIPFS(ipfsCid) -> encrypted blob
  |-- decryptSalary(encryptedBlob, viewKey) -> (employeeId, salaryAmount)
  `-- [ALSO] verify disclosure receipt walletlessly: proof valid + context valid + root fresh
```

Soroban PayrollContract (standalone, deposit + withdrawal)
  |-- employeeRoot: U256 - set by employer via set_employee_root()
  |-- budgetCap: U256 - max totalPayrollAmount per period
  |-- usdcToken: Address - SOROBAN_USDC
  |-- verifier: Address - circom-groth16-verifier contract
  |-- currentPeriod: u64 - monotonic counter
  |-- periods: Map<periodId, PayrollPeriod { commitmentRoot, totalAmount, employeeCount }>
  |-- commitments: Map<commitmentId, CommitmentRecord { commitmentId, ipfsCid }>
  |-- nullifiers: Map<nullifier, bool> - prevents double-withdrawal
  |-- auditorViewKeys: Map<auditorAddress, AuditorRecord { encryptedViewKey, revoked }>
  |-- __constructor(env, admin, token, verifier, employeeRoot, budgetCap)
  |-- set_employee_root(root)
  |-- set_budget_cap(cap)
  |-- set_view_key_for_auditor(auditor, encryptedKey)
  |-- get_view_key(auditor) -> Bytes (auditor self-service)
  |-- revoke_auditor(auditor)
  |-- run_payroll(proof, publicInputs, ipfsCids) - verify proof, escrow USDC
  |-- withdraw(proof, publicInputs) - verify PayrollWithdrawCircuit proof, transfer to employee
  `-- get_payroll_period(periodId) -> { commitmentRoot, totalAmount, employeeCount }

## Derived From

- `circuits/src/payroll.circom` — existing `PayrollBatch` circuit (deposit/batch proof, has bugs to fix)
- `circuits/src/payroll_20.circom` — existing entry point `PayrollBatch(20, 500)`
- `circuits/src/payroll_10_10.circom` — browser entry point `PayrollBatch(10, 10)`
- `circuits/src/merkleProof.circom` — reused by both `PayrollBatch` and `PayrollWithdrawCircuit`
- `circuits/src/poseidon2/` — shared Poseidon2 hash implementation
- `contracts/payroll/src/payroll.rs` — existing payroll contract (deposit side — `withdraw()` stub to be replaced with `PayrollWithdrawCircuit` verification)
- `contracts/circom-groth16-verifier/` — existing BN254 Groth16 verifier (reused for both deposit and withdrawal proofs)
- `app/crates/core/prover/src/flows.rs` — `payroll_proof()` function for generating deposit circuit inputs
- `app/crates/core/prover/src/encryption.rs` — X25519-XSalsa20-Poly1305 encryption for salary blobs
- `tools/ceremony-cli/` — existing trusted setup ceremony tool (for `PayrollWithdrawCircuit` Phase 2)
- `deployments/scripts/deploy-payroll.sh` — deployment script for testnet

**Public inputs to PayrollBatch circuit**: `[employeeRoot, totalPayrollAmount, payrollPeriodId]`

**Private inputs**: per-employee `employeeId[n]`, `salaryAmount[n]`, `salt[n]`, `pathElements[n][levels]`, `pathIndices[n]`

**Public inputs to PayrollWithdrawCircuit (Phase 2)**: `[commitmentRoot, nullifierRoot, commitmentId, salaryAmount]`

**Private inputs**: `commitment`, `employeeId`, `salaryAmount`, `salt`, `commitmentPathElements[levels]`, `commitmentPathIndices`, `nullifierPathElements[levels]`, `nullifierPathIndices`
