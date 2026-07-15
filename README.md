# PayMage

PayMage is a zero-knowledge payroll system for Stellar. It lets an employer
prove a payroll batch is valid without exposing individual salaries, then submit
the proof to Soroban contracts on testnet.

## Live Dashboard

- Production: https://paymage.vercel.app
- Network: Stellar Testnet

## Testnet Contracts

- Payroll contract: `CDSODUB6ZYOB5VZ4GV6MD2NAZ3RA3KZ73RVOBNZMFVXOO7CLLYWTUXNF`
- Payroll verifier: `CCSE6A4JH4KDWE63XMJ62LZBJTKJY4AEY3Q6FIACTKXZMNAX2NA7HRI6`
- Withdraw verifier: `CCARTGQLYGE2TCFFGPNC2B4IXUZJV4Y5QZWNHX4CXEREDLVIB3XYY5DH`
- Testnet token: `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC`

## Repository Layout

- `zk-payroll-dashboard/` - Next.js dashboard for wallet login, employee setup,
  payroll proof generation, and transaction submission.
- `contracts/payroll/` - Soroban payroll contract.
- `circuits/` - Circom payroll and withdrawal circuits.
- `app/crates/payroll-prover/` - Rust prover bindings.
- `e2e-tests/` - Native testnet proof and transaction test flows.
- `deployments/` - Stellar testnet deployment scripts and metadata.

## Dashboard Development

```bash
cd zk-payroll-dashboard
npm install
npm run dev
```

Useful checks:

```bash
cd zk-payroll-dashboard
npm run typecheck
npm test
```

Run the Playwright server-proof flow locally with a configured Stellar CLI admin
key:

```bash
cd zk-payroll-dashboard
E2E_STELLAR_SECRET_KEY=$(stellar keys show payroll-admin) \
  npm run test:e2e -- --project=chromium e2e/payroll-server-proof.spec.ts
```

## Real Testnet Proof Flow

Prerequisites:

- Stellar CLI configured with the `payroll-admin` identity.
- Circuit artifacts present under `testdata/` and `target/circuits-artifacts/`.

```bash
PAYROLL_CONTRACT=CDSODUB6ZYOB5VZ4GV6MD2NAZ3RA3KZ73RVOBNZMFVXOO7CLLYWTUXNF \
STELLAR_SOURCE=payroll-admin \
STELLAR_RECIPIENT=payroll-admin \
cargo run -p e2e-tests --bin testnet_payroll_e2e
```

## Deployment

The dashboard is linked to Vercel project `paymage-vercel-server-proof`.

```bash
cd zk-payroll-dashboard
vercel deploy . --prod --scope gadillacers-projects
```

Server-backed proof generation currently requires `PAYROLL_PROVER_URL` to point
at a running native prover service. The temporary tunnel-backed prover is useful
for demos, but should be replaced with durable HTTPS infrastructure before
calling the system production-ready.

