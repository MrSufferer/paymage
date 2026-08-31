# PayMage

Privacy-first payroll on Stellar Soroban: employers prove a payroll batch is
valid without exposing individual salaries, then employees withdraw through
zero-knowledge proofs.

- **Live demo:** [paymage.vercel.app](https://paymage.vercel.app)
- **Demo video:** [Watch the PayMage walkthrough](https://youtu.be/1mcte2MPRvc)
- **Public repository:** [github.com/MrSufferer/paymage](https://github.com/MrSufferer/paymage)
- **Network:** Stellar Testnet

## Hackathon requirements

1. **Advanced smart contracts** — `contracts/payroll/` implements Groth16
   verification, budget caps, nullifiers, and storage TTL handling.
2. **Inter-contract communication** — the payroll contract calls the Circom
   Groth16 verifier and the Stellar Asset Contract through `TokenClient`.
3. **Event streaming and real-time updates** — contract events are declared in
   `contracts/payroll/`; the dashboard polls `getEvents` in
   [`lib/stellar/events.ts`](zk-payroll-dashboard/lib/stellar/events.ts) via
   [`usePayrollEvents`](zk-payroll-dashboard/hooks/usePayrollEvents.ts) and
   renders them in History.
4. **CI/CD** — GitHub Actions runs Rust checks/builds and the dashboard
   typecheck/tests in [`.github/workflows/`](.github/workflows/).
5. **Deployment workflow** — the testnet deployment script and recorded
   addresses live in [`deployments/scripts/deploy-payroll.sh`](deployments/scripts/deploy-payroll.sh)
   and [`deployments/testnet/deployments.json`](deployments/testnet/deployments.json).
6. **Mobile frontend** — responsive Tailwind layouts plus an accessible mobile
   navigation drawer in [`DashboardLayout.tsx`](zk-payroll-dashboard/components/layout/DashboardLayout.tsx),
   [`Header.tsx`](zk-payroll-dashboard/components/layout/Header.tsx), and
   [`Sidebar.tsx`](zk-payroll-dashboard/components/layout/Sidebar.tsx).
7. **Error and loading states** — [`app/loading.tsx`](zk-payroll-dashboard/app/loading.tsx),
   [`app/error.tsx`](zk-payroll-dashboard/app/error.tsx), `WalletErrorOverlay`,
   and the payroll wizard proof states cover asynchronous and failure paths.
8. **Tests** — Rust payroll tests are in [`contracts/payroll/`](contracts/payroll/);
   the dashboard has Vitest and Playwright coverage in
   [`zk-payroll-dashboard/`](zk-payroll-dashboard/).
9. **Architecture** — the repository separates Circom circuits, Soroban
   contracts, Rust/WASM proving crates, and the Next.js dashboard.
10. **Documentation and demo** — lifecycle evidence is under [`docs/ai/`](docs/ai/),
    the submission narrative is [`docs/dorahack-submission.md`](docs/dorahack-submission.md),
    and the walkthrough is linked above.

## Submission checklist

- [x] [Public GitHub repository](https://github.com/MrSufferer/paymage)
- [x] [Live demo](https://paymage.vercel.app)
- [x] [Demo video](https://youtu.be/1mcte2MPRvc)
- [x] Testnet contract deployment addresses listed below
- [x] Contract interaction transaction hashes listed below
- [x] [Mobile responsive UI screenshot](docs/screenshots/mobile-ui.png)
- [x] [CI/CD pipeline screenshot](docs/screenshots/ci-pipeline.png)
- [x] [Test output with 3+ passing tests](docs/screenshots/tests-passing.png)
- [x] [DoraHack submission details](docs/dorahack-submission.md)

## Architecture

```text
circuits/                         Circom payroll and withdrawal circuits
contracts/payroll/                Soroban payroll contract and tests
app/crates/payroll-prover/        Native/WASM proving bindings
app/crates/poseidon-wasm/         Browser Poseidon2 primitives
zk-payroll-dashboard/             Next.js dashboard, wallet, events, and UI
deployments/                      Testnet deployment scripts and metadata
docs/ai/                          Lifecycle requirements, design, and evidence
```

The employer commits employees into a Merkle tree, proves the batch sum, and
escrows USDC. The contract verifies the proof and records an event. An employee
later proves membership and a nullifier to withdraw without exposing the
corresponding commitment.

## Testnet contracts and interactions

| Component | Address |
| --- | --- |
| Payroll contract | `CDSODUB6ZYOB5VZ4GV6MD2NAZ3RA3KZ73RVOBNZMFVXOO7CLLYWTUXNF` |
| Payroll verifier | `CCSE6A4JH4KDWE63XMJ62LZBJTKJY4AEY3Q6FIACTKXZMNAX2NA7HRI6` |
| Withdraw verifier | `CCARTGQLYGE2TCFFGPNC2B4IXUZJV4Y5QZWNHX4CXEREDLVIB3XYY5DH` |
| Token SAC | `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC` |

Recorded testnet interactions:

- [`run_payroll`](https://stellar.expert/explorer/testnet/tx/a27afe6f0bd9ef54cb3dc81658d3965b8e7d8e9f7b8a21e7146941e0cec60993)
- [`withdraw`](https://stellar.expert/explorer/testnet/tx/a511f27bc833e32e6ce252d5ac83b7695ca189207114a6698a5737de5ee68ddb)

## Screenshots

- [Mobile UI](docs/screenshots/mobile-ui.png)
- [Tests passing](docs/screenshots/tests-passing.png)
- [CI pipeline](docs/screenshots/ci-pipeline.png)

## Development and verification

```bash
cd zk-payroll-dashboard
npm ci
npm run dev
npm run typecheck
npm test
```

Rust payroll checks and dependency lint:

```bash
cargo test -p payroll
cargo shear
```

The testnet deployment script is [`deploy-payroll.sh`](deployments/scripts/deploy-payroll.sh).
Browser/server-proof demos require `PAYROLL_PROVER_URL` to point at a running
prover service.

## Lifecycle documents

The canonical feature documents are grouped under
[`docs/ai/requirements/`](docs/ai/requirements/),
[`docs/ai/design/`](docs/ai/design/),
[`docs/ai/planning/`](docs/ai/planning/),
[`docs/ai/implementation/`](docs/ai/implementation/),
[`docs/ai/testing/`](docs/ai/testing/), and
[`docs/ai/review/`](docs/ai/review/).

## Status and caveats

- Testnet reference implementation; not audited and not for production assets.
- `salaryAmount` is a public circuit input during withdrawal; this is a known
  privacy trade-off in the current design.
- `PAYROLL_PROVER_URL` is demo infrastructure, not a production prover
  hosting guarantee.
- Large proving keys are intentionally gitignored and are not committed.
