"use client";

import { Bell, ChevronRight, Circle, User } from "lucide-react";
import { usePathname } from "next/navigation";
import WalletConnect from "@/components/features/wallet/WalletConnect";

const pageLabels: Record<string, string> = {
  "/": "Protocol Console",
  "/employees": "Workforce Root",
  "/payroll/execute": "Private Payroll",
  "/history": "Proof Ledger",
  "/treasury": "Treasury",
  "/compliance": "Disclosure",
  "/infrastructure": "ZK KYC Infrastructure",
  "/setup": "Institution Setup",
  "/withdraw": "Employee Withdrawal",
};

function Header() {
  const pathname = usePathname();
  const label = pageLabels[pathname] ?? "Operations";

  return (
    <header className="border-b border-slate-200 bg-white px-4 py-3 md:px-6">
      <div className="flex items-center justify-between gap-4">
        <nav className="min-w-0" aria-label="Breadcrumb">
          <ol className="flex items-center gap-2 text-sm">
            <li>
              <a
                href="/"
                className="font-medium text-slate-500 hover:text-slate-950 focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2"
              >
                PayMage
              </a>
            </li>
            <li aria-hidden="true">
              <ChevronRight className="h-4 w-4 text-slate-300" />
            </li>
            <li className="truncate font-semibold text-slate-950" aria-current="page">
              {label}
            </li>
          </ol>
          <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
            <Circle className="h-2 w-2 fill-teal-600 text-teal-600" aria-hidden="true" />
            Stellar Testnet production deployment
          </div>
        </nav>

        <div className="flex items-center gap-3">
          <WalletConnect />
          <button
            className="flex h-10 w-10 items-center justify-center rounded-md text-slate-500 hover:bg-slate-50 hover:text-slate-950 focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2"
            aria-label="Notifications"
            type="button"
          >
            <Bell className="h-5 w-5" aria-hidden="true" />
          </button>
          <div className="hidden items-center gap-2 md:flex" role="group" aria-label="User profile">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-slate-100">
              <User className="h-5 w-5 text-slate-500" aria-hidden="true" />
            </div>
            <span className="text-sm font-medium text-slate-700">Admin</span>
          </div>
        </div>
      </div>
    </header>
  );
}

export default Header;
