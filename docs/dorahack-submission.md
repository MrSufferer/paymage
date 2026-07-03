# DoraHack Project Submission — PayMage

Ready-to-paste fields for the DoraHack project page. Every fact below is sourced
from the `feature-zk-payroll` worktree (circuits, contracts, dashboard, testnet
deployment). Replace bracketed placeholders `[...]` with team-specific info.

---

## Project Name

PayMage

## One-Liner / Tagline

Privacy-first payroll on Stellar Soroban — pay teams in USDC where individual
salaries are hidden by zero-knowledge proofs and only the payroll total is public.

## Project Description (long)

PayMage lets an employer run a batch payroll on Stellar where the **total
payroll amount** is provably correct and on-chain verifiable, but **each
employee's individual salary stays hidden** behind a ZK commitment. Employees
later withdraw their salary with their own ZK proof, without revealing which
commitment is theirs.

The flow:

1. **Employee tree:** the employer registers employees as commitments
   `Poseidon2(employeeId, salaryAmount, salt)` in a Merkle tree and publishes the
   root to the `Payroll` smart contract.
2. **Run payroll:** the employer generates a Groth16 `PayrollBatch` proof that,
   for every committed employee, the salary is in range and belongs to the tree,
   and that the **sum of all salaries equals the public `totalPayrollAmount`**.
   The contract verifies the proof, checks the budget cap, escrows USDC into the
   contract, and records the period. Individual salaries never appear on-chain.
3. **Withdraw:** each employee generates a `PayrollWithdraw` proof showing they
   know the preimage of a commitment, the commitment is in the period's tree, and
   a nullifier is correctly derived. The contract checks the nullifier isn't
   already spent, marks it spent, and releases USDC to the employee — without
   revealing which employee drew down.

Optionally, the employer can grant an **auditor** an encrypted view key so a
compliance officer can decrypt salary blobs (stored as IPFS CIDs) without breaking
the on-chain privacy guarantees.

PayMage is built on top of Nethermind's privacy-pools reference implementation
for Stellar and reuses the Groth16 / BN254 verifier host functions available on
Soroban (Protocol 22+).

## Problem It Solves

On-chain payroll today leaks every employee's salary to the whole world. PayMage
keeps the single number a business actually needs public — *did the
company pay the right total* — while keeping *who got paid what* private and
auditable only to authorized parties.

## How It Works / Architecture

- **Circuits (Circom, Groth16, Poseidon2):**
  - `PayrollBatch(levels, n)` — proves each `salaryAmount ∈ [0, 2^50)`, each
    commitment is in the employee Merkle tree, and `Σ salaryAmount === totalPayrollAmount`.
    Public inputs: `[employeeRoot, totalPayrollAmount, payrollPeriodId]` (period id
    is monotonic to prevent replay).
  - `PayrollWithdraw(levels)` — proves knowledge of `(employeeId, salaryAmount,
    salt)`, recomputes `commitmentId` and a `nullifier`, verifies the Merkle proof,
    and constrains private salary to the public salary. Public inputs:
    `[commitmentRoot, commitmentId, nullifier, salaryAmount]`.
- **Smart contracts (Rust / Soroban / soroban-sdk):**
  - `Payroll` — admin (set employee root, budget cap, token, verifiers, auditor
    view keys), `run_payroll` (verify + budget check + USDC escrow + period
    record + commitment->IPFS-CID map), `withdraw` (employee self-service proof
    verification + nullifier double-spend guard + USDC payout). Proactive TTL
    extension on hot keys to avoid RestoreFootprint costs.
  - `CircomGroth16Verifier` — on-chain Groth16 verification using the BN254 host
    functions; two instances (one for batch, one for withdraw VKs).
  - USDC via the Stellar Asset Contract (SAC) `TokenClient`.
- **Prover (Rust → WASM):** `payroll-prover` and `poseidon-wasm` crates compile to
  WebAssembly, so proofs are generated **client-side in the browser** — no private
  inputs ever touch a server.
- **Dashboard (Next.js 14 App Router):** Freighter wallet, Zustand stores,
  `zkEngine` initializes `payroll.wasm` + verification key in-browser
  (`/public/zk/`), with a `MockZkEngine` fallback for dev. Payroll wizard steps:
  review → proof → confirm → submit. Pages: dashboard, employees, treasury,
  payroll/run, compliance (view keys), history, setup wizard.

## What's New / Original Contribution (vs. base repo)

The base `stellar-private-payments` repo implements privacy pools (deposit /
transfer / withdraw with ASP membership). PayMage adds a **payroll-specific
domain** on top:

- New `PayrollBatch` and `PayrollWithdraw` Circom circuits (range-checked salaries,
  sum conservation in batch, nullifier-based withdrawal).
- New `payroll` Soroban contract with budget cap, period counter, commitment→IPFS
  CID records, auditor encrypted-view-key registry, and double-withdraw
  nullifier tracking.
- New `payroll-prover` / `poseidon-wasm` crates to prove in the browser.
- New `zk-payroll-dashboard` Next.js frontend dedicated to the payroll flow
  (employee management, treasury, compliance view-key management, history).

## Technologies / Built With

- **Blockchain:** Stellar (Soroban smart contracts), Stellar Asset Contract (USDC)
- **ZK:** Circom 2.2.2, Groth16 over BN254, Poseidon2 (Horizen Labs impl), Circom
  Merkle proofs, Num2Bits range checks
