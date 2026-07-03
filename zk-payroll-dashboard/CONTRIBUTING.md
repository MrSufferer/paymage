# Contributing to ZK Payroll Dashboard

Thank you for your interest in contributing! This project is part of the **Stellar Wave Program**.

## Getting Started

```bash
git clone https://github.com/your-org/zk-payroll-dashboard.git
cd zk-payroll-dashboard
pnpm install
pnpm dev
```

## Development

```bash
pnpm dev          # Start dev server
pnpm build        # Build for production
pnpm lint         # Lint
pnpm test         # Run all unit tests
pnpm test:smoke   # Run smoke tests for critical user journeys
```

## Smoke Tests

The `__tests__/smoke/` directory contains automated tests covering the highest-value dashboard journeys:

- **Wallet Connection** — connect, disconnect, loading, and error states
- **Payroll Initiation** — summary cards, proof generation flow
- **Dashboard Status** — history table, status visibility

Run them with `pnpm test:smoke`. CI runs these automatically on every push and PR.

## Areas of Contribution

- **UI Components** — Reusable React components
- **Pages** — New pages and features
- **State Management** — Zustand stores
- **Wallet Integration** — Freighter, other wallets
- **Styling** — Tailwind, accessibility
- **Tests** — Component and E2E tests

## Issue Labels

| Label | Points |
|-------|--------|
| `good-first-issue` | 100 |
| `medium` | 150 |
| `high` | 200 |

## Code Standards

- TypeScript strict mode
- Server components where possible
- Accessible markup
- Mobile responsive

## License

MIT
