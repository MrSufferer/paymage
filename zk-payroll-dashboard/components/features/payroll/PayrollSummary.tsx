"use client";

import { AlertTriangle, CheckCircle2, RefreshCw, ShieldCheck } from "lucide-react";
import { formatXlm, formatStroopsAsXlm } from "@/lib/protocol/tokenFormat";
import { useProtocolStatus } from "@/lib/protocol/useProtocolStatus";

function short(value: string | null | undefined) {
  if (!value) return "Not configured";
  if (value.length <= 18) return value;
  return `${value.slice(0, 10)}...${value.slice(-8)}`;
}

function PayrollSummary() {
  const { data, error, isLoading, refresh } = useProtocolStatus();

  const rootReady = data?.payroll.rootSynced;

  return (
    <section className="space-y-5" aria-labelledby="protocol-summary-heading">
      <div className="flex flex-col justify-between gap-3 md:flex-row md:items-end">
        <div>
          <p className="text-xs font-semibold uppercase text-teal-700">Live protocol state</p>
          <h2 id="protocol-summary-heading" className="mt-1 text-2xl font-semibold text-slate-950">
            PayMage testnet console
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-600">
            Proof generation, payroll policy, and disclosure controls are wired to the deployed
            Stellar testnet contracts used by the current Vercel production build.
          </p>
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={isLoading}
          className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60 focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2"
        >
          <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} aria-hidden="true" />
          Refresh
        </button>
      </div>

      {error && (
        <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          Could not load live testnet status: {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <MetricCard
          label="Payroll batch"
          value={isLoading ? "Loading" : formatStroopsAsXlm(data?.payroll.nextPayrollAmount)}
          detail={`${data?.payroll.activeEmployees ?? 10} employees in root`}
        />
        <MetricCard
          label="Current period"
          value={isLoading ? "Loading" : `#${data?.payroll.currentPeriod ?? "?"}`}
          detail={`Ledger ${data?.ledger.sequence?.toLocaleString() ?? "syncing"}`}
        />
        <MetricCard
          label="Treasury token"
          value={isLoading ? "Loading" : formatXlm(data?.payroll.treasuryBalance)}
          detail="Native token SAC balance"
        />
        <MetricCard
          label="Budget cap"
          value={isLoading ? "Loading" : formatXlm(data?.payroll.budgetCap)}
          detail="On-chain payroll policy"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <article className="rounded-md border border-slate-200 bg-white p-5">
          <div className="flex items-start gap-3">
            {rootReady ? (
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-teal-700" aria-hidden="true" />
            ) : (
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-hidden="true" />
            )}
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-semibold text-slate-950">
                {rootReady ? "Workforce root matches the demo payroll batch" : "Workforce root needs sync"}
              </h3>
              <p className="mt-1 text-sm text-slate-600">
                The payroll proof is bound to the employee Merkle root stored in the payroll
                contract. This prevents a valid proof from being replayed against a different
                workforce.
              </p>
              <dl className="mt-4 grid grid-cols-1 gap-3 text-xs md:grid-cols-2">
                <div>
                  <dt className="font-medium text-slate-500">Contract root</dt>
                  <dd className="mt-1 break-all font-mono text-slate-900">
                    {short(data?.payroll.employeeRootHex)}
                  </dd>
                </div>
                <div>
                  <dt className="font-medium text-slate-500">Expected demo root</dt>
                  <dd className="mt-1 break-all font-mono text-slate-900">
                    {short(data?.payroll.expectedEmployeeRoot)}
                  </dd>
                </div>
              </dl>
            </div>
          </div>
        </article>

        <article className="rounded-md border border-slate-200 bg-white p-5">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-teal-700" aria-hidden="true" />
            <div>
              <h3 className="text-sm font-semibold text-slate-950">Proof infrastructure</h3>
              <dl className="mt-3 space-y-2 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">Engine</dt>
                  <dd className="font-medium text-slate-900">{data?.proof.engine ?? "server"}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">Prover</dt>
                  <dd className="truncate font-mono text-xs text-slate-900">
                    {data?.proof.proverUrl ? new URL(data.proof.proverUrl).host : "Not configured"}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">Protocol</dt>
                  <dd className="font-medium text-slate-900">
                    Stellar {data?.ledger.protocolVersion ?? "?"}
                  </dd>
                </div>
              </dl>
            </div>
          </div>
        </article>
      </div>

      <article className="overflow-hidden rounded-md border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-5 py-3">
          <h3 className="text-sm font-semibold text-slate-950">Contracts</h3>
        </div>
        <dl className="divide-y divide-slate-100 text-sm">
          {data && Object.entries(data.contracts).map(([label, value]) => (
            <div key={label} className="grid grid-cols-1 gap-1 px-5 py-3 md:grid-cols-[180px_1fr]">
              <dt className="font-medium capitalize text-slate-500">{label.replace(/([A-Z])/g, " $1")}</dt>
              <dd className="break-all font-mono text-slate-900">{value}</dd>
            </div>
          ))}
        </dl>
      </article>
    </section>
  );
}

function MetricCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <article className="rounded-md border border-slate-200 bg-white p-5">
      <h3 className="text-sm font-medium text-slate-500">{label}</h3>
      <p className="mt-2 text-2xl font-semibold text-slate-950">{value}</p>
      <p className="mt-1 text-xs text-slate-500">{detail}</p>
    </article>
  );
}

export default PayrollSummary;
