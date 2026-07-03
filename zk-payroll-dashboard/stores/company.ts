import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Company } from '@/types';

interface CompanyState {
  company: Company | null;
  isLoading: boolean;
  setCompany: (company: Company) => void;
  clearCompany: () => void;
}

export const useCompanyStore = create<CompanyState>()(
  persist(
    (set) => ({
      company: null,
      isLoading: false,
      setCompany: (company) => set({ company }),
      clearCompany: () => set({ company: null }),
    }),
    { name: 'zk-payroll-company' }
  )
);
