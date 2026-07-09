---
phase: planning
title: Project Planning & Task Breakdown
description: Ship compliant intent privacy pool in 4 days — intent circuit + pool contract + demo
---

# Project Planning & Task Breakdown

## Milestones

- [x] **M1** (Day 1 end ✅): `CompliantIntent.circom` compiles, dual Merkle proof constraints defined
- [x] **M2** (Day 2 end ✅): Pool contract modified — `IntentProof` struct + `verify_intent` function
- [x] **M3** (Day 3 end ✅): Agent SDK extends trust402: intentProve() + intentSubmit() + PoolClient + 11 tests passing
- [x] **M4** (Day 4 end ✅): E2E demo — `pnpm demo:intent` runs end-to-end

## Task Breakdown

### Day 1: Circuit ✅

- [x] **1.1** Create `compliant-intent.circom`
  - Poseidon(secretKey) = nullifier
  - Poseidon(secretKey) = ASP Merkle leaf (links identity to membership)
  - hash(intentMessage || nonce) = intentHash
  - Dual Merkle proofs: ASP membership + nullifier unspent
  - No cryptographic signatures — only hash commitments + Merkle proofs
  - Outcome: `compliantIntent_1.circom` compiles with circom 2.2.2

- [x] **1.2** Compile circuit with `circom 2.2.2`
  - `cargo build -p circuits` produces `.r1cs`, `.wasm`, `.sym` files
  - `REGEN_KEYS=1 cargo build -p circuits` generates Groth16 keys
  - Output: `testdata/compliantIntent_1_proving_key.bin`, `_vk.json`, `_vk_soroban.bin`

- [ ] **1.3** Write circuit tests
  - Pending — skipped for POC timeline

### Day 2: Pool Contract ✅

- [x] **2.1** Pool contract: add `IntentProof` struct
  - `proof: Groth16Proof`, `asp_root`, `nullifier_root`, `intent_hash`, `nullifier`, `output_commitment`
  - Added to `contracts/pool/src/pool.rs`

- [x] **2.2** Pool contract: add `verify_intent` function
  - Checks nullifier not spent
  - Calls Groth16 verifier with 3 public inputs [aspRoot, nullifierRoot, intentHash]
  - Marks nullifier as spent
  - Inserts output commitment into Merkle tree

- [x] **2.3** Pool contract: add `verify_intent_proof` internal function
  - Builds public input vector for CompliantIntent circuit
  - Calls `CircomGroth16VerifierClient::verify`

### Day 3: Agent SDK (trust402 extension)

- [ ] **2.1** Modify `contracts/pool/` to store ASP root reference
  - Add `aspRoot: U256` storage — set by admin, references `asp-membership` contract
  - Add `nullifierRoot: U256` storage — tracks spent nullifier Merkle root
  - Outcome: Pool contract reads ASP root from `asp-membership` contract

- [x] **2.2** Add `verify_intent` to pool contract
  - `IntentProof` struct: `proof`, `asp_root`, `nullifier_root`, `intent_hash`, `nullifier`, `output_commitment`, `encrypted_output`
  - `verify_intent(env, proof, sender)`: checks nullifier, verifies ASP root, verifies Groth16 proof, marks spent, inserts commitment
  - `verify_intent_proof(env, proof)`: calls `CircomGroth16VerifierClient::verify` with 3 public inputs [aspRoot, nullifierRoot, intentHash]
  - Outcome: Pool accepts intent proofs

- [x] **2.3** Update nullifier set after valid intent
  - After `verify_intent` succeeds: mark nullifier as spent + emit `NewNullifierEvent`
  - Insert output commitment into Merkle tree + emit `NewCommitmentEvent`
  - Outcome: Double-spend prevention + note commitment tracking

### Day 3: Agent SDK (trust402 extension)

- [x] **3.1** Extend `@trust402/identity` with intentProve + intentSubmit
  - `intentProve(client, IntentProveInput)`: calls Lemma prover with `compliantIntent_1` circuit
  - `intentSubmit(client, docHash, proofResult)`: submits to Lemma oracle with `compliantIntent_1` circuitId
  - `IntentProveInput` type: `secretKey`, `nonce`, `intentMessage`, `membershipPathElements`, `membershipPathIndices`, `nullifierPathElements`, `nullifierPathIndices`
  - Poseidon hashes computed inside Lemma WASM prover — no JS Poseidon needed
  - Tests: 11 passing
  - Outcome: Agent can generate and submit intent proofs via Lemma oracle

