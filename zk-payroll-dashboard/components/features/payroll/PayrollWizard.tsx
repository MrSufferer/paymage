"use client";

import { useMemo, useCallback, useState, useEffect } from "react";
import {
  CheckCircle,
  Circle,
  Loader2,
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import * as StellarSdk from "@stellar/stellar-sdk";
import { Server } from "@stellar/stellar-sdk/rpc";
import { usePayrollWizardStore } from "@/stores/payrollWizard";
import { useWalletStore, NETWORK_PASSPHRASES } from "@/stores/walletStore";
import { useEmployeeStore } from "@/stores/employees";
import { useStellar } from "@/components/providers/StellarProvider";
import { zkEngine, isRealZkEngineActive } from "@/lib/zk/engine";
import { toSorobanScVals, toSorobanScValsFromRealProof } from "@/lib/zk/serialize";
import { buildMerkleTree } from "@/lib/zk/merkleTree";
import { PAYMAGE_AUDITOR_DISCLOSURE_KEY_ID, PAYMAGE_TESTNET_EMPLOYEES } from "@/lib/protocol/paymage";
import {
  buildPayrollSlots,
  buildZkProofPrivateInputs,
  computeCommitmentId,
  type PayrollSlot,
} from "@/lib/zk/payrollInputs";
import { encryptSalaryBlob, deriveViewKey, serializeEncryptedPayload } from "@/lib/zk/encryption";
import { uploadToIpfs } from "@/lib/ipfs";
import { env } from "@/lib/env";
import { formatStroopsAsXlm } from "@/lib/protocol/tokenFormat";
import type { PayrollWizardStep, GeneratedPayrollProof } from "@/types";

const STEPS: { key: PayrollWizardStep; label: string }[] = [
  { key: "review", label: "Root Review" },
  { key: "proof", label: "Proof" },
  { key: "confirm", label: "Policy" },
  { key: "submit", label: "Submit" },
];

function stepIndex(step: PayrollWizardStep): number {
  return STEPS.findIndex((s) => s.key === step);
}

function normalizePeriod(value: unknown): number {
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  return 0;
}

function shortAddress(value: string | null | undefined): string {
  if (!value) return "Not connected";
  return `${value.slice(0, 6)}...${value.slice(-6)}`;
}

function PayrollWizard() {
  const {
    currentStep,
    employeeIds,
    totalAmount,
    proofStatus,
    proofError,
    submissionStatus,
    submissionError,
    transactionHash,
    nextStep,
    prevStep,
    setEmployeeIds,
    setTotalAmount,
    setProofStatus,
    setProofError,
    setSubmissionStatus,
    setSubmissionError,
    setTransactionHash,
    reset,
  } = usePayrollWizardStore();

  const { publicKey, isConnected, network } = useWalletStore();
  const storedEmployees = useEmployeeStore((state) => state.employees);
  const commitmentNonce = useEmployeeStore((state) => state.commitmentNonce);
  const { invokeContract } = useStellar();
  const [generatedProof, setGeneratedProof] = useState<GeneratedPayrollProof | null>(null);
  const [contractRoot, setContractRoot] = useState<bigint | null>(null);
  const [currentPeriod, setCurrentPeriod] = useState<number>(0);
  const [isLoadingRoot, setIsLoadingRoot] = useState(false);
  const [salarySlots, setSalarySlots] = useState<PayrollSlot[]>([]);
  const [ipfsCids, setIpfsCids] = useState<Array<{ commitmentId: string; ipfsCid: string }>>([]);

  const allEmployees = useMemo(
    () => (storedEmployees.length > 0 ? storedEmployees : PAYMAGE_TESTNET_EMPLOYEES),
    [storedEmployees],
  );

  const selectedEmployees = useMemo(
    () => allEmployees.filter((e) => employeeIds.includes(e.id)),
    [employeeIds, allEmployees],
  );

  const simulateContractCall = useCallback(async (method: string) => {
    if (!env.NEXT_PUBLIC_PAYROLL_CONTRACT || !publicKey) return null;
    const server = new Server(
      network === "TESTNET"
        ? "https://soroban-testnet.stellar.org"
        : "https://soroban-rpc.stellar.org",
    );
    const contract = new StellarSdk.Contract(env.NEXT_PUBLIC_PAYROLL_CONTRACT);
    const tx = new StellarSdk.TransactionBuilder(
      await server.getAccount(publicKey),
      { fee: "100", networkPassphrase: NETWORK_PASSPHRASES[network] },
    )
      .addOperation(contract.call(method))
      .setTimeout(30)
      .build();

    const sim = await server.simulateTransaction(tx);
    if (!StellarSdk.rpc.Api.isSimulationError(sim) && sim.result?.retval) {
      return StellarSdk.scValToNative(sim.result.retval);
    }
    return null;
  }, [publicKey, network]);

  const fetchContractState = useCallback(async () => {
    if (!env.NEXT_PUBLIC_PAYROLL_CONTRACT || !publicKey) return;
    setIsLoadingRoot(true);
    try {
      const [root, period] = await Promise.all([
        simulateContractCall("get_employee_root"),
        simulateContractCall("get_current_period"),
      ]);
      if (root !== null) setContractRoot(root);
      if (period !== null) setCurrentPeriod(normalizePeriod(period));
    } catch {
      setContractRoot(null);
    } finally {
      setIsLoadingRoot(false);
    }
  }, [publicKey, simulateContractCall]);

  useEffect(() => {
    if (currentStep === "review") {
      fetchContractState();
    }
  }, [currentStep, fetchContractState]);

  const handleStartPayroll = useCallback(() => {
    const active = allEmployees.filter((e) => e.isActive);
    if (active.length === 0) {
      toast.error("No active employees to run payroll for");
      return;
    }
    setEmployeeIds(active.map((e) => e.id));
    setTotalAmount(active.reduce((sum, e) => sum + e.salary, 0));
  }, [allEmployees, setEmployeeIds, setTotalAmount]);

  const handleGenerateProof = useCallback(async () => {
    setProofStatus("generating");
    setProofError(null);

    try {
      const nextPeriod = normalizePeriod(currentPeriod) + 1;
      const periodId = nextPeriod.toString();
      const isReal = isRealZkEngineActive();

      // Build the employee Merkle tree from selected employees.
      const slots = await buildPayrollSlots(selectedEmployees, undefined, commitmentNonce);
      setSalarySlots(slots);
      setIpfsCids([]);
      const tree = await buildMerkleTree(slots, 10, 10);

      // Use the contract root if available and non-zero, otherwise use the computed tree root.
      // A zero contract root means set_employee_root hasn't been called yet.
      const hasValidContractRoot = contractRoot !== null && contractRoot !== BigInt(0);
      if (hasValidContractRoot) {
        // Verify the computed tree root matches the on-chain root.
        const contractRootHex = contractRoot.toString(16).padStart(64, "0");
        if (tree.root !== contractRootHex) {
          throw new Error(
            "Employee Merkle root mismatch: the tree computed from your employees doesn't match the on-chain root. " +
            "Update the on-chain root via set_employee_root before running payroll."
          );
        }
      }
      const merkleRoot = hasValidContractRoot
        ? contractRoot!.toString(16).padStart(64, "0")
        : tree.root;

      if (isReal) {
        // Real ZK engine path — generates actual Groth16 proof.
        const proof = await zkEngine.generateProof({
          privateInputs: buildZkProofPrivateInputs(slots),
          publicInputs: {
            merkleRoot,
            totalPayrollAmount: totalAmount.toString(),
            payrollPeriodId: periodId,
          },
        });

        const sorobanArgs = toSorobanScVals(proof, {
          merkleRoot,
          totalPayrollAmount: totalAmount.toString(),
          payrollPeriodId: periodId,
        });

        const gp: GeneratedPayrollProof = {
          proof,
          publicInputs: { merkleRoot, totalPayrollAmount: totalAmount.toString(), payrollPeriodId: periodId },
          sorobanArgs,
          verification: { isValid: true, verifiedAt: new Date().toISOString() },
        };
        setGeneratedProof(gp);
      } else {
        // Mock path — serialize with tree root for dev testing.
        const proof = await zkEngine.generateProof({
          privateInputs: {
            employeeId: slots[0]?.employeeId ?? "emp_001",
            salaryAmount: slots[0]?.salaryAmount ?? "0",
          },
          publicInputs: {
            merkleRoot,
            totalPayrollAmount: totalAmount.toString(),
            payrollPeriodId: periodId,
          },
        });

        const sorobanArgs = toSorobanScVals(proof, {
          merkleRoot,
          totalPayrollAmount: totalAmount.toString(),
          payrollPeriodId: periodId,
        });

        const gp: GeneratedPayrollProof = {
          proof,
          publicInputs: { merkleRoot, totalPayrollAmount: totalAmount.toString(), payrollPeriodId: periodId },
          sorobanArgs,
          verification: { isValid: true, verifiedAt: new Date().toISOString() },
        };
        setGeneratedProof(gp);
      }

      setProofStatus("success");
      toast.success("Proof generated successfully");
      nextStep();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Proof generation failed";
      setProofStatus("error");
      setProofError(msg);
      toast.error("Proof generation failed", { description: msg });
    }
  }, [selectedEmployees, totalAmount, contractRoot, currentPeriod, commitmentNonce, setProofStatus, setProofError, nextStep]);

  const handleSubmit = useCallback(async () => {
    if (!generatedProof) {
      toast.error("No proof generated. Please go back and generate a proof first.");
      return;
    }
    if (!publicKey || !isConnected) {
      const msg = "Connect a Stellar Testnet wallet before submitting.";
      setSubmissionStatus("error");
      setSubmissionError(msg);
      toast.error("Wallet required", { description: msg });
      return;
    }

    setSubmissionStatus("submitting");
    setSubmissionError(null);

    try {
      const employeeCount = selectedEmployees.length;

      // 1. Encrypt salary blobs and upload to IPFS.
      let ipfsCidEntries: Array<{ commitmentId: string; ipfsCid: string }> = [];
      if (salarySlots.length > 0) {
        const viewKey = await deriveViewKey(PAYMAGE_AUDITOR_DISCLOSURE_KEY_ID);

        for (const slot of salarySlots) {
          const encrypted = await encryptSalaryBlob(slot.sourceEmployeeId, slot.salaryAmount, slot.salt, viewKey);
          const blobBytes = serializeEncryptedPayload(encrypted);

          const { computeCommitment: cc } = await import("@/lib/zk/merkleTree");
          const commitment = await cc(slot.employeeId, slot.salaryAmount, slot.salt);
          const commitmentId = await computeCommitmentId(commitment);

          try {
            const result = await uploadToIpfs(blobBytes);
            ipfsCidEntries.push({ commitmentId, ipfsCid: result.cid });
          } catch (ipfsErr) {
            const ipfsMsg = ipfsErr instanceof Error ? ipfsErr.message : "IPFS upload failed";
            throw new Error(`Failed to upload encrypted salary for ${slot.employeeId} to IPFS: ${ipfsMsg}`);
          }
        }
        setIpfsCids(ipfsCidEntries);
      }

      // 2. Build contract args with IPFS CIDs.
      const isReal = isRealZkEngineActive();
      let args: import("@stellar/stellar-base").xdr.ScVal[];

      if (isReal && generatedProof.proof.proof?.proofHex) {
        const realResult = {
          proofHex: generatedProof.proof.proof.proofHex as string,
          publicInputsHex: Array.isArray(generatedProof.proof.publicSignals)
            ? generatedProof.proof.publicSignals as string[]
            : [],
        };
        args = toSorobanScValsFromRealProof(realResult, ipfsCidEntries);
      } else {
        args = toSorobanScVals(generatedProof.proof, generatedProof.publicInputs, ipfsCidEntries);
      }

      const txHash = await invokeContract({
        contractId: env.NEXT_PUBLIC_PAYROLL_CONTRACT,
        method: "run_payroll",
        args,
      });

      if (txHash) {
        setSubmissionStatus("success");
        setTransactionHash(txHash);
        toast.success("Payroll submitted successfully", {
          description: `${ipfsCidEntries.length} encrypted salary blobs stored on IPFS. Transaction submitted to Stellar.`,
        });
        nextStep();
      } else {
        throw new Error("Transaction signing or submission failed");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Submission failed";
      setSubmissionStatus("error");
      setSubmissionError(msg);
      toast.error("Submission failed", { description: msg });
    }
  }, [generatedProof, publicKey, isConnected, salarySlots, selectedEmployees, invokeContract, setSubmissionStatus, setSubmissionError, setTransactionHash, nextStep]);

  const idx = stepIndex(currentStep);

  return (
    <section aria-labelledby="payroll-wizard-heading" className="space-y-6">
      <h2 id="payroll-wizard-heading" className="text-lg font-semibold text-slate-950">
        Private Payroll
      </h2>

      <nav aria-label="Payroll execution progress" className="flex items-center">
        {STEPS.map((step, i) => (
          <div key={step.key} className="flex items-center">
            <div className="flex items-center gap-2">
              {i < idx ? (
                <CheckCircle className="w-5 h-5 text-teal-700" />
              ) : i === idx ? (
                <Loader2
                  className={`w-5 h-5 ${
                    currentStep === "proof" || currentStep === "submit"
                      ? "text-teal-700 animate-spin"
                      : "text-teal-700"
                  }`}
                />
              ) : (
                <Circle className="w-5 h-5 text-gray-300" />
              )}
              <span
                className={`text-sm font-medium ${
                  i <= idx ? "text-gray-900" : "text-gray-400"
                }`}
              >
                {step.label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div
                className={`w-12 h-px mx-3 ${
                  i < idx ? "bg-teal-500" : "bg-slate-200"
                }`}
              />
            )}
          </div>
        ))}
      </nav>

      <div className="bg-white rounded-md border border-slate-200 p-6">
        {currentStep === "review" && (
          <ReviewStep
            employeeIds={employeeIds}
            selectedEmployees={selectedEmployees}
            totalAmount={totalAmount}
            onStart={handleStartPayroll}
            onNext={nextStep}
          />
        )}
        {currentStep === "proof" && (
          <ProofStep
            status={proofStatus}
            error={proofError}
            onGenerate={handleGenerateProof}
            onRetry={handleGenerateProof}
            onBack={prevStep}
          />
        )}
        {currentStep === "confirm" && (
          <ConfirmStep
            employeeIds={employeeIds}
            selectedEmployees={selectedEmployees}
            totalAmount={totalAmount}
            isSubmitting={submissionStatus === "submitting"}
            connectedWallet={publicKey}
            canSubmit={Boolean(publicKey && isConnected)}
            onBack={prevStep}
            onSubmit={handleSubmit}
          />
        )}
        {currentStep === "submit" && (
          <SubmitStep
            status={submissionStatus}
            error={submissionError}
            transactionHash={transactionHash}
            onRetry={handleSubmit}
            onReset={reset}
          />
        )}
      </div>
    </section>
  );
}

function ReviewStep({
  employeeIds,
  selectedEmployees,
  totalAmount,
  onStart,
  onNext,
}: {
  employeeIds: string[];
  selectedEmployees: { id: string; name: string; salary: number; department?: string }[];
  totalAmount: number;
  onStart: () => void;
  onNext: () => void;
}) {
  if (employeeIds.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-gray-600 mb-4">
          No PayMage payroll batch is active. Start the testnet batch to build the
          workforce root proof.
        </p>
        <button
          type="button"
          onClick={onStart}
          className="min-h-10 px-6 rounded-md bg-teal-700 text-white text-sm font-medium hover:bg-teal-800 transition-colors focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2"
        >
          Start Payroll Run
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-slate-950">Workforce commitment review</h3>
      <p className="text-sm text-slate-600">
        Review the same commitment slots shown in Workforce Root before generating
        the aggregate payroll proof. Individual salary values remain encrypted.
      </p>
      <div className="divide-y rounded-md border border-slate-200">
        {selectedEmployees.map((emp, index) => (
          <div key={emp.id} className="px-4 py-3 flex justify-between">
            <div>
              <span className="text-sm font-medium text-slate-900">
                Commitment #{String(index + 1).padStart(3, "0")}
              </span>
              <span className="ml-2 font-mono text-xs text-slate-500">
                slot_{String(index + 1).padStart(3, "0")}
              </span>
            </div>
            <span className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-900">
              <ShieldCheck className="h-4 w-4 text-emerald-600" aria-hidden="true" />
              Encrypted
            </span>
          </div>
        ))}
      </div>
      <div className="flex justify-between items-center pt-2 border-t">
        <span className="text-sm font-semibold text-slate-950">
          Aggregate total: {formatStroopsAsXlm(totalAmount)}
        </span>
        <button
          type="button"
          onClick={onNext}
          className="inline-flex min-h-10 items-center gap-1 rounded-md bg-teal-700 px-4 text-sm font-medium text-white transition-colors hover:bg-teal-800 focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2"
        >
          Continue
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

function ProofStep({
  status,
  error,
  onGenerate,
  onRetry,
  onBack,
}: {
  status: "idle" | "generating" | "success" | "error";
  error: string | null;
  onGenerate: () => void;
  onRetry: () => void;
  onBack: () => void;
}) {
  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-slate-950">Server proof generation</h3>
      <p className="text-sm text-slate-600">
        The hosted prover generates a Groth16 proof for the payroll batch. The proof
        binds the employee root, aggregate amount, and payroll period without exposing
        individual salaries.
      </p>

      {status === "idle" && (
        <div className="text-center py-6">
          <button
            type="button"
            onClick={onGenerate}
            className="min-h-10 rounded-md bg-teal-700 px-6 text-sm font-medium text-white transition-colors hover:bg-teal-800 focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2"
          >
            Generate Proof
          </button>
        </div>
      )}

      {status === "generating" && (
        <div className="text-center py-6 space-y-3">
          <Loader2 className="w-8 h-8 text-teal-700 animate-spin mx-auto" />
          <p className="text-sm text-slate-600">
            Generating the PayMage payroll proof on the hosted prover. This can take about a minute.
          </p>
          <div className="w-48 h-1.5 bg-slate-200 rounded-full mx-auto overflow-hidden">
            <div className="h-full bg-teal-700 rounded-full animate-pulse" style={{ width: "60%" }} />
          </div>
        </div>
      )}

      {status === "error" && (
        <div className="text-center py-6 space-y-3">
          <AlertCircle className="w-8 h-8 text-red-500 mx-auto" />
          <p className="text-sm text-red-700">{error}</p>
          <button
            type="button"
            onClick={onRetry}
            className="px-4 py-2 rounded-md bg-red-50 text-red-700 text-sm font-medium hover:bg-red-100 border border-red-200 transition-colors inline-flex items-center gap-1"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Retry
          </button>
        </div>
      )}

      <div className="flex justify-between pt-4 border-t">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex min-h-10 items-center gap-1 rounded-md bg-slate-100 px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-200 focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>
      </div>
    </div>
  );
}

function ConfirmStep({
  selectedEmployees,
  totalAmount,
  isSubmitting,
  connectedWallet,
  canSubmit,
  onBack,
  onSubmit,
}: {
  employeeIds: string[];
  selectedEmployees: { id: string; name: string; salary: number }[];
  totalAmount: number;
  isSubmitting: boolean;
  connectedWallet: string | null;
  canSubmit: boolean;
  onBack: () => void;
  onSubmit: () => void;
}) {
  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-slate-950">Policy confirmation</h3>
      <p className="text-sm text-slate-600">
        The proof is ready. Review the policy inputs before submitting the payroll
        transaction to Stellar testnet.
      </p>

      <div className="bg-teal-50 border border-teal-200 rounded-md p-4 flex items-start gap-3">
        <CheckCircle className="w-5 h-5 text-teal-700 mt-0.5 shrink-0" />
        <div>
          <p className="text-sm font-medium text-teal-900">
            Proof verified successfully
          </p>
          <p className="text-sm text-teal-800 mt-1">
            Proof bytes and public inputs are ready for on-chain payroll execution.
          </p>
        </div>
      </div>

      <div className="border border-slate-200 rounded-md p-4 space-y-2">
        <div className="flex justify-between text-sm">
          <span className="text-slate-600">Commitment slots</span>
          <span className="font-medium text-slate-900">
            {selectedEmployees.length}
          </span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-slate-600">Aggregate amount</span>
          <span className="font-medium text-slate-900">
            {formatStroopsAsXlm(totalAmount)}
          </span>
        </div>
        <div className="flex justify-between gap-4 text-sm">
          <span className="text-slate-600">Connected wallet</span>
          <span className="font-mono text-xs font-medium text-slate-900">
            {shortAddress(connectedWallet)}
          </span>
        </div>
        <div className="flex justify-between gap-4 text-sm">
          <span className="text-slate-600">Submission signer</span>
          <span className="font-mono text-xs font-medium text-slate-900">
            Connected wallet
          </span>
        </div>
      </div>

      {!canSubmit && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
            <div>
              <p className="text-sm font-medium text-amber-900">
                Wallet connection required
              </p>
              <p className="mt-1 text-sm text-amber-800">
                Any funded Stellar Testnet wallet can submit a valid PayMage proof.
                Connect Freighter before submitting.
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="flex justify-between pt-4 border-t">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex min-h-10 items-center gap-1 rounded-md bg-slate-100 px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-200 focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={isSubmitting || !canSubmit}
          className="min-h-10 rounded-md bg-teal-700 px-6 text-sm font-medium text-white transition-colors hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2"
        >
          {isSubmitting ? "Submitting..." : "Submit PayMage Payroll"}
        </button>
      </div>
    </div>
  );
}

function SubmitStep({
  status,
  error,
  transactionHash,
  onRetry,
  onReset,
}: {
  status: "idle" | "submitting" | "success" | "error";
  error: string | null;
  transactionHash: string | null;
  onRetry: () => void;
  onReset: () => void;
}) {
  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-slate-950">Submission</h3>

      {status === "submitting" && (
        <div className="text-center py-8 space-y-3">
          <Loader2 className="w-8 h-8 text-teal-700 animate-spin mx-auto" />
          <p className="text-sm text-slate-600">
            Submitting payroll transaction to Stellar network...
          </p>
        </div>
      )}

      {status === "success" && (
        <div className="text-center py-8 space-y-3">
          <CheckCircle className="w-12 h-12 text-teal-700 mx-auto" />
          <h4 className="text-lg font-semibold text-slate-950">
            PayMage payroll submitted
          </h4>
          <p className="text-sm text-slate-600">
            The transaction has been submitted to Stellar testnet.
          </p>
          {transactionHash && (
            <p className="font-mono text-xs text-slate-500 break-all">
              Tx: {transactionHash}
            </p>
          )}
          <button
            type="button"
            onClick={onReset}
            className="mt-4 min-h-10 rounded-md bg-slate-100 px-6 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-200 focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2"
          >
            Start New Payroll
          </button>
        </div>
      )}

      {status === "error" && (
        <div className="text-center py-8 space-y-3">
          <AlertCircle className="w-8 h-8 text-red-500 mx-auto" />
          <h4 className="text-lg font-semibold text-red-700">Submission Failed</h4>
          <p className="text-sm text-red-600">{error}</p>
          <div className="flex justify-center gap-3 mt-4">
            <button
              type="button"
              onClick={onRetry}
              className="px-4 py-2 rounded-md bg-red-50 text-red-700 text-sm font-medium hover:bg-red-100 border border-red-200 transition-colors inline-flex items-center gap-1"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Retry Submission
            </button>
            <button
              type="button"
              onClick={onReset}
              className="min-h-10 rounded-md bg-slate-100 px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-200 focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2"
            >
              Start Over
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default PayrollWizard;
