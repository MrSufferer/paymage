"use client";

import { AlertTriangle, CheckCircle2, ExternalLink, Landmark, RefreshCw } from "lucide-react";
import { PAYMAGE_PROTOCOL_TRANSACTIONS } from "@/lib/protocol/paymage";
import { formatXlm, formatStroopsAsXlm } from "@/lib/protocol/tokenFormat";
import { useProtocolStatus } from "@/lib/protocol/useProtocolStatus";

function TreasuryView() {
  const { data, error, isLoading, refresh } = useProtocolStatus();
  const projectedPayroll = data?.payroll.nextPayrollAmount ?? 500_000;
  const balance = data?.payroll.treasuryBalance ?? null;
  const budgetCap = data?.payroll.budgetCap ?? null;
  const hasRoot = data?.payroll.rootMatchesDemo;

  return (
    <section aria-labelledby="treasury-heading" className="space-y-5">
      <div className="flex flex-col justify-between gap-3 md:flex-row md:items-end">
        <div>
          <p className="text-xs font-semibold uppercase text-teal-700">Treasury</p>
          <h1 id="treasury-heading" className="mt-1 text-3xl font-semibold text-slate-950">
            Native token payroll treasury
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-600">
            Live SAC balance, budget cap, and payroll policy inputs from the deployed Stellar
            testnet protocol.
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
          {error}
        </div>
      )}

      {!hasRoot && !isLoading && (
        <div role="alert" className="flex gap-3 rounded-md border border-amber-200 bg-amber-50 p-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-hidden="true" />
          <p className="text-sm text-amber-800">
            The employee root does not match the PayMage demo workforce. Sync the root before
            submitting payroll.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Metric label="Treasury balance" value={formatXlm(balance)} detail="Admin native SAC balance" />
        <Metric label="Next private payroll" value={formatStroopsAsXlm(projectedPayroll)} detail="10 employees in proof batch" />
        <Metric label="Budget cap" value={formatXlm(budgetCap)} detail="Contract policy limit" />
      </div>

      <article className="rounded-md border border-slate-200 bg-white p-5">
        <div className="flex items-start gap-3">
          <Landmark className="mt-0.5 h-5 w-5 shrink-0 text-teal-700" aria-hidden="true" />
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-slate-950">Treasury address</h2>
            <p className="mt-2 break-all font-mono text-xs text-slate-700">
              {data?.payroll.admin ?? "Loading"}
            </p>
          </div>
        </div>
      </article>

      <article className="overflow-hidden rounded-md border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="text-sm font-semibold text-slate-950">Protocol events</h2>
        </div>
        <table className="w-full text-left">
          <caption className="sr-only">PayMage treasury and payroll protocol events</caption>
          <thead className="bg-slate-50">
            <tr>
              <th scope="col" className="px-5 py-3 text-xs font-medium uppercase text-slate-500">Event</th>
              <th scope="col" className="px-5 py-3 text-xs font-medium uppercase text-slate-500">Amount</th>
              <th scope="col" className="px-5 py-3 text-xs font-medium uppercase text-slate-500">Status</th>
              <th scope="col" className="px-5 py-3 text-xs font-medium uppercase text-slate-500">Tx</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {PAYMAGE_PROTOCOL_TRANSACTIONS.map((tx) => (
              <tr key={tx.id}>
                <td className="px-5 py-4 text-sm text-slate-900">Employee root sync</td>
                <td className="px-5 py-4 text-sm font-medium text-slate-900">
                  {tx.totalAmount > 0 ? formatStroopsAsXlm(tx.totalAmount) : "-"}
                </td>
                <td className="px-5 py-4">
                  <span className="inline-flex items-center gap-1 rounded-full bg-teal-50 px-2 py-1 text-xs font-medium text-teal-800">
                    <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                    {tx.status}
                  </span>
                </td>
                <td className="px-5 py-4">
                  {tx.txHash ? (
                    <a
                      href={`https://stellar.expert/explorer/testnet/tx/${tx.txHash}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 font-mono text-xs text-teal-700 hover:text-teal-900 focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2"
                    >
                      {tx.txHash.slice(0, 10)}...
                      <ExternalLink className="h-3 w-3" aria-hidden="true" />
                    </a>
                  ) : (
                    <span className="text-sm text-slate-500">Pending</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </article>
    </section>
  );
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <article className="rounded-md border border-slate-200 bg-white p-5">
      <h2 className="text-sm font-medium text-slate-500">{label}</h2>
      <p className="mt-2 text-2xl font-semibold text-slate-950">{value}</p>
      <p className="mt-1 text-xs text-slate-500">{detail}</p>
    </article>
  );
}

export default TreasuryView;
