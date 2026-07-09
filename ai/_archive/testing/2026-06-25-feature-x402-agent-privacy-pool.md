---
phase: testing
title: Testing Strategy
description: Agent-custodial ZK privacy pool via x402 protocol on Stellar
---

# Testing Strategy

## Test Coverage Goals

- **Unit tests**: 100% of new code (note store, prover integration, flows)
- **Integration tests**: All component interactions (note store + prover + pool contract)
- **E2E tests**: Full deposit/withdraw/transfer flows with real contracts on testnet
- **Coverage target**: >80% overall for agent service

## Unit Tests

### NoteStore
- [ ] **createNote()**: generates valid secret, commitment, nullifier; stores in SQLite
- [ ] **createNote() idempotency**: duplicate commitment returns existing note, no duplicate row
- [ ] **spendNote()**: marks note as spent, prevents double-spend
- [ ] **spendNote() error**: spending already-spent note throws error
- [ ] **getUnspentNotes()**: returns only unspent notes with correct balance sum
- [ ] **getBalance()**: sum of unspent note values equals reported balance
- [ ] **processedPayments dedup**: same tx hash rejected on second attempt
- [ ] **merkleProof retrieval**: returns correct proof for given commitment

### ProverService
- [ ] **generateDepositProof()**: produces valid proof object for correct inputs
- [ ] **generateDepositProof() wrong root**: throws error for unknown root
- [ ] **generateWithdrawProof()**: produces valid proof with correct recipient binding
- [ ] **generateTransferProof()**: consumes input note, creates output commitment
- [ ] **WASM load failure**: throws clear error when WASM binary missing/corrupt

### DepositFlow
- [ ] **happy path**: payment amount → note created → proof generated → pool tx submitted → note persisted
- [ ] **fee deduction**: note value = amount - facilitator_fee - agent_fee
- [ ] **pool tx failure**: note not persisted if `transact()` reverts
- [ ] **idempotency**: same payment tx processed once only

### WithdrawFlow
- [ ] **happy path**: unspent note → proof generated → pool tx submitted → note marked spent → balance decreased
- [ ] **insufficient balance**: throws error when no unspent notes
- [ ] **note fully consumed**: note marked spent after withdrawal

### TransferFlow
- [ ] **happy path**: consume note A → create note B → both tracked correctly
- [ ] **old note nullified**: spent note A cannot be reused
- [ ] **new note in tree**: note B commitment appears in pool events

### Stellar8004 Integration
- [ ] **register()**: sends registration tx, returns agent ID (NFT minted)
- [ ] **register() already registered**: no-op or idempotent
- [ ] **register() failure**: throws error, agent continues without registration

### Admin API
- [ ] **GET /balance**: returns correct sum of unspent notes
- [ ] **GET /notes**: returns list of notes with spent/unspent status
- [ ] **GET /status**: returns pool root, note count, agent 8004 ID
- [ ] **unauthorized request**: rejects requests without valid agent signature

## Integration Tests

- [ ] **Deposit + note store sync**: after deposit, `getUnspentNotes()` includes new note
- [ ] **Withdraw + pool state**: after withdraw, pool's nullifier set includes spent nullifier
- [ ] **Note secret never exposed**: note secret exists only in memory during proof generation, not in logs or DB
- [ ] **Concurrent payments**: two payments arriving simultaneously → both processed, no race condition
- [ ] **Pool contract root updated**: after deposit, `get_agent_root()` returns new root
- [ ] **Failed proof generation**: circuit error doesn't leave partial state in note store

## End-to-End Tests

- [ ] **Full deposit**: user pays x402 → facilitator verifies → agent detects payment → deposits to pool → note in note store
- [ ] **Full withdraw**: agent initiates withdraw → pool transfers tokens → agent wallet credited
- [ ] **Full transfer**: agent does internal transfer → old note nullified, new note created on-chain
- [ ] **Agent registration**: fresh keypair → 8004 registration → agent NFT exists on testnet
- [ ] **Multi-agent isolation**: agent A cannot spend agent B's notes (circuit rejects)

## Test Data

**Fixtures**:
- `test/fixtures/agent-keypair.json`: pre-funded testnet keypair
- `test/fixtures/pool-contract-ids.json`: deployed contract IDs for testnet
- `test/fixtures/mock-rpc-server.ts`: mocks Stellar RPC for unit tests

**Mocks**:
- `mockStellarRpc()`: fake incoming payment events
- `mockPoolContract()`: mock `transact()` to succeed/fail
- `mockFacilitator()`: mock `/verify` responses
- `mockProver()`: stub WASM prover for fast unit tests

## Performance Testing

- [ ] ZK proof generation <5s on M-series Mac (standard note)
- [ ] 10 concurrent deposit requests queued and processed sequentially
- [ ] SQLite note store: 1000 notes queried in <100ms
- [ ] RPC subscription reconnects after network interruption

## Manual Testing

- [ ] Agent starts with empty note store, registers with 8004
- [ ] x402 payment sent to agent's address → deposit appears in note store within 60s
- [ ] Withdraw initiated → tokens appear in agent's wallet
- [ ] Admin API `/balance` matches sum of note values
- [ ] Pool contract events visible in Stellar Expert explorer

## Bug Tracking

- **Critical**: Note secret lost, double-spend, funds lost — immediate halt
- **High**: Pool tx failing silently, idempotency broken, balance mismatch — hotfix
- **Medium**: Proof generation >10s, RPC reconnection failures — scheduled fix
- **Low**: Admin API latency, logging verbosity — backlog