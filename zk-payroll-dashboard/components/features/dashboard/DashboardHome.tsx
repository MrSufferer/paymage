"use client";

import { Building2, Shield, Wallet } from "lucide-react";
import { useStellar } from "@/components/providers/StellarProvider";
import { useWalletStore } from "@/stores/walletStore";
import WalletConnect from "@/components/features/wallet/WalletConnect";
import PayrollSummary from "@/components/features/payroll/PayrollSummary";
import ErrorBoundary from "@/components/ErrorBoundary";

function DashboardHome() {
  const { isFreighterInstalled } = useStellar();
  const { isConnected } = useWalletStore();

  return (
    <div className="space-y-5">
      <section className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_360px]">
        <div className="rounded-md border border-slate-200 bg-white p-6">
          <p className="text-xs font-semibold uppercase text-teal-700">Global payroll infrastructure</p>
          <h1 className="mt-2 max-w-3xl text-3xl font-semibold text-slate-950">
            PayMage runs private payroll proofs on Stellar, with Vietnam as the first institution-ready corridor.
          </h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
            Employers publish a workforce commitment, generate a Groth16 payroll proof, and submit
            only the aggregate amount and proof-bound root. Individual salaries remain encrypted for
            authorized disclosure.
          </p>
        </div>

        <aside className="rounded-md border border-slate-200 bg-white p-5">
          <div className="flex items-start gap-3">
            <Wallet className="mt-0.5 h-5 w-5 shrink-0 text-teal-700" aria-hidden="true" />
            <div>
              <h2 className="text-sm font-semibold text-slate-950">Signing status</h2>
              <p className="mt-1 text-sm text-slate-600">
                {isConnected
                  ? "Wallet connected for admin actions and payroll submission."
                  : isFreighterInstalled
                    ? "Connect Freighter when you need to sign root, auditor, or payroll transactions."
                    : "Freighter is required only for signing. Live protocol data is still visible."}
              </p>
              <div className="mt-4">
                <WalletConnect />
              </div>
            </div>
          </div>
        </aside>
      </section>

      <ErrorBoundary>
        <PayrollSummary />
      </ErrorBoundary>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <article className="rounded-md border border-slate-200 bg-white p-5">
          <div className="flex gap-3">
            <Shield className="mt-0.5 h-5 w-5 shrink-0 text-teal-700" aria-hidden="true" />
            <div>
              <h2 className="text-sm font-semibold text-slate-950">Institutional privacy model</h2>
              <p className="mt-1 text-sm leading-6 text-slate-600">
                The live protocol separates proof validity, payroll policy, encrypted salary blobs,
                and auditor disclosure. That split is what lets payroll pass compliance review without
                exposing every employee record to the public chain.
              </p>
            </div>
          </div>
        </article>
        <article className="rounded-md border border-slate-200 bg-white p-5">
          <div className="flex gap-3">
            <Building2 className="mt-0.5 h-5 w-5 shrink-0 text-teal-700" aria-hidden="true" />
            <div>
              <h2 className="text-sm font-semibold text-slate-950">Vietnam-first rollout</h2>
              <p className="mt-1 text-sm leading-6 text-slate-600">
                The next institutional layer adds ZK KYC, employer policy attestations, and local
                payroll export rails for Vietnam before expanding to other APAC corridors.
              </p>
            </div>
          </div>
        </article>
      </section>
    </div>
  );
}

export default DashboardHome;
