# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ZK Payroll Dashboard — privacy-first payroll on Stellar Soroban using zero-knowledge proofs. Users connect Freighter wallet, manage employees, and execute batch payroll transactions where salary amounts are hidden via ZK commitments.

## Key Commands

```bash
npm run dev          # Start dev server (http://localhost:3000)
npm run build        # Production build
npm run lint         # ESLint
npm run typecheck    # TypeScript check
npm run test         # All tests
npm run test:smoke   # Smoke tests only (wallet, payroll initiation, dashboard status)
npm run test:watch   # Watch mode
npm run test:coverage # With coverage
```

## Architecture

### Wallet Integration
- `StellarProvider` (components/providers/StellarProvider.tsx) — wraps app, handles Freighter connection, network sync, transaction signing, and Soroban contract invocations
- `useStellar()` hook — access wallet connect/disconnect/signTx/invokeContract
- `walletStore` (stores/walletStore.ts) — persisted wallet state via Zustand (publicKey, network, isConnected)
- Supported networks: TESTNET, PUBLIC, FUTURENET
- Wallet polls every 2s for address/network changes

### ZK Proof System
- `zkEngine` (lib/zk/engine.ts) — singleton, browser-only initialization of circuit WASM + verification key
- Falls back to `MockZkEngine` when artifacts missing (dev mode)
- `generatePayrollProof()` produces proof + public inputs + Soroban args
- `verifyProof()` validates on-chain

### State Management
- Zustand stores with `persist` middleware (localStorage)
- `walletStore` — wallet connection state
- `payrollWizardStore` — multi-step payroll flow state (review → proof → confirm → submit)
- `employeesStore` — employee list and management
- `companyStore` — company configuration
- `viewKeysStore` — compliance view key management

### Middleware Security
- `middleware.ts` applies CSP, security headers, session verification
- Protected routes: /dashboard, /payroll, /employees, /settings
- Public routes: /, /login, /api/health, /api/csp-report
- Admin routes: /payroll/run, /employees/add (require admin role)
- Session token via `SESSION_COOKIE_NAME` cookie

### API Routes
- `/api/health` — health check with Stellar network reachability
- `/api/auth/session` — session management
- `/api/employees` — employee CRUD
- `/api/payroll` — payroll execution
- `/api/transactions` — transaction history
- `/api/compliance` — view key management
- `/api/csp-report` — CSP violation reporting

### Providers
- `StellarProvider` — wallet context, contract invocation
- `MonitoringProvider` — performance tracking
- `WalletErrorOverlay` — no-wallet / wrong-network / generic error modals

### ZK Artifacts
Expected at runtime in `/public/zk/`:
- `payroll.wasm` — compiled Circom circuit
- `verification_key.json` — Groth16 verification key
- When missing, engine falls back to mock prover (dev convenience)

### Important Notes
- WASM configured in `next.config.mjs` — `asyncWebAssembly: true`, outputs to `static/wasm/`
- `next.config.mjs` output is `standalone` for Docker
- Zustand persist uses `stellar-wallet-storage` key
- Payroll wizard steps: review → proof → confirm → submit
- `PayrollWizardState` tracks proof generation status and transaction hash
- Session role check: `session.role === 'admin'` for admin routes

### Project Structure
```
app/              # Next.js App Router pages and API routes
  api/            # API routes (auth, employees, payroll, transactions, compliance, health)
  employees/      # Employee management pages
  payroll/        # Payroll pages (execute/)
  treasury/       # Treasury view
  setup/          # Company setup wizard
  compliance/    # View key management
  login/          # Auth pages
  history/        # Transaction history
  public/         # Static assets including /zk/ artifacts

components/
  features/       # Feature components organized by domain
    payroll/      # PayrollWizard, PayrollSummary
    employees/    # Employee components
    wallet/       # Wallet connection components
    dashboard/    # Dashboard widgets
    treasury/     # Treasury components
    compliance/   # Compliance components
    transactions/ # Transaction history components
    company/      # Company setup components
  layout/         # Sidebar, Header, DashboardLayout
  providers/      # StellarProvider, MonitoringProvider
  ui/             # Reusable UI primitives (Button, Card, EmptyState, Sonner)
  debug/          # StellarDebugPanel (dev only)

lib/
  api/            # API utilities (response helpers, CORS)
  auth/           # Session verification
  zk/             # ZK engine, mock prover, proof generation, serialization, hashing
  utils.ts        # General utilities

stores/           # Zustand stores (walletStore, payrollWizard, employees, company, viewKeys)

types/            # TypeScript interfaces (models, stellar types, zk types)
```
