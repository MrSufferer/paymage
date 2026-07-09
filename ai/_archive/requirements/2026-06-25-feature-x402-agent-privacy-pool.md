---
phase: requirements
title: Requirements & Problem Understanding
description: Agent-custodial ZK privacy pool with x402 payment settlement for Stellar
---

# Requirements & Problem Understanding

## Problem Statement

Agents on Stellar want to offer **privacy-enhanced payment services** to users. Users pay an agent for privacy — the agent batches transactions through a ZK privacy pool, breaking the on-chain link between sender and recipient. Currently no infrastructure exists for:

- Agents to receive x402 payments and convert them to private note balances
- Agent-custodial ZK note management (agent holds keys, generates proofs server-side)
- Multi-agent coordination through a shared Soroban privacy pool contract
- Per-transaction fee collection for privacy services

**Who is affected**: Stellar ecosystem agents, dApp developers, end users needing transaction privacy.

**Current workaround**: None. Privacy pools exist for self-custody only.

## Goals & Objectives

**Primary goals**:
1. Agent registers on-chain via Stellar 8004 Identity Registry (agent NFT + identity)
2. Agent receives x402 Stellar payments into its own public wallet (detected via Stellar RPC subscription)
3. Agent runs WASM prover (same circuits as browser SDK, compiled for Node.js) to generate ZK proofs server-side
4. Multi-agent coordination through shared pool contract — all agents share one Merkle tree on-chain. Agent isolation enforced by circuit.
5. Agent accumulates private balance from user payments minus fees
6. Agent can withdraw accumulated private balance to its own public wallet
7. Agent pays x402 facilitator fees from public balance when settling user payments

**Non-goals**:
- Multi-chain support (Stellar/Soroban only)
- Per-agent Merkle trees in pool contract (single shared tree with circuit-level agent isolation)
- Multi-user internal ledger (single agent identity per privacy pool)
- User-internal transfers (agent is sole note holder; privacy is agent-to-pool and agent-to-recipient)
- Self-custody privacy flows
- Stellar 8004 reputation/validation (identity only in v1)

## User Stories & Use Cases

**Deposit flow** (user paying agent for privacy service):
- User initiates x402 payment to agent's Stellar address via existing x402 flow (payment to facilitator → facilitator verification)
- Agent receives payment notification via facilitator webhook/callback
- Agent generates note secret internally, computes commitment, generates deposit ZK proof via WASM
- Agent calls `token.transfer(agent, pool, amount)` then `transact()` — tokens move to pool contract, proof verified, commitment added to shared Merkle tree
- Agent's private balance (local note store) increases by (received amount - x402 facilitator fee - agent fee)
- No user involvement after initial payment

**Transfer flow** (agent moving funds between own notes for mixing):
- Agent generates a new note secret internally, creates a transfer ZK proof consuming an existing note and creating a new commitment
- Submitted to pool contract; old note nullified, new note added to agent's Merkle tree
- Used to break on-chain link between deposits and withdrawals

**Withdraw flow** (agent converting private balance to public):
- Agent initiates withdrawal: generates withdrawal ZK proof consuming a note, submits to pool via `transact()`
- Pool contract transfers tokens from its balance to agent's wallet via `token.transfer(pool, agent, amount)`
- Agent's private balance (local note store) decreases; agent's public token balance increases (minus network fees)

**Agent commerce flow**:
- Agent receives x402 payments from multiple users into public wallet
- Agent deposits to pool, accumulates private balance across notes
- Agent withdraws to public wallet when needed to pay x402 facilitator fees or convert to fiat/external tokens

## Success Criteria

1. Agent registers on Stellar 8004 trust registry and obtains on-chain identity
2. Agent receives x402 payment and deposits to pool within 1 minute of on-chain confirmation
3. ZK proof generation via Node.js WASM prover completes in <5s for standard transactions
4. Pool contract accepts proofs from multiple agents without note commitment collision
5. Agent can withdraw accumulated private balance to public wallet
6. Agent correctly deducts its fee from each deposit (difference between x402 payment received and pool deposit amount)
7. All existing pool contract security invariants preserved

## Constraints & Assumptions

**Technical constraints**:
- Reuse `contracts/pool/` Soroban contract (minimal modifications)
- Reuse `app/crates/core/prover/` Rust prover, compiled to WASM for Node.js runtime
- Agent identity via Stellar 8004 Identity Registry — agent registers as NFT, same keypair used for all operations
- Each agent maintains local tracking of its notes (off-chain), but all commitments go into the shared pool Merkle tree
- Pool contract tracks one Merkle tree for all agents. Agent isolation enforced by circuit.
- No internal ledger — agent's private balance is the sum of unspent note values in its local note store

**Assumptions**:
- Agent Stellar secret key used for both x402 receiving, Stellar 8004 registration, and note signing (same identity)
- Agent fee percentage configured at startup via env var (e.g. `AGENT_FEE_BASIS_POINTS=100` = 1%)
- No separate user identities inside agent — agent is sole note holder
- User payment flow: user → x402 facilitator → agent's public wallet. Agent then deposits to pool autonomously.
- Agent operates autonomously after receiving payment notification; no human-in-the-loop for ZK proof generation
- No regulatory compliance requirements for this phase
- Pool minimum note denomination exists (circuit constraint). Micro-payments below min are not private until batched and deposited.
- Privacy during micro-payment accumulation period is NOT guaranteed. Agent's public wallet holds unbatched funds in clear.

## Questions & Open Items

All questions resolved:

| Question | Answer |
|----------|--------|
| Agent identity on pool? | Stellar 8004 Identity Registry — agent registers as NFT, same keypair for all operations |
| Fee model? | Per-transaction fee in basis points, configured at agent startup |
| Multi-agent coordination? | Shared pool Merkle tree for all agents. Circuit enforces agent ID binding. Agent tracks its notes locally (off-chain). |
| Note management? | No ledger. Agent's private balance = sum of unspent note values in its local note store. |
| Withdrawal destination? | Agent's own wallet; agent pays Stellar network fees in XLM |
| Note secret generation? | Agent generates internally in its prover process. No human involvement. |
| x402 facilitator role? | Agent is x402 client (pays facilitator for payment verification), not facilitator itself |
| Payment notification? | Stellar RPC subscription — agent subscribes to incoming payments on its address. No facilitator webhook. |