---
phase: planning
title: Project Planning & Task Breakdown
description: Agent-custodial ZK privacy pool via x402 protocol on Stellar
---

# Project Planning & Task Breakdown

## Milestones

- [ ] **M1**: Agent project scaffolded, prover compiles to WASM for Node.js, note store schema defined
- [ ] **M2**: Pool contract minimal modifications (AgentRoots getter)
- [ ] **M3**: Agent service core: note generation, ZK proof integration, deposit flow end-to-end
- [ ] **M4**: Withdraw and transfer flows, Stellar 8004 registration
- [ ] **M5**: Stellar RPC subscription for payment detection, admin API
- [ ] **M6**: Integration tests, E2E test with x402 facilitator

## Task Breakdown

### Phase 1: Foundation

- [ ] **1.1** Create `x402-agent-privacy-pool/agent/` Node.js project
  - Outcome: `pnpm` project with TypeScript, Express, better-sqlite3
  - Dependencies: `@trionlabs/8004-sdk`, `stellar-sdk`, `@solana/web3.js` (Soroban RPC)
  - Validation: `pnpm build` succeeds

- [ ] **1.2** Compile prover to WASM for Node.js target
  - Outcome: `app/crates/core/prover/` compiles to WASM via `wasm-pack build --target nodejs`
  - Dependencies: Rust WASM toolchain, wasm-pack
  - Validation: `node -e "require('./pkg/prover')"` loads without error

- [ ] **1.3** Define SQLite note store schema
  - Outcome: `src/note-store/schema.sql` with `notes`, `pool_state`, `processed_payments` tables
  - Dependencies: None
  - Validation: Schema creates without error, indexes tested

### Phase 2: Pool Contract Modifications

- [ ] **2.1** Add `get_agent_root(agent: Address)` getter to pool contract
  - Outcome: Pool contract has public getter, reads from `AgentRoots` map
  - Dependencies: Existing `contracts/pool/` codebase
  - Validation: `stellar contract invoke --id <pool> --fn get_agent_root --arg <agent>`
  - Related design: DD4 (single shared tree, circuit-level isolation)

- [ ] **2.2** Add `AgentRoots` persistent map to pool contract
  - Outcome: Contract stores per-agent latest root, settable by agent owner
  - Dependencies: 2.1
  - Validation: `set_agent_root` and `get_agent_root` round-trip

### Phase 3: Core Agent Service

- [ ] **3.1** Implement note generation and note store CRUD
  - Outcome: `NoteStore` class with `create_note()`, `spend_note()`, `get_unspent_notes()`, `get_balance()`
  - Dependencies: 1.3
  - Validation: Unit tests for all CRUD operations, idempotency

- [ ] **3.2** Integrate WASM prover with agent service
  - Outcome: `ProverService` wrapping WASM prover, exposes `deposit()`, `withdraw()`, `transfer()`
  - Dependencies: 1.2, 3.1
  - Validation: Unit tests: valid proof generation, invalid inputs handled

- [ ] **3.3** Implement deposit flow
  - Outcome: `DepositFlow` — receives amount, generates note, calls prover, submits `transact()` to pool, persists note
  - Dependencies: 3.1, 3.2, 2.2
  - Validation: Happy path test: payment → note → pool tx → note stored

- [ ] **3.4** Implement Stellar 8004 registration
  - Outcome: Agent registers with Identity Registry at startup via `@trionlabs/8004-sdk`
  - Dependencies: 1.1
  - Validation: Agent NFT minted on testnet, agent ID stored in config

### Phase 4: Withdraw, Transfer, Admin

- [ ] **4.1** Implement withdraw flow
  - Outcome: `WithdrawFlow` — selects unspent note, generates withdraw proof, calls `transact()`, updates note store
  - Dependencies: 3.2, 3.3
  - Validation: Pool balance decreases, note marked spent, public wallet credited

- [ ] **4.2** Implement internal transfer (mixing)
  - Outcome: `TransferFlow` — consumes one note, creates new note via transfer proof
  - Dependencies: 3.2
  - Validation: Old note nullified, new note in tree, both tracked in note store

- [ ] **4.3** Admin API: `GET /balance`, `GET /notes`, `GET /status`
  - Outcome: Express routes returning agent's private balance, note list, pool state
  - Dependencies: 3.1, 2.1
  - Validation: Routes return correct data, auth via agent key

### Phase 5: Payment Detection

- [ ] **5.1** Stellar RPC subscription for incoming payments
  - Outcome: Agent subscribes to `Payment` events for agent's Stellar address
  - Dependencies: 1.1
  - Validation: Incoming payment detected within 5s, triggers deposit flow
  - Related design: DD9

- [ ] **5.2** Facilitator `/verify` integration
  - Outcome: Before depositing, agent confirms payment via facilitator `/verify`
  - Dependencies: 5.1
  - Validation: Valid payment → deposit, invalid → logged and skipped

- [ ] **5.3** Idempotency and error recovery
  - Outcome: Duplicate payments handled via `processed_payments` dedup, pool tx failures don't corrupt note store
  - Dependencies: 3.3, 5.1
  - Validation: Same tx hash processed once, failed tx leaves note store unchanged

### Phase 6: Testing & Polish

- [ ] **6.1** Unit tests for all components
  - Outcome: `pnpm test` covers note store, prover integration, flow classes
  - Dependencies: 3.1, 3.2, 3.3, 4.1, 4.2
  - Validation: >80% coverage, all critical paths

- [ ] **6.2** Integration test: full deposit flow with mock Stellar RPC + pool contract
  - Outcome: End-to-end test: payment event → note → proof → pool tx → note stored
  - Dependencies: 3.3, 5.1, 5.2, 5.3
  - Validation: Full flow succeeds with mocked dependencies

- [ ] **6.3** E2E test with real x402 facilitator
  - Outcome: Use real `x402-stellar/examples/facilitator/`, agent deposits real note
  - Dependencies: 6.2
  - Validation: Payment via facilitator → agent deposits to pool on testnet

## Dependencies

```
1.1 (scaffold)
  └─► 1.2 (prover WASM) ─┐
  │                     ├─► 3.1 (note store) ─┬─► 3.2 (prover integration)
  │                     │                     │           │
  │                     │                     │           ▼
  └─► 1.3 (schema) ─────┘                     │     3.3 (deposit flow) ──► 4.1 (withdraw)
        │                                     │           │               │
        │                                     │           ▼               │
        │                                     │     4.2 (transfer)        │
        │                                     │           │               │
        │                                     ▼           ▼               ▼
        │                               4.3 (admin API)              5.3 (idempotency)
        │                                     │           │               ▲
        ▼                                     ▼           ▼               │
  2.1 (contract getter) ──► 2.2 (AgentRoots map)        ▼               │
        │                                               5.1 (RPC sub) ──► 5.2 (verify) ──► 6.1 ──► 6.2 ──► 6.3
        ▼
  (contract deployed)
```

**Key sequencing notes**:
- Contract changes (2.x) are independent of agent service (1.x, 3.x) — can run in parallel
- Phase 3 requires Phase 1 + Phase 2 complete
- Phase 5 (payment detection) builds on Phase 3 core flows
- Testing phase (6.x) is fully sequential

## Risks & Mitigation

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| WASM prover compilation fails for Node.js target | Medium | High | Pre-check: `wasm-pack build --target nodejs --dry-run`. Fallback: use existing browser WASM with `--target web` + node-fetch polyfill |
| Stellar RPC subscription not available in testnet | Low | High | Fall back to polling `getTransactions()` every 5s |
| Pool contract `transact` gas too high for single proof | Medium | Medium | Batch multiple notes in one `transact` call if circuit supports multi-input |
| Note secret loss on agent crash | Low | Critical | SQLite persistence; add encrypted backup to cloud storage |
| x402 facilitator `/verify` false negatives | Low | Medium | Log all verify failures, retry with backoff, alert on repeated failures |

## Timeline & Estimates

| Task | Estimate |
|------|----------|
| 1.1 Scaffold | 2h |
| 1.2 Prover WASM | 4h (may hit build issues) |
| 1.3 Schema | 1h |
| 2.1 Contract getter | 2h |
| 2.2 AgentRoots map | 3h |
| 3.1 Note store | 4h |
| 3.2 Prover integration | 6h |
| 3.3 Deposit flow | 8h |
| 3.4 8004 registration | 3h |
| 4.1 Withdraw flow | 4h |
| 4.2 Transfer flow | 4h |
| 4.3 Admin API | 2h |
| 5.1 RPC subscription | 4h |
| 5.2 Verify integration | 2h |
| 5.3 Idempotency | 3h |
| 6.1 Unit tests | 8h |
| 6.2 Integration test | 6h |
| 6.3 E2E test | 4h |
| **Total** | **~70h** |

**Buffer**: +20% = **~84h** (≈ 2 weeks full-time)

## Resources Needed

- Stellar testnet account with XLM for gas + token funding
- `@trionlabs/8004-sdk` npm package
- `wasm-pack`, `cargo` with `wasm32-unknown-unknown` target
- x402-stellar facilitator running on testnet
- Pool contract deployed to testnet (existing or re-deployed)
- Soroban RPC endpoint (testnet)

## Current Status

All tasks not started. Waiting for Phase 1 to begin.