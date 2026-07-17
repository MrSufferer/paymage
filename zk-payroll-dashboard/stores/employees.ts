import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { PAYMAGE_TESTNET_EMPLOYEES } from '@/lib/protocol/paymage';
import type { Employee } from '@/types';

interface EmployeeState {
  employees: Employee[];
  commitmentNonce: string;
  isLoading: boolean;
  addEmployee: (employee: Employee) => void;
  updateEmployee: (id: string, updates: Partial<Employee>) => void;
  removeEmployee: (id: string) => void;
  setEmployees: (employees: Employee[]) => void;
  resetEmployees: () => void;
  rotateCommitmentNonce: () => string;
  setLoading: (loading: boolean) => void;
}

function newCommitmentNonce(): string {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `paymage-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export const useEmployeeStore = create<EmployeeState>()(
  persist(
    (set) => ({
      employees: PAYMAGE_TESTNET_EMPLOYEES,
      commitmentNonce: "paymage-demo-v1",
      isLoading: false,

      addEmployee: (employee) =>
        set((state) => ({
          employees: [...state.employees, employee],
        })),

      updateEmployee: (id, updates) =>
        set((state) => ({
          employees: state.employees.map((e) =>
            e.id === id ? { ...e, ...updates } : e
          ),
        })),

      removeEmployee: (id) =>
        set((state) => ({
          employees: state.employees.filter((e) => e.id !== id),
        })),

      setEmployees: (employees) => set({ employees }),
      resetEmployees: () => set({ employees: PAYMAGE_TESTNET_EMPLOYEES }),
      rotateCommitmentNonce: () => {
        const commitmentNonce = newCommitmentNonce();
        set({ commitmentNonce });
        return commitmentNonce;
      },
      setLoading: (loading) => set({ isLoading: loading }),
    }),
    { name: 'paymage-workforce-v1' }
  )
);
