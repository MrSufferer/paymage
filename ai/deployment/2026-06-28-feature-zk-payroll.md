---
phase: deployment
title: Deployment Strategy
description: Production deployment plan for PayMage ZK payroll on Stellar
date-updated: 2026-07-14
---

# Deployment Strategy

## Current State

PayMage has a real Stellar testnet payroll deployment and repeatable native E2E
path. The production app is not mainnet-ready yet. The credible grant posture is:

- **Built now**: Circom payroll and withdraw circuits, Soroban payroll contract,
  two Groth16 verifier deployments, testnet E2E payroll + withdraw.
- **Needs productization**: browser payroll run, browser employee withdraw,
  auditor IPFS decrypt flow, KYC/fiat rails, staging deployment, monitoring,
  security review, and mainnet ceremony artifacts.

Latest testnet deployment is recorded in
`deployments/testnet/deployments.json`:

- Payroll: `CDSODUB6ZYOB5VZ4GV6MD2NAZ3RA3KZ73RVOBNZMFVXOO7CLLYWTUXNF`
- Payroll verifier: `CCSE6A4JH4KDWE63XMJ62LZBJTKJY4AEY3Q6FIACTKXZMNAX2NA7HRI6`
- Withdraw verifier: `CCARTGQLYGE2TCFFGPNC2B4IXUZJV4Y5QZWNHX4CXEREDLVIB3XYY5DH`
- Testnet token: `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC`
- VK set: `payroll_10_10 + payrollWithdraw_10`

## Environments

### Local

Purpose: circuit iteration, contract tests, local witness/proof generation.

Required checks:

```bash
npx ai-devkit@latest lint
cargo test -p payroll
BUILD_TESTS=1 cargo test -p circuits -- --ignored
cargo test -p e2e-tests e2e_payroll
```

Circuit key regeneration is explicit:

```bash
BUILD_TESTS=1 REGEN_KEYS=1 ONLY_KEY_CIRCUITS=payroll_10_10,payrollWithdraw_10 cargo build -p circuits
```

### Testnet

Purpose: public grant demo and integration proving.

Deployment command:

```bash
deployments/scripts/deploy-payroll.sh testnet \
  --deployer payroll-admin \
  --token CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC \
  --budget-cap 100000000000
```

Post-deploy E2E:

```bash
PAYROLL_CONTRACT=<payroll-contract-id> \
STELLAR_SOURCE=payroll-admin \
STELLAR_RECIPIENT=payroll-admin \
cargo run -p e2e-tests --bin testnet_payroll_e2e
```

### Staging

Purpose: production-like rehearsal before any real payroll pilot.

Current server-proof preview:

- Preview: https://paymage-vercel-server-proof-hmubvs0jb-gadillacers-projects.vercel.app
- Inspect: https://vercel.com/gadillacers-projects/paymage-vercel-server-proof/FospgvkWfE6pYwUvbYmvkUB8rr8U
- Mode: `NEXT_PUBLIC_ZK_ENGINE=server`
- Temporary prover tunnel: `https://2b500c89e5433b25-27-79-42-120.serveousercontent.com`
- Local runtime: detached `screen` sessions `payroll-prover-8788` and `payroll-serveo-8788`

Staging must use:

- Dedicated Stellar testnet or futurenet deployer identity.
- Separate admin address from deployer.
- Separate IPFS pinning project.
- Separate KYC/anchor sandbox credentials.
- Production-like hosted frontend with no local artifact assumptions.
- `NEXT_PUBLIC_ZK_ENGINE=server` plus server-only `PAYROLL_PROVER_URL`
  pointing at a native payroll prover service for testnet real-proof runs.
- Monitoring and alerting enabled before pilot users touch the app.

Staging exit criteria:

- Browser employer payroll run succeeds end-to-end on testnet.
- Browser employee withdraw succeeds end-to-end on testnet.
- Auditor view key is granted, fetched, and used to decrypt one IPFS blob.
- No PII appears in contract storage, events, proof public inputs, logs, or URLs.
- Deployer/admin/key rotation runbook tested once.

### Production/Mainnet

Production is blocked until:

- Mainnet supports the required BN254 host functions for verifier contracts.
- Mainnet verification keys come from a real multi-party Phase 2 ceremony, not
  dev/test generated artifacts.
- Contract audit or external security review is complete.
- KYC/KYB, sanctions, and anchor partner legal flows are approved.
- Incident response, rollback, monitoring, and data retention policies are live.

## Release Pipeline

1. Freeze feature branch and verify clean Git state.
2. Run AI docs lint and feature lint.
3. Run contract, circuit, and E2E tests.
4. Build optimized Stellar WASM artifacts.
5. Record artifact hashes:
   - payroll contract WASM
   - verifier WASM with payroll VK
   - verifier WASM with withdraw VK
   - `payroll_10_10` VK
   - `payrollWithdraw_10` VK
6. Deploy verifiers first, then payroll, then call `set_withdraw_verifier`.
7. Append deployment JSON to the environment deployment manifest.
8. Run post-deploy native E2E.
9. Run browser smoke path against the deployed contracts.
10. Publish testnet transaction evidence in the grant/demo docs.

## Configuration

Public frontend configuration may include:

- `NEXT_PUBLIC_PAYROLL_CONTRACT`
- `NEXT_PUBLIC_VERIFIER_CONTRACT`
- `NEXT_PUBLIC_WITHDRAW_VERIFIER_CONTRACT`
- `NEXT_PUBLIC_STELLAR_NETWORK`
- `NEXT_PUBLIC_STELLAR_RPC_URL`
- `NEXT_PUBLIC_IPFS_GATEWAY_URL`

Server-only configuration must never ship to browser bundles:

- Stellar deployer/admin secret keys.
- KYC provider API keys and webhook signing secrets.
- Anchor credentials.
- IPFS pinning write tokens.
- Native payroll prover URL bearer tokens.
- Payroll keeper signing key.
- Auditor private view keys.

## Custody And Compliance Boundaries

PayMage should keep payroll privacy and compliance boundaries explicit:

- Employer funds remain in the employer wallet until `run_payroll()` transfers
  proof-bound total USDC into the payroll contract escrow.
- Employee withdrawals transfer from contract escrow to the recipient address
  authorized by the withdrawal transaction.
- PayMage should not custody employee private keys or auditor private view keys.
- KYC/KYB data stays off-chain with the provider/backend. The chain stores only
  roots, commitments, nullifiers, CIDs, totals, and view-key ciphertext.
- The current withdrawal design makes `salaryAmount` public during withdrawal.
  Identity remains hidden by the ZK proof, but amount privacy is not complete.

## Rollback

Soroban contract code is immutable for this deployment model. Rollback means:

1. Pause frontend writes to the affected contract.
2. Disable keeper automation for the affected environment.
3. Deploy fresh verifier and payroll contracts.
4. Repoint frontend public contract IDs.
5. Preserve the old deployment manifest and transaction evidence for audit.
6. Communicate which payroll periods live on the old contract and how users
   withdraw remaining escrow, if any.

No production payroll run should proceed without an operator checklist confirming
current contract IDs, expected period ID, budget cap, employee root, and verifier
VK hashes.
