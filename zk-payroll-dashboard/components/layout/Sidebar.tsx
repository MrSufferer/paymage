"use client";

import {
  BadgeCheck,
  Building2,
  CircleDollarSign,
  History,
  Home,
  Landmark,
  Play,
  Shield,
  Users,
} from "lucide-react";
import { usePathname } from "next/navigation";

const navItems = [
  { href: "/", label: "Protocol Console", icon: Home },
  { href: "/employees", label: "Workforce Root", icon: Users },
  { href: "/payroll/execute", label: "Private Payroll", icon: Play },
  { href: "/history", label: "Proof Ledger", icon: History },
  { href: "/treasury", label: "Treasury", icon: Landmark },
  { href: "/compliance", label: "Disclosure", icon: Shield },
  { href: "/infrastructure", label: "ZK KYC", icon: BadgeCheck },
  { href: "/setup", label: "Institution Setup", icon: Building2 },
] as const;

function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden w-72 shrink-0 border-r border-slate-200 bg-white lg:block">
      <div className="px-6 py-6">
        <a
          href="/"
          className="group flex items-center gap-3 rounded-md focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2"
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-slate-950 text-white">
            <CircleDollarSign className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <p className="text-lg font-semibold leading-5 text-slate-950">PayMage</p>
            <p className="mt-1 text-xs font-medium uppercase text-teal-700">
              Vietnam pilot
            </p>
          </div>
        </a>
      </div>

      <nav className="px-3" aria-label="Primary navigation">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive =
            item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);

          return (
            <a
              key={item.href}
              href={item.href}
              aria-current={isActive ? "page" : undefined}
              className={`mb-1 flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2 ${
                isActive
                  ? "bg-teal-50 text-teal-900"
                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-950"
              }`}
            >
              <Icon
                className={`h-4 w-4 ${isActive ? "text-teal-700" : "text-slate-400"}`}
                aria-hidden="true"
              />
              {item.label}
            </a>
          );
        })}
      </nav>
    </aside>
  );
}

export default Sidebar;