- [x] **3.2** Pool client for intent submission
  - `PoolClient` class in `trust402/packages/demo/src/pool-client.ts`
  - `getAspRoot()`, `getNullifierRoot()`, `getPoolRoot()` — read from Soroban contracts
  - `generateIntentProof()` — calls Lemma oracle via `intentProve()`
  - `submitIntentProof()` — builds and submits Soroban transaction
  - Uses `stellar-sdk` for Soroban RPC interaction
  - Outcome: Agent can submit intent proofs to pool contract

- [x] **3.3** Extend demo to use intent flow
  - `trust402/packages/demo/scripts/demo-intent.ts` — mock E2E demo
  - 6 phases: initialization → intent creation → nullifier generation → pool submission → verification → events
  - Run via `pnpm --filter @trust402/demo demo:intent`
  - Outcome: Demo runs end-to-end with mock data

### Day 4: E2E + Polish ✅

- [x] **4.1** E2E demo (mock)
  - `demo-intent.ts` runs full flow with mock Soroban RPC + Lemma oracle
  - Shows: intentHash, nullifier, ASP proof, Groth16 verification, pool events

- [x] **4.2** Build and verify
  - `cargo build` — 0 errors, pool contract + circuits compile
  - `pnpm --filter @trust402/identity test` — 11 passing
  - `pnpm --filter @trust402/protocol test` — 26 passing
  - `pnpm --filter @trust402/demo demo:intent` — runs clean

- [x] **4.3** Document ✅
  - Updated `trust402/README.md` with intent flow
  - Updated `trust402/AGENTS.md` with new `compliantIntent_1` circuit
  - Outcome: Docs reflect what was built

## Dependencies

```
Day 1:
  1.1 (circuit design) → 1.2 (compile) → 1.3 (test)
            │
Day 2:      ↓
  2.1 (pool storage) → 2.2 (verify_intent) → 2.3 (nullifier update)
            │
Day 3:      ↓
  3.1 (intent SDK) → 3.2 (pool client) → 3.3 (demo)
            │
Day 4:      ↓
  4.1 (two-agent demo) → 4.2 (build) → 4.3 (docs)
```

**Parallel tracks** (can run simultaneously):
- Circuit (Day 1) and pool contract (Day 2) are independent until Day 3 integration
- SDK (Day 3) and contract (Day 2) are independent until Day 3

## Timeline & Estimates

| Task | Estimate |
|------|----------|
| 1.1 CompliantIntent circuit | 6h |
| 1.2 Circuit compilation | 2h |
| 1.3 Circuit tests | 2h |
| 2.1 Pool: ASP root storage | 2h |
| 2.2 Pool: verify_intent | 4h |
| 2.3 Pool: nullifier set update | 2h |
| 3.1 SDK: intent signing | 4h |
| 3.2 SDK: pool client | 2h |
| 3.3 Demo extension | 2h |
| 4.1 Two-agent E2E | 4h |
| 4.2 Build + verify | 2h |
| 4.3 Docs | 2h |
| **Total** | **~34h** |

**Buffer**: +10% = **~37h** (4 days full-time)

## Risks & Mitigation

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| `eddsa_verify` not available in circom 2.2.2 | Low | Medium | Use ECDSA (native Ethereum precompile) or implement in circuit |
| Poseidon2 not compatible with circom 2.2.2 | Low | High | Use circom's native Poseidon from `circomlib` |
| Merkle proof circuit doesn't support dynamic tree updates | Medium | Medium | Pre-commit to fixed depth (levels=20) |
| Soroban contract too large for all verification | Medium | High | Split verification: signature on-chain, Merkle proofs off-chain? |
| Demo fails on testnet (RPC issues) | Low | Medium | Use local Soroban anvil or pre-deployed testnet contract |

## Resources Needed

- `circom 2.2.2` compiler
- `snarkjs` for proof generation (if needed) or native Stark verification
- Stellar testnet with USDC token
- Existing `contracts/pool/` deployed to testnet (or redeploy)
- Existing `contracts/asp-membership/` deployed to testnet (or redeploy)
- `@trust402/identity` keypair already working
