"use client";

import { useState, useMemo } from "react";
import { Plus, RotateCcw, ShieldCheck, Trash2, Users } from "lucide-react";
import { PAYMAGE_PROTOCOL, PAYMAGE_TESTNET_EMPLOYEES } from "@/lib/protocol/paymage";
import { useProtocolStatus } from "@/lib/protocol/useProtocolStatus";
import { useEmployeeStore } from "@/stores/employees";
import { useWalletStore } from "@/stores/walletStore";
import type { Employee } from "@/types";
import EmptyState from "@/components/ui/EmptyState";

type StatusFilter = "all" | "active" | "inactive" | "pending";

function deriveStatus(e: Employee): "active" | "inactive" | "pending" {
  if (e.status) return e.status;
  if (!e.isActive) return "inactive";
  if (!e.lastPayment) return "pending";
  return "active";
}

const STATUS_BADGE: Record<"active" | "inactive" | "pending", string> = {
  active: "bg-green-100 text-green-800",
  inactive: "bg-gray-100 text-gray-600",
  pending: "bg-yellow-100 text-yellow-800",
};

function EmployeeDirectory() {
  const { data: protocolStatus } = useProtocolStatus();
  const { publicKey } = useWalletStore();
  const { employees: storedEmployees, addEmployee, updateEmployee, removeEmployee, resetEmployees } = useEmployeeStore();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const employees = storedEmployees.length > 0 ? storedEmployees : PAYMAGE_TESTNET_EMPLOYEES;
  const isPayrollAdmin = Boolean(publicKey && publicKey === PAYMAGE_PROTOCOL.admin);
  const canEditWorkforce = Boolean(publicKey);
  const localBatchAmount = employees
    .filter((employee) => employee.isActive)
    .reduce((sum, employee) => sum + employee.salary, 0);
  const protocolRoot = protocolStatus?.payroll.employeeRootHex ?? protocolStatus?.payroll.expectedEmployeeRoot;
  const activeEmployees = protocolStatus?.payroll.activeEmployees ?? employees.filter((e) => e.isActive).length;
  const batchAmount = localBatchAmount;

  const filtered = useMemo(() => {
    if (statusFilter === "all") return employees;
    return employees.filter((e) => deriveStatus(e) === statusFilter);
  }, [employees, statusFilter]);

  const counts = useMemo(() => {
    const result = { active: 0, inactive: 0, pending: 0 };
    for (const e of employees) {
      result[deriveStatus(e)]++;
    }
    return result;
  }, [employees]);

  const handleAddEmployee = () => {
    const nextNumber = employees.length + 1;
    const id = `emp_${String(nextNumber).padStart(3, "0")}`;
    addEmployee({
      id,
      address: PAYMAGE_PROTOCOL.admin,
      name: `PayMage Employee ${nextNumber}`,
      email: `${id}@paymage.test`,
      department: "Operations",
      salary: 50_000,
      salaryCommitment: protocolRoot ?? PAYMAGE_PROTOCOL.expectedEmployeeRoot,
      isActive: true,
      status: "active",
      startDate: new Date().toISOString(),
    });
  };

  const updateStatus = (employee: Employee, status: "active" | "inactive" | "pending") => {
    updateEmployee(employee.id, {
      status,
      isActive: status === "active" || status === "pending",
    });
  };

  return (
    <section aria-labelledby="employee-directory-heading">
      <div className="bg-white rounded-lg shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h3
              id="employee-directory-heading"
              className="text-lg font-medium text-gray-900"
            >
              Workforce Commitments
            </h3>
            <p className="mt-1 text-xs text-gray-500">
              {activeEmployees} active slots, {batchAmount.toLocaleString()} private payroll units, root{" "}
              <span className="font-mono">
                {protocolRoot ? `${protocolRoot.slice(0, 8)}...${protocolRoot.slice(-6)}` : "syncing"}
              </span>
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {(["all", "active", "inactive", "pending"] as StatusFilter[]).map(
              (s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStatusFilter(s)}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                    statusFilter === s
                      ? "bg-indigo-600 text-white"
                      : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                  }`}
                >
                  {s === "all"
                    ? `All (${employees.length})`
                    : `${s.charAt(0).toUpperCase() + s.slice(1)} (${counts[s]})`}
                </button>
              ),
            )}
            {canEditWorkforce ? (
              <>
                <button
                  type="button"
                  onClick={handleAddEmployee}
                  className="inline-flex items-center gap-1 rounded-md bg-teal-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-800"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add
                </button>
                <button
                  type="button"
                  onClick={resetEmployees}
                  className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Reset
                </button>
              </>
            ) : null}
          </div>
        </div>

        {!canEditWorkforce ? (
          <div className="border-b border-slate-100 bg-slate-50 px-6 py-3 text-xs text-slate-600">
            Connect a wallet to edit this workforce. Root updates are submitted
            directly by the deployed admin wallet or through delegated testnet admin.
          </div>
        ) : !isPayrollAdmin ? (
          <div className="border-b border-amber-100 bg-amber-50 px-6 py-3 text-xs text-amber-800">
            You are editing a local workforce roster as a delegated admin tester. Posting
            the root will require a Freighter challenge and Vercel will submit the
            on-chain transaction with the deployed admin signer.
          </div>
        ) : null}

        {filtered.length === 0 ? (
          <EmptyState
            icon={Users}
            title={
              statusFilter === "all"
                ? "No employees yet"
                : `No ${statusFilter} employees`
            }
            description={
              statusFilter === "all"
                ? "Add employees to get started with payroll."
                : `There are no employees with ${statusFilter} status.`
            }
            action={
              statusFilter !== "all"
                ? { label: "View all employees", onClick: () => setStatusFilter("all") }
                : undefined
            }
          />
        ) : (
          <table className="w-full text-left">
            <caption className="sr-only">Private payroll commitment slots</caption>
            <thead className="bg-gray-50">
              <tr>
                <th scope="col" className="px-6 py-3 text-xs font-medium text-gray-600 uppercase">
                  Slot
                </th>
                <th scope="col" className="px-6 py-3 text-xs font-medium text-gray-600 uppercase">
                  Employee
                </th>
                <th scope="col" className="px-6 py-3 text-xs font-medium text-gray-600 uppercase">
                  Cohort
                </th>
                <th scope="col" className="px-6 py-3 text-xs font-medium text-gray-600 uppercase">
                  Private amount
                </th>
                <th scope="col" className="px-6 py-3 text-xs font-medium text-gray-600 uppercase">
                  Status
                </th>
                <th scope="col" className="px-6 py-3 text-xs font-medium text-gray-600 uppercase">
                  Commitment
                </th>
                {canEditWorkforce ? (
                  <th scope="col" className="px-6 py-3 text-xs font-medium text-gray-600 uppercase">
                    Action
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100" aria-live="polite">
              {filtered.map((emp, index) => {
                const status = deriveStatus(emp);
                const rawCommitment = emp.salaryCommitment || "";
                const commitment = rawCommitment.length > 12 ? rawCommitment : protocolRoot || "";
                return (
                  <tr key={emp.id}>
                    <td className="px-6 py-4">
                      <div className="text-sm font-medium text-gray-900">
                        Commitment #{String(index + 1).padStart(3, "0")}
                      </div>
                      <div className="text-xs text-gray-500 font-mono">
                        slot_{String(index + 1).padStart(3, "0")}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-700">
                      {canEditWorkforce ? (
                        <input
                          value={emp.name}
                          onChange={(event) => updateEmployee(emp.id, { name: event.target.value })}
                          className="w-full rounded-md border border-slate-200 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-teal-600"
                        />
                      ) : (
                        emp.name
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600">
                      {canEditWorkforce ? (
                        <input
                          value={emp.department ?? ""}
                          onChange={(event) => updateEmployee(emp.id, { department: event.target.value })}
                          className="w-full rounded-md border border-slate-200 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-teal-600"
                        />
                      ) : (
                        emp.department ?? "Vietnam payroll"
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm font-medium text-gray-900">
                      {canEditWorkforce ? (
                        <input
                          type="number"
                          min={1}
                          step={1}
                          value={emp.salary}
                          onChange={(event) =>
                            updateEmployee(emp.id, {
                              salary: Number(event.target.value || 0),
                            })
                          }
                          className="w-28 rounded-md border border-slate-200 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-teal-600"
                        />
                      ) : (
                        <span className="inline-flex items-center gap-1.5">
                          <ShieldCheck className="h-4 w-4 text-emerald-600" aria-hidden="true" />
                          Encrypted
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      {canEditWorkforce ? (
                        <select
                          value={status}
                          onChange={(event) =>
                            updateStatus(emp, event.target.value as "active" | "inactive" | "pending")
                          }
                          className="rounded-md border border-slate-200 px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-teal-600"
                        >
                          <option value="active">Active</option>
                          <option value="pending">Pending</option>
                          <option value="inactive">Inactive</option>
                        </select>
                      ) : (
                        <span
                          className={`px-2 py-1 text-xs font-medium rounded-full ${STATUS_BADGE[status]}`}
                        >
                          {status}
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-xs text-gray-600 font-mono">
                      {commitment ? `${commitment.slice(0, 10)}...${commitment.slice(-8)}` : "pending"}
                    </td>
                    {canEditWorkforce ? (
                      <td className="px-6 py-4">
                        <button
                          type="button"
                          onClick={() => removeEmployee(emp.id)}
                          className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-700"
                          aria-label={`Remove ${emp.name}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {filtered.length > 0 && (
          <div className="px-6 py-3 border-t text-xs text-gray-500">
            Showing {filtered.length} of {employees.length} commitment slots from the PayMage testnet root
          </div>
        )}
      </div>
    </section>
  );
}

export default EmployeeDirectory;
