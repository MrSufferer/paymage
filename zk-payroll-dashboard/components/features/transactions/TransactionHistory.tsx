"use client";

import { useState, useMemo } from "react";
import {
  ArrowUpRight,
  ArrowDownLeft,
  Download,
  Filter,
  X,
} from "lucide-react";
import { MOCK_TRANSACTIONS, MOCK_EMPLOYEES } from "@/lib/api/mockData";
import type { PayrollTransaction } from "@/types";

type StatusFilter = "all" | "verified" | "pending" | "failed";

interface Filters {
  status: StatusFilter;
  employee: string;
  dateFrom: string;
  dateTo: string;
  payrollRun: string;
}

const initialFilters: Filters = {
  status: "all",
  employee: "",
  dateFrom: "",
  dateTo: "",
  payrollRun: "",
};

function toCsvRow(values: string[]): string {
  return values
    .map((v) => {
      const needsQuoting = v.includes(",") || v.includes('"') || v.includes("\n");
      return needsQuoting ? `"${v.replace(/"/g, '""')}"` : v;
    })
    .join(",");
}

function exportToCsv(rows: PayrollTransaction[]): string {
  const header = toCsvRow(["ID", "Date", "Status", "Total Amount", "Employees", "Tx Hash"]);
  const body = rows
    .map((tx) =>
      toCsvRow([
        tx.id,
        new Date(tx.createdAt).toLocaleDateString(),
        tx.status,
        `$${tx.totalAmount.toLocaleString()}`,
        String(tx.employeeCount),
        tx.txHash ?? "N/A",
      ]),
    )
    .join("\n");
  return `${header}\n${body}`;
}

