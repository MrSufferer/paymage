---
phase: requirements
title: Requirements & Problem Understanding
description: Compliant intent privacy pool — verifiable intent + ASP membership + nullifier privacy on Stellar
---

# Requirements & Problem Understanding

## Problem Statement

AI agents need **private transactions with compliance**. Current state:
- Privacy pools = full anonymity, no way to exclude bad actors
- x402 agents = identified but not private
- Groth16 proving = 5-30s per transaction, too slow for machine-speed commerce
- No way to prove "I am authorized" without revealing who you are

**Core tension**: Privacy requires anonymity. Compliance requires identity verification. Nobody has solved both simultaneously without trusted third parties.

**Reference**: `circuits/src/selectiveDisclosure.circom` (proves note ownership). `circuits/src/policyTransaction.circom` (ASP membership in transaction). `contracts/asp-membership/` (on-chain ASP Merkle root registry).

## Goals & Objectives

**Primary goals**:
1. Agent signs an **intent message** — "I authorize transfer of X to address Y" — with their secret key
2. Agent generates a **nullifier** = Poseidon(secret_key) — proves liveness, prevents double-spend, no identity revealed
3. Agent proves **ASP membership** via Merkle proof against on-chain ASP root (compliance requirement)
4. Agent proves **nullifier not spent** via Merkle proof against nullifier set root
5. Pool contract verifies: intent signature valid + nullifier unspent + ASP membership + balance conservation

**Non-goals**:
- Groth16 / zkSNARK proving (killed — too slow)
- TEE-based privacy (killed — hardware trust)
- Multi-chain support (Stellar only)
- Token minting or bridging (existing pool contract handles this)

## User Stories & Use Cases

**As an authorized agent**, I want to send a private payment by proving I'm on the ASP allowlist without revealing which agent I am.

**As a compliance officer**, I want the ASP membership list to be on-chain and auditable, while individual agent identities remain private.

**As a pool operator**, I want to reject transactions from non-ASP members without knowing who they are.

**Use cases**:
- Regulated agent economies: financial agents, health agents, legal agents — privacy + compliance simultaneously
- Airdrop/voting: prove you're on the allowlist without revealing which member you are
- Budget enforcement: prove your spend limit hasn't been exceeded without revealing your balance

## Success Criteria

1. `CompliantIntent.circom` compiles with `circom 2.2.2`
2. Circuit proves: valid signature + nullifier unspent + ASP membership — all without revealing secret key
3. Pool contract verifies the intent proof in a single transaction
4. Demo: Agent A sends private payment to Agent B, both prove ASP membership, pool accepts
5. Proof generation time: <1s (signature verification + Merkle proofs — no Groth16)

## Constraints & Assumptions

**Technical constraints**:
- No Groth16 — signature verification + Merkle proofs only (fast)
- Reuse `contracts/asp-membership/` for ASP root management
- Reuse `contracts/pool/` for note commitments and nullifier set
- Starknet-style intent: `intent = hash(message, public_key, nonce)`
- Secret key never leaves agent's memory — only used for signing locally

**Assumptions**:
- ASP root is publicly known and auditable (compliance)
- Nullifier set root is on-chain (prevents double-spend)
- Intent message includes nonce to prevent replay
- Pool contract enforces balance conservation (input value = output value)

## Questions & Open Items

| Question | Status |
|----------|--------|
| Who maintains the ASP membership list? | **Open** — on-chain admin contract, or off-chain authority |
| How is the nullifier set updated? | **Open** — pool contract appends spent nullifiers to the set |
| What happens if intent is replayed? | **Mitigated** — nonce in intent message, pool contract rejects duplicates |
| Do we need a trusted setup? | **No** — Merkle proofs + signature verification = transparent |
| Can intent be cancelled/revoked? | **Open** — intent holds until nonce is used or expires |
| Privacy vs compliance tradeoff | **Solved by design** — ASP public, agent identity private |
