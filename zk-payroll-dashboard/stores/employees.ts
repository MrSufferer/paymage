import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Employee } from '@/types';

interface EmployeeState {
  employees: Employee[];
  isLoading: boolean;
  addEmployee: (employee: Employee) => void;
  updateEmployee: (id: string, updates: Partial<Employee>) => void;
  removeEmployee: (id: string) => void;
  setEmployees: (employees: Employee[]) => void;
  setLoading: (loading: boolean) => void;
}

export const useEmployeeStore = create<EmployeeState>()(
  persist(
    (set) => ({
      employees: [],
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
      setLoading: (loading) => set({ isLoading: loading }),
    }),
    { name: 'zk-payroll-employees' }
  )
);
