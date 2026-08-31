---
title: Dev review: zk-payroll submission readiness
feature: zk-payroll
date: 2026-08-31
branch: fix/security-audit
---

# Phase 9 review: submission readiness

## Outcome

The original submission work is merged into `main`. This follow-up branch
addresses the failed Rust dependency audit and tightens the README and evidence
before the security fix is merged.

The README now follows a reviewer-oriented structure: project purpose, quick
start, usage, architecture, submission checklist, deployment evidence,
screenshots, testing, lifecycle documents, and limitations. It does not repeat
the hackathon requirement mapping.

## Findings addressed

- **Dependency audit:** Updated `Cargo.lock` to patched releases for
  `anyhow`, `crossbeam-epoch`, `h2`, `rkyv`, `rkyv_derive`, and `spin`.
- **README surface:** Added the live demo, video, contract addresses,
  interaction hashes, quick start, architecture, testing commands, lifecycle
  pointer, and explicit security limitations.
- **Mobile evidence:** Replaced the stale mobile image with a 390 × 844
  dashboard History view and added a second image with the mobile drawer open.
  The drawer visibly includes Employees, Execute Payroll, and History.
- **CI evidence:** Added a passing dependency-audit screenshot next to the
  dashboard test workflow screenshot.
- **PR communication:** Replaced the terse pull request body with a summary,
  change list, verification evidence, and scope notes.

The earlier merged work remains responsible for the lifecycle-doc migration,
CI build fixes, dashboard event polling, and mobile navigation implementation.

## Security audit root cause

The `security_audit` job failed on the first `main` run because the lockfile
contained an affected `rkyv` release and a yanked `spin` release. The local
RustSec database also identified newer patched releases for `anyhow`,
`crossbeam-epoch`, and `h2`.

The lockfile now resolves `anyhow 1.0.104`, `crossbeam-epoch 0.9.20`, `h2 0.4.19`, `rkyv 0.8.17`, `rkyv_derive 0.8.17`, and `spin 0.9.9`.

## Evidence

- `cargo deny check` with cargo-deny `0.18.9`: advisories, bans, licenses, and
  sources passed locally.
- `cargo test -p payroll`: 21 passed, 0 failed.
- `cd zk-payroll-dashboard && npm test`: 21 test files passed, 78 tests passed.
- `cd zk-payroll-dashboard && npm run typecheck`: passed.
- `git diff --check`: passed.
- [Dashboard Actions run 33378719505](https://github.com/MrSufferer/paymage/actions/runs/33378719505): passed on `main`.
- [Dependency audit run 33379942151](https://github.com/MrSufferer/paymage/actions/runs/33379942151): passed on `fix/security-audit`.
- Screenshots were visually checked after capture:
  [`mobile-ui.png`](../../screenshots/mobile-ui.png),
  [`mobile-nav-open.png`](../../screenshots/mobile-nav-open.png),
  [`tests-passing.png`](../../screenshots/tests-passing.png),
  [`ci-pipeline.png`](../../screenshots/ci-pipeline.png), and
  [`ci-security-audit.png`](../../screenshots/ci-security-audit.png).

## Deliberate scope

Proving keys remain gitignored. Miri, coverage, full ignored circuit tests, and
GitHub Pages remain outside this submission path. The Vercel demo remains the
deployed frontend. The security-fix pull request must complete its fresh checks
before it is merged into `main`.
