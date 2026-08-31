---
title: Dev Review — zk-payroll submission readiness
feature: zk-payroll
date: 2026-08-31
branch: feature/hackathon-submission
---

# Phase 9 review: submission readiness

## Outcome

The PayMage submission surface is complete on `feature/hackathon-submission`.
The public README now maps the hackathon requirements to the repository, links
the live demo and video, records the testnet interactions, and includes the
three requested screenshots. The branch contains more than ten meaningful
commits and is ready to merge into `main` after the final remote checks.

## Findings addressed

- **README surface:** Added the ten requirement mappings, submission checklist,
  live demo and video links, contract addresses, `run_payroll` and `withdraw`
  transaction links, architecture, commands, screenshots, lifecycle pointer,
  and testnet/unaudited caveats.
- **Commit history:** Split the work into documentation, dependency, build,
  CI, test isolation, frontend/event, lockfile, screenshot, and review commits.
- **Lifecycle docs:** Moved the feature records and archive from root `ai/`
  into canonical `docs/ai/` locations. The root `ai/` tree is no longer used.
- **CI blockers:** Removed cargo-shear-confirmed unused direct dependencies,
  made the web build tolerate absent gitignored proving keys while retaining
  runtime warnings, added the payroll contract to contract builds, stopped the
  broken GitHub Pages workflow from running on pushes, and added dashboard
  typecheck/Vitest CI.
- **Mobile navigation:** Added an accessible hamburger button and mobile
  drawer using the existing route list, with Escape, overlay, and navigation
  close behavior.
- **Event streaming:** Added a Soroban RPC `getEvents` poller for
  `PayrollVerifiedEvent` and `WithdrawalEvent`; History renders live events and
  retains mock transactions only as an empty-state fallback.
- **Security/product caveats:** Documented the public withdrawal
  `salaryAmount`, demo-only `PAYROLL_PROVER_URL`, testnet/unaudited status, and
  intentionally uncommitted proving keys.

## Evidence

- `npx ai-devkit@latest lint`: all base structure checks passed.
- `npx ai-devkit@latest lint --feature zk-payroll`: all seven feature lifecycle
  documents were found and passed. The only remaining report is the missing
  `feature-zk-payroll` branch, which is a worktree convention intentionally
  excluded from this submission.
- `cd zk-payroll-dashboard && npm test`: 21 test files passed, 78 tests passed.
- `cd zk-payroll-dashboard && npm run typecheck`: passed.
- `cargo test -p payroll`: 21 passed, 0 failed.
- `cargo shear`: completed without errors; it emitted only the repository's
  existing workspace/doctest warnings.
- Dashboard GitHub Actions run: [33370577868](https://github.com/MrSufferer/paymage/actions/runs/33370577868)
  passed typecheck and tests on `feature/hackathon-submission`.
- Screenshots were visually checked after capture:
  [`mobile-ui.png`](../../screenshots/mobile-ui.png),
  [`tests-passing.png`](../../screenshots/tests-passing.png), and
  [`ci-pipeline.png`](../../screenshots/ci-pipeline.png).

## Deliberate scope

Proving keys remain gitignored. Miri, coverage, full ignored circuit tests, and
GitHub Pages were not made part of this submission path. The Vercel demo remains
the deployed frontend.