function downloadCsv(csv: string, filename: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function TransactionHistory() {
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [showFilters, setShowFilters] = useState(false);

  const filtered = useMemo(() => {
    let results = [...MOCK_TRANSACTIONS];

    if (filters.status !== "all") {
      results = results.filter((t) => t.status === filters.status);
    }

    if (filters.dateFrom) {
      results = results.filter((t) => t.createdAt >= filters.dateFrom);
    }

    if (filters.dateTo) {
      results = results.filter((t) => t.createdAt <= filters.dateTo);
    }

    if (filters.employee) {
      const match = MOCK_EMPLOYEES.find(
        (e) => e.name.toLowerCase() === filters.employee.toLowerCase(),
      );
      if (match) {
        results = results.filter((t) => t.employeeCount > 0);
      }
    }

    if (filters.payrollRun) {
      results = results.filter((t) =>
        t.id.toLowerCase().includes(filters.payrollRun.toLowerCase()),
      );
    }

    return results;
  }, [filters]);

  const activeFilterCount = [
    filters.status !== "all",
    !!filters.employee,
    !!filters.dateFrom,
    !!filters.dateTo,
    !!filters.payrollRun,
  ].filter(Boolean).length;

  const handleExport = () => {
    const csv = exportToCsv(filtered);
    const date = new Date().toISOString().slice(0, 10);
    downloadCsv(csv, `payroll-history-${date}.csv`);
  };

  const clearFilters = () => setFilters(initialFilters);

  return (
    <section aria-labelledby="transaction-history-heading">
      <div className="bg-white rounded-lg shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <h3
            id="transaction-history-heading"
            className="text-lg font-medium text-gray-900"
          >
            Transaction History
          </h3>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowFilters(!showFilters)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                showFilters
                  ? "bg-indigo-50 text-indigo-700"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
              aria-expanded={showFilters}
              aria-controls="filter-panel"
            >
              <Filter className="w-3.5 h-3.5" />
              Filters
              {activeFilterCount > 0 && (
                <span className="ml-1 px-1.5 py-0.5 text-xs bg-indigo-600 text-white rounded-full">
                  {activeFilterCount}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={handleExport}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              Export CSV
            </button>
          </div>
        </div>

        {showFilters && (
          <div
            id="filter-panel"
            role="region"
            aria-label="Filter transactions"
            className="px-6 py-4 bg-gray-50 border-b grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3"
          >
            <div>
              <label
                htmlFor="filter-status"
                className="block text-xs font-medium text-gray-600 mb-1"
              >
                Status
              </label>
              <select
                id="filter-status"
                value={filters.status}
                onChange={(e) =>
                  setFilters((f) => ({
                    ...f,
                    status: e.target.value as StatusFilter,
                  }))
                }
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none"
              >
                <option value="all">All statuses</option>
                <option value="verified">Verified</option>
                <option value="pending">Pending</option>
                <option value="failed">Failed</option>
              </select>
            </div>
            <div>
              <label
                htmlFor="filter-employee"
                className="block text-xs font-medium text-gray-600 mb-1"
              >
                Employee
              </label>
              <input
                id="filter-employee"
                type="text"
                placeholder="Search name..."
                value={filters.employee}
                onChange={(e) =>
                  setFilters((f) => ({ ...f, employee: e.target.value }))
                }
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none"
              />
            </div>
            <div>
              <label
                htmlFor="filter-date-from"
                className="block text-xs font-medium text-gray-600 mb-1"
              >
                From
              </label>
              <input
                id="filter-date-from"
                type="date"
                value={filters.dateFrom}
                onChange={(e) =>
                  setFilters((f) => ({ ...f, dateFrom: e.target.value }))
                }
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none"
              />
            </div>
            <div>
              <label
                htmlFor="filter-date-to"
                className="block text-xs font-medium text-gray-600 mb-1"
              >
                To
              </label>
              <input
                id="filter-date-to"
                type="date"
                value={filters.dateTo}
                onChange={(e) =>
                  setFilters((f) => ({ ...f, dateTo: e.target.value }))
                }
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none"
              />
            </div>
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <label
                  htmlFor="filter-payroll-run"
                  className="block text-xs font-medium text-gray-600 mb-1"
                >
                  Payroll Run
                </label>
                <input
                  id="filter-payroll-run"
                  type="text"
                  placeholder="Run ID..."
                  value={filters.payrollRun}
                  onChange={(e) =>
                    setFilters((f) => ({ ...f, payrollRun: e.target.value }))
                  }
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                />
              </div>
              {activeFilterCount > 0 && (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="p-1.5 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-200 transition-colors"
                  aria-label="Clear all filters"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        )}

        <table className="w-full text-left">
          <caption className="sr-only">
            Payroll transactions with filtering and export
          </caption>
          <thead className="bg-gray-50">
            <tr>
              <th
                scope="col"
                className="px-6 py-3 text-xs font-medium text-gray-600 uppercase"
              >
                Type
              </th>
              <th
                scope="col"
                className="px-6 py-3 text-xs font-medium text-gray-600 uppercase"
              >
                Recipient
              </th>
              <th
                scope="col"
                className="px-6 py-3 text-xs font-medium text-gray-600 uppercase"
              >
                Amount
              </th>
              <th
                scope="col"
                className="px-6 py-3 text-xs font-medium text-gray-600 uppercase"
              >
                Status
              </th>
              <th
                scope="col"
                className="px-6 py-3 text-xs font-medium text-gray-600 uppercase"
              >
                Date
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200" aria-live="polite">
            {filtered.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-6 py-8 text-center text-sm text-gray-500"
                >
                  No transactions match the current filters.
                </td>
              </tr>
            ) : (
              filtered.map((tx) => (
                <tr key={tx.id}>
                  <td className="px-6 py-4 flex items-center">
                    {tx.totalAmount > 0 ? (
                      <ArrowDownLeft
                        className="w-4 h-4 text-green-600 mr-2"
                        aria-hidden="true"
                      />
                    ) : (
                      <ArrowUpRight
                        className="w-4 h-4 text-red-600 mr-2"
                        aria-hidden="true"
                      />
                    )}
                    Payout
                  </td>
                  <td className="px-6 py-4 text-gray-900">
                    {tx.employeeCount} employees
                  </td>
                  <td className="px-6 py-4 font-medium text-gray-900">
                    ${tx.totalAmount.toLocaleString()}
                  </td>
                  <td className="px-6 py-4">
                    <span
                      className={`px-2 py-1 text-xs font-medium rounded-full ${
                        tx.status === "verified"
                          ? "bg-green-100 text-green-800"
                          : tx.status === "pending"
                            ? "bg-yellow-100 text-yellow-800"
                            : "bg-red-100 text-red-800"
                      }`}
                    >
                      {tx.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-gray-600">
                    {new Date(tx.createdAt).toLocaleDateString()}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        <div className="px-6 py-3 border-t text-xs text-gray-500">
          Showing {filtered.length} of {MOCK_TRANSACTIONS.length} transactions
        </div>
      </div>
    </section>
  );
}

export default TransactionHistory;
