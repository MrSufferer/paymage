---
phase: implementation
title: Implementation Guide
description: Agent-custodial ZK privacy pool via x402 protocol on Stellar
---

# Implementation Guide

## Development Setup

**Prerequisites**:
- Node.js 22+, pnpm 10+
- Rust 1.92.0+, `wasm-pack`, `wasm32-unknown-unknown` target
- Stellar CLI (`stellar` command)
- `@trionlabs/8004-sdk` (from npm)
- x402-stellar facilitator running on testnet

**Environment variables**:
```
AGENT_STELLAR_SECRET_KEY=S...        # Agent's keypair (used for 8004 + pool txs)
AGENT_FEE_BASIS_POINTS=100           # 1% fee
STELLAR_NETWORK=testnet              # testnet or mainnet
STELLAR_RPC_URL=https://soroban-testnet.stellar.org
FACILITATOR_URL=http://localhost:8080
FACILITATOR_API_KEY=...
POOL_CONTRACT_ID=...                 # Deployed pool contract
TOKEN_CONTRACT_ID=...                # Token the pool accepts
AGENT_DATA_DIR=./agent-data          # SQLite db + state
```

## Code Structure

```
x402-agent-privacy-pool/
agent/
  src/
    index.ts              # Entry point, Express app setup
    config.ts             # Env var loading + validation
    note-store/
      schema.sql          # SQLite schema
      index.ts            # NoteStore class
      types.ts            # Note, AgentState interfaces
    prover/
      index.ts            # ProverService wrapping WASM
      wasm-module.ts      # WASM loader
    flows/
      deposit.ts          # DepositFlow
      withdraw.ts         # WithdrawFlow
      transfer.ts         # TransferFlow (internal mixing)
    stellar/
      rpc.ts              # Stellar RPC subscription client
      tx.ts               # Transaction submission helpers
    eight-thousand/
      index.ts            # Stellar 8004 registration via SDK
    api/
      routes.ts           # Admin API routes
    middleware/
      auth.ts             # Agent key auth for admin routes
      error.ts            # Error handling middleware
  test/
    note-store.test.ts
    prover.test.ts
    deposit.test.ts
    ...
  package.json
  tsconfig.json
```

## Core Features

### Note Generation
```typescript
// src/note-store/index.ts
function generateNoteSecret(): Uint8Array {
  // 32 bytes from crypto.getRandomValues
}
function computeCommitment(secret: Uint8Array, value: bigint, agentId: string): Uint8Array {
  // Poseidon2(secret, value, agentId) — uses prover's poseidon implementation
}
function computeNullifier(secret: Uint8Array): Uint8Array {
  // Poseidon2(secret) — uses prover's poseidon implementation
}
```

### Prover Integration
```typescript
// src/prover/index.ts
import init, { Prover } from '@stellar-private-payments/prover';

const prover = await init(); // Loads WASM module

async function generateDepositProof(
  noteSecret: Uint8Array,
  value: bigint,
  agentId: string,
  merkleProof: MerkleProof,
  treeRoot: Uint8Array
): Promise<Proof> {
  return prover.generate_deposit_proof(noteSecret, value, agentId, merkleProof, treeRoot);
}
```

### Deposit Flow
```typescript
// src/flows/deposit.ts
async function depositToPool(amount: bigint, fee: bigint): Promise<Note> {
  // 1. Generate note secret + commitment
  const secret = generateNoteSecret();
  const commitment = computeCommitment(secret, amount, agentId);
  const nullifier = computeNullifier(secret);

  // 2. Get current pool root + merkle proof
  const treeRoot = await poolContract.getLatestRoot();
  const merkleProof = await noteStore.getMerkleProof(commitment);

  // 3. Generate deposit proof via WASM
  const proof = await prover.generate_deposit_proof(secret, amount, agentId, merkleProof, treeRoot);

  // 4. Build + submit transact tx
  const extData = buildExtData({ recipient: agentAddress, extAmount: amount });
  await submitTransact(proof, extData);

  // 5. Persist note (after tx confirmed)
  return noteStore.createNote({ secret, commitment, nullifier, value: amount - fee });
}
```

### Pool Contract Invocation
```typescript
// src/stellar/tx.ts
import { Contract, Keypair, Networks, TransactionBuilder, Operation } from 'stellar-sdk';

async function submitTransact(proof: Proof, extData: ExtData): Promise<void> {
  const contract = new Contract(POOL_CONTRACT_ID);
  const tx = new TransactionBuilder(keypair.account(), { fee: '100000', networkPassphrase: Networks.TESTNET })
    .addOperation(contract.call('transact', proof, extData, keypair.publicKey()))
    .setTimeout(30)
    .build();
  tx.sign(keypair);
  await stellarServer.submitTransaction(tx);
}
```

## Integration Points

### Stellar 8004
```typescript
// src/eight-thousand/index.ts
import { IdentityClient } from '@trionlabs/8004-sdk';

const identity = new IdentityClient({
  network: Networks.TESTNET,
  keypair: agentKeypair,
});

async function registerAgent(): Promise<string> {
  const { agentId } = await identity.register({
    name: 'Privacy Pool Agent',
    agentURI: 'https://my-agent.example.com/agent.json',
  });
  return agentId; // Minted as NFT on Identity Registry contract
}
```

### Stellar RPC Subscription
```typescript
// src/stellar/rpc.ts
import { stellarServer } from './client';

async function subscribeToPayments(agentAddress: string, onPayment: (tx: Transaction) => void) {
  const cursor = 'now';
  await stellarServer.transactions().forAccount(agentAddress).cursor(cursor).stream({
    onmessage: (tx) => {
      if (tx.kind === 'payment' && tx.account === agentAddress) {
        onPayment(tx);
      }
    },
    onerror: (e) => console.error('Stream error:', e),
  });
}
```

## Error Handling

- **Pool tx fails**: Note not persisted to note store (atomic). Log error, retry with backoff.
- **Proof generation fails**: Log circuit error, do not submit invalid proof
- **Duplicate payment**: Check `processed_payments` table before processing. Skip if exists.
- **WASM load failure**: Fail fast at startup with clear error message
- **8004 registration fails**: Retry 3x with exponential backoff, then continue without (v1 can operate without 8004)

## Performance Considerations

- ZK proof generation: <5s target. WASM single-threaded for now.
- Note store: SQLite with indexes on `commitment`, `nullifier`, `spent`
- RPC subscription: single stream per agent instance
- Parallel deposit batching: if multiple payments arrive before proof completes, queue them

## Security Notes

- **Note secrets**: Stored in SQLite. Production: enable SQLCipher or export encrypted backup
- **Agent secret key**: In env var only. Never logged or transmitted.
- **Idempotency**: `processed_payments.tx_hash` is the dedup key — prevents double-processing
- **Circuit correctness**: Agent ID bound into commitment — agent cannot spend another agent's notes
- **Authorization**: `sender.require_auth()` in pool contract ensures only agent can submit notes