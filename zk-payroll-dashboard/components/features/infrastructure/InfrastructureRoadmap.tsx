"use client";

import { BadgeCheck, Building2, CreditCard, FileKey2, Globe2, ShieldCheck } from "lucide-react";
import { useProtocolStatus } from "@/lib/protocol/useProtocolStatus";

const upcoming = [
  {
    title: "ZK KYC attestations",
    status: "Upcoming",
    description:
      "Employees prove eligibility, work authorization, and institution policy membership without exposing raw identity documents to payroll operators.",
    icon: BadgeCheck,
  },
  {
    title: "Vietnam payroll export rails",
    status: "Upcoming",
    description:
      "Localized reporting packets for Vietnam-first institutions: employer registry metadata, payroll period export, and auditor-ready disclosure bundles.",
    icon: Building2,
  },
  {
    title: "Fiat on/off ramp",
    status: "Upcoming",
    description:
      "Bank and stablecoin ramp partners for funding payroll and settling employee withdrawals after the core proof-ledger flow is production hardened.",
    icon: CreditCard,
  },
  {
    title: "Selective disclosure vault",
    status: "In protocol",
    description:
      "Encrypted salary blobs are uploaded per commitment and revealed only through view-key controlled auditor access.",
    icon: FileKey2,
  },
  {
    title: "Global corridor layer",
    status: "Planned",
    description:
      "Multi-jurisdiction policy adapters for institutions expanding from Vietnam into broader APAC payroll operations.",
    icon: Globe2,
  },
];

function InfrastructureRoadmap() {
  const { data } = useProtocolStatus();

  return (
    <section className="space-y-5" aria-labelledby="infra-heading">
      <div className="rounded-md border border-slate-200 bg-white p-6">
        <p className="text-xs font-semibold uppercase text-teal-700">Infrastructure roadmap</p>
        <h1 id="infra-heading" className="mt-2 text-3xl font-semibold text-slate-950">
          ZK KYC, ramps, and institutional payroll rails
        </h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
          PayMage starts with working private payroll execution on Stellar testnet. The roadmap
          adds identity, fiat rails, and corridor integrations after the core proof ledger and
          auditor disclosure flows.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <article className="rounded-md border border-slate-200 bg-white p-5">
          <div className="flex gap-3">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-teal-700" aria-hidden="true" />
            <div>
              <h2 className="text-sm font-semibold text-slate-950">Live foundation</h2>
              <dl className="mt-4 grid grid-cols-1 gap-3 text-sm">
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-500">Payroll contract</dt>
                  <dd className="truncate font-mono text-xs text-slate-900">
                    {data?.contracts.payroll ?? "Loading"}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-500">Root ready</dt>
                  <dd className="font-medium text-slate-900">
                    {data?.payroll.rootSynced ? "Yes" : "Needs sync"}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-500">Proof engine</dt>
                  <dd className="font-medium text-slate-900">{data?.proof.engine ?? "server"}</dd>
                </div>
              </dl>
            </div>
          </div>
        </article>

        <article className="rounded-md border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-slate-950">Vietnam institution scope</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            The first production-grade target is employer payroll privacy for Vietnam-based teams:
            private salary commitments, auditor disclosure, KYC eligibility proofs, and clean
            payroll exports for institutional review.
          </p>
        </article>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {upcoming.map((item) => {
          const Icon = item.icon;
          return (
            <article key={item.title} className="rounded-md border border-slate-200 bg-white p-5">
              <div className="flex items-start gap-3">
                <Icon className="mt-0.5 h-5 w-5 shrink-0 text-teal-700" aria-hidden="true" />
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-sm font-semibold text-slate-950">{item.title}</h2>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                      {item.status}
                    </span>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-slate-600">{item.description}</p>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

export default InfrastructureRoadmap;
