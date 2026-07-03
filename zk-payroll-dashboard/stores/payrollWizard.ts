import { create } from "zustand";
import type { PayrollWizardState, PayrollWizardStep } from "@/types";

const STEPS: PayrollWizardStep[] = ["review", "proof", "confirm", "submit"];

interface PayrollWizardStore extends PayrollWizardState {
  nextStep: () => void;
  prevStep: () => void;
  goToStep: (step: PayrollWizardStep) => void;
  setEmployeeIds: (ids: string[]) => void;
  setTotalAmount: (amount: number) => void;
  setProof: (proof: string | null) => void;
  setProofStatus: (status: PayrollWizardState["proofStatus"]) => void;
  setProofError: (error: string | null) => void;
  setSubmissionStatus: (
    status: PayrollWizardState["submissionStatus"],
  ) => void;
  setSubmissionError: (error: string | null) => void;
  setTransactionHash: (hash: string | null) => void;
  reset: () => void;
}

const initialState: PayrollWizardState = {
  currentStep: "review",
  employeeIds: [],
  totalAmount: 0,
  proof: null,
  proofStatus: "idle",
  proofError: null,
  submissionStatus: "idle",
  submissionError: null,
  transactionHash: null,
};

export const usePayrollWizardStore = create<PayrollWizardStore>((set) => ({
  ...initialState,
  nextStep: () =>
    set((state) => {
      const idx = STEPS.indexOf(state.currentStep);
      if (idx < STEPS.length - 1) {
        return { currentStep: STEPS[idx + 1] };
      }
      return {};
    }),
  prevStep: () =>
    set((state) => {
      const idx = STEPS.indexOf(state.currentStep);
      if (idx > 0) {
        return { currentStep: STEPS[idx - 1] };
      }
      return {};
    }),
  goToStep: (step) => set({ currentStep: step }),
  setEmployeeIds: (employeeIds) => set({ employeeIds }),
  setTotalAmount: (totalAmount) => set({ totalAmount }),
  setProof: (proof) => set({ proof }),
  setProofStatus: (proofStatus) => set({ proofStatus }),
  setProofError: (proofError) => set({ proofError }),
  setSubmissionStatus: (submissionStatus) => set({ submissionStatus }),
  setSubmissionError: (submissionError) => set({ submissionError }),
  setTransactionHash: (transactionHash) => set({ transactionHash }),
  reset: () => set(initialState),
}));