- **Contracts:** Rust, soroban-sdk, on-chain BN254 host functions (Protocol 22+)
- **Prover:** native Rust → WebAssembly (browser proving)
- **Frontend:** Next.js 14 (App Router), TypeScript, Tailwind CSS, Lucide, Zustand
  (persist), Freighter wallet, stellar-sdk
- **Off-chain storage:** IPFS CIDs for encrypted salary blobs
- **Tooling:** Cargo workspaces, stellar-cli, Trusted Setup ceremony keys
  (`deployments/testnet/circuit_keys/`)

## Tracks / Bounty Categories (pick all that apply)

- Stellar / Soroban track
- Privacy / ZK track
- Best use of zero-knowledge proofs
- Best use of Stellar Asset Contract (USDC)
- Real-world / fintech use case

## Live Demo / Deployment

- **Network:** Stellar Testnet
- **Deployed contracts** (latest entry in `deployments/testnet/deployments.json`):
  - Deployer / Admin: `GBBTKIOKPCGILWKYJASL7LL3TSITQMOVTYOL3Q5KG3Y4L7KY4BIXXXJI`
  - Payroll contract: `CBN3XSKSAN3TFA7HHLQY3MRVU2WXY5MRY4AKIUDTMGQ2LAVKJUXGAPXU`
  - Payroll verifier: `CCH6JHAQLWARRXBYYSZMJ74IW2PBUGSYDCHAB455QZUE4LYVXDTFNCCV`
  - Withdraw verifier: `CCJQ4SZNN5DV7NN4KSFC4M6MFNBGPOXC6FBV6BHSJPUWIFGW4M6OQ73C`
  - USDC token (SAC): `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC`
  - Verification keys: `payroll_10_10` (batch) + `payrollWithdraw_10` (withdraw)
- **Circuit params deployed:** `PayrollBatch(10, 10)` — tree depth 10, batch size 10
- Dashboard repo: `github.com/paymage/zk-payroll-dashboard`
- Base protocol repo: https://github.com/NethermindEth/stellar-private-payments
- Demo URL: `[add hosted dashboard URL]`
- Demo video: `[add Loom/YouTube link]`

## Key Features (bullet list)

- Private batch payroll with on-chain sum verification
- Browser-side Groth16 proof generation (no private data leaves the client)
- ZK employee withdrawal with nullifier-based double-spend protection
- Budget cap enforcement per payroll period
- Merkle-root employee registry, updatable by admin
- Auditor compliance view: encrypted view-key grants + revocation
- Monotonic period IDs prevent replay attacks
- USDC escrow via Stellar Asset Contract

## Roadmap / Milestones

- Done: PayrollBatch + PayrollWithdraw circuits, Payroll contract, browser WASM
  prover, Next.js dashboard, testnet deployment, E2E proof→contract test.
- Next: trusted-setup scaling to larger batches (target 500 employees/batch per
  circuit design spec), IPFS pinning service integration for encrypted salary
  blobs, mainnet security audit.
- Later: full amount privacy (range-proven hidden amounts instead of public
  `salaryAmount` on withdraw), multi-asset payroll, scheduled/recurring payroll,
  ASP-style compliance set integration.

## Challenges We Ran Into

- BN254 scalar-field overflow handling: salaries range-checked to `< 2^50` to stay
  safely below the BN254 scalar field while still covering all realistic USDC
  amounts (up to ~100M USDC in stroops).
- Proof period-id had to be carried as a BN254 field element and converted to u64
  in-contract with non-canonical rejection, since the verifier only sees field
  elements.
- Soroban storage TTL: hot-path keys need proactive `extend_ttl` to avoid
  expensive `RestoreFootprint` for archived payroll periods.
- Browser proving performance and WASM artifact loading in Next.js (asyncWebAssembly
  + standalone output config).

## Accomplishments We're Proud Of

- Real Groth16 proofs generated in the browser, verified on-chain by a Soroban
  contract (not mocked) — confirmed by the native-Rust E2E test that runs the
  same prover the browser WASM wraps.
- Salary amounts hidden at deposit/run-time while withdrawal provably cannot
  double-spend.
- Compliance layer (auditor encrypted view keys) without sacrificing on-chain
  privacy.

## What We Learned

- Designing ZK circuits where public inputs must match what a Soroban contract can
  cheaply validate (field-element ↔ u64/u128 ↔ U256 conversions are the tricky
  boundary).
- The trade-off that `salaryAmount` is public on withdrawal (needed for the USDC
  transfer) — and the design note in the circuit showing the confidential-transfer
  upgrade path for future full amount privacy.

## Team

- `[Team lead name / role]` — `[GitHub / handle]`
- `[Member 2]` — `[role / handle]`
- `[Member 3]` — `[role / handle]`

## Useful Links

- Base protocol (privacy pools on Stellar): https://github.com/NethermindEth/stellar-private-payments
- Dashboard repo: https://github.com/paymage/zk-payroll-dashboard
- Stellar Soroban docs: https://soroban.stellar.org/docs
- Circom: https://docs.circom.io
- Poseidon2 (Horizen Labs): https://github.com/HorizenLabs/poseidon2

## Status / Disclosure

Work in progress and not audited — reference implementation of private payroll on
Stellar (PayMage). Do not use with real assets in production yet. The content of
this submission may have been refined/augmented with LLM assistance and reviewed
by the team.