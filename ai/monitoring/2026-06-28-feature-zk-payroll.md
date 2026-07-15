---
phase: monitoring
title: Monitoring & Observability
description: Production observability plan for PayMage payroll runs and compliance flows
date-updated: 2026-07-14
---

# Monitoring & Observability

## Current State

The native testnet payroll path has transaction evidence, but there is no
production monitoring stack yet. Production readiness requires observability for
four surfaces:

- Browser proof generation and wallet submission.
- Soroban contract state and events.
- Off-chain services: KYC, anchor, IPFS, keeper, indexer.
- Compliance and finance operations: payroll status, withdrawals, reconciliation.

## Signals

### Payroll Contract

Track contract calls and events:

- `set_employee_root`
- `set_budget_cap`
- `run_payroll`
- `set_withdraw_verifier`
- `withdraw`
- `set_view_key_for_auditor`
- `revoke_auditor`
- `PayrollVerifiedEvent`
- `WithdrawalEvent`
- `AuditorGrantedEvent`
- `AuditorRevokedEvent`

Core metrics:

- payroll runs submitted, confirmed, failed
- withdrawal submissions, confirmations, failures
- duplicate nullifier rejection count
- proof verification failure count
- budget exceeded rejection count
- current period per payroll contract
- escrow balance versus expected remaining payable amount
- time from proof generated to transaction confirmed

### Browser

Collect privacy-safe client telemetry:

- proof artifact load success/failure
- proving duration by circuit
- wallet connect/sign/submit success and failure
- browser memory pressure during proving
- IPFS upload/fetch/decrypt success and failure

Do not log:

- employee IDs
- salary amounts
- salts
- witness inputs
- private keys
- decrypted salary blobs
- KYC documents or applicant payloads

### Off-Chain Services

For KYC:

- applicant created
- applicant approved/rejected/manual-review
- webhook verification failures
- wallet-to-KYC binding changes
- sanctions screening failure count

For fiat/anchor:

- SEP-24 deposit started/completed/failed
- SEP-31 send started/completed/failed
- employer USDC funding confirmed
- employee cash-out confirmed
- reconciliation mismatch count

For IPFS:

- pin success/failure
- CID availability check latency
- gateway fallback count
- decrypt failure count

For keeper automation:

- schedule due
- proof decrypted
- expected period fetched
- period mismatch skipped
- transaction submitted
- transaction confirmed
- retry exhausted

## Alerts

Critical alerts:

- `run_payroll` failure after employer confirmation.
- withdrawal failure after proof verification begins.
- escrow balance lower than expected outstanding withdrawals.
- duplicate nullifier accepted. This should be impossible; treat as incident.
- KYC webhook signature verification failure spike.
- keeper submits to a contract ID not in the active deployment manifest.
- proof verification failure spike after deployment.

Warning alerts:

- IPFS CID unavailable from all configured gateways.
- browser proof generation p95 exceeds target.
- RPC error rate above threshold.
- XLM fee wallet below minimum balance.
- anchor deposit/cash-out pending beyond SLA.
- current period mismatch between backend projection and contract query.

## Dashboards

### Operator Dashboard

- active deployment IDs and VK hashes
- current payroll period
- latest payroll runs and transaction hashes
- failed transaction queue
- escrow balance and expected outstanding withdrawal total
- keeper status and next scheduled runs

### Compliance Dashboard

- KYC/KYB status counts
- sanctions/manual-review queue
- auditor grants and revocations
- audit export generation status
- PII redaction checks

### Reliability Dashboard

- RPC latency/error rate
- proof generation latency by circuit
- IPFS pin/fetch latency
- webhook processing latency
- background job success/failure rate

## Logging Policy

Use structured logs with `trace_id`, `environment`, `contract_id`,
`operation`, `period_id`, `tx_hash`, and `result`.

Never log private payroll material:

- salary preimages
- salts
- employee identity payloads
- KYC documents
- view-key plaintext
- decrypted IPFS blobs
- wallet seed phrases or secret keys

Logs may include public on-chain values:

- contract ID
- transaction hash
- payroll period ID
- commitment root
- total payroll amount
- nullifier
- public withdrawal amount

The public withdrawal amount is a known privacy trade-off in v1. It should be
described in product and grant materials so reviewers do not infer full amount
privacy.

## Incident Response

Severity 1:

- funds stuck or lost
- wrong contract IDs in production frontend
- duplicate nullifier accepted
- private material leaked
- KYC/sanctions bypass

Immediate actions:

1. Disable frontend write actions.
2. Disable keeper automation.
3. Snapshot deployment manifest, logs, contract state, and transaction hashes.
4. Verify escrow and token balances directly against Stellar RPC.
5. Publish operator guidance for affected payroll periods.
6. Deploy patched contracts only after root cause is understood.

Severity 2:

- proof generation outage
- IPFS retrieval outage with no data leak
- anchor/KYC provider outage
- monitor/indexer lag

Actions:

1. Keep contract writes disabled only for impacted flow.
2. Retry with fallback provider/gateway where configured.
3. Notify affected employers and employees.
4. Backfill projections after recovery.

## Production Readiness Gates

Before a real pilot:

- Browser payroll, withdraw, and auditor flows pass against testnet.
- Monitoring receives events for a full KYC to funding to payroll to withdraw
  cycle.
- Operator can reconcile contract escrow balance to expected outstanding pay.
- PII redaction audit passes.
- Secrets are stored outside the repo and rotated once in staging.
- Runbook is tested by a second operator.
- Security review covers circuits, verifier wiring, payroll contract, browser
  proof handling, and off-chain custody boundaries.
