"use client";

import { useCallback, useState } from "react";
import { buildWithdrawScVals } from "@/lib/zk/serialize";
import { useStellar } from "@/components/providers/StellarProvider";
import { useWalletStore } from "@/stores/walletStore";
import { env } from "@/lib/env";
import { Wallet, ArrowDown, CheckCircle, AlertCircle, Loader } from "lucide-react";

type WithdrawStep = "idle" | "generating" | "ready" | "submitting" | "success" | "error";

export default function EmployeeWithdraw() {
  const { connect, invokeContract } = useStellar();
  const publicKey = useWalletStore((s) => s.publicKey);
  const [commitmentRoot, setCommitmentRoot] = useState("");
  const [commitmentId, setCommitmentId] = useState("");
  const [nullifier, setNullifier] = useState("");
  const [salaryAmount, setSalaryAmount] = useState("");

  const [step, setStep] = useState<WithdrawStep>("idle");
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  const isFormValid = commitmentRoot && commitmentId && nullifier && salaryAmount;

  const handleGenerateProof = useCallback(async () => {
    if (!isFormValid) return;
    setStep("generating");
    setError(null);

    try {
      await new Promise((r) => setTimeout(r, 500));
      setStep("ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Proof generation failed");
      setStep("error");
    }
  }, [isFormValid]);

  const handleWithdraw = useCallback(async () => {
    setStep("submitting");
    setError(null);

    try {
      if (!publicKey) {
        setError("Wallet not connected");
        setStep("error");
        return;
      }

      const contractId = env.NEXT_PUBLIC_PAYROLL_CONTRACT;
      if (!contractId) {
        setError("Payroll contract address not configured");
        setStep("error");
        return;
      }

      const mockProofHex = "0x" + "00".repeat(256);
      const mockPublicInputs = [
        commitmentRoot.padStart(64, "0"),
        commitmentId.padStart(64, "0"),
        nullifier.padStart(64, "0"),
        salaryAmount.padStart(64, "0"),
      ];

      const args = buildWithdrawScVals(mockProofHex, mockPublicInputs, publicKey);
      const txHashResult = await invokeContract({
        contractId,
        method: "withdraw",
        args,
      });

      if (txHashResult) {
        setTxHash(txHashResult);
        setStep("success");
      } else {
        setError("Transaction submission returned no hash");
        setStep("error");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Withdrawal failed");
      setStep("error");
    }
  }, [commitmentRoot, commitmentId, nullifier, salaryAmount, publicKey, invokeContract]);

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-2">Withdraw Salary</h1>
      <p className="text-gray-600 mb-6">
        Use your salary commitment data to withdraw privately via a ZK proof.
      </p>

      {/* Wallet status */}
      <div className="flex items-center gap-2 mb-6 p-3 bg-gray-50 rounded-lg">
        <Wallet className="w-5 h-5 text-gray-500" />
        {publicKey ? (
          <span className="text-sm text-green-700">
            Connected: {publicKey.slice(0, 8)}...{publicKey.slice(-4)}
          </span>
        ) : (
          <button
            onClick={connect}
            className="text-sm text-blue-600 hover:text-blue-800"
          >
            Connect Wallet
          </button>
        )}
      </div>

      {/* Commitment data form */}
      <div className="space-y-4 mb-6">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="commitment-root" className="block text-sm font-medium text-gray-700 mb-1">Commitment Root</label>
            <input id="commitment-root"
              className="w-full px-3 py-2 border rounded-lg text-sm font-mono"
              placeholder="0x..."
              value={commitmentRoot}
              onChange={(e) => setCommitmentRoot(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="commitment-id" className="block text-sm font-medium text-gray-700 mb-1">Commitment ID</label>
            <input id="commitment-id"
              className="w-full px-3 py-2 border rounded-lg text-sm font-mono"
              placeholder="0x..."
              value={commitmentId}
              onChange={(e) => setCommitmentId(e.target.value)}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="nullifier" className="block text-sm font-medium text-gray-700 mb-1">Nullifier</label>
            <input id="nullifier"
              className="w-full px-3 py-2 border rounded-lg text-sm font-mono"
              placeholder="0x..."
              value={nullifier}
              onChange={(e) => setNullifier(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="salary-amount" className="block text-sm font-medium text-gray-700 mb-1">Salary Amount (stroops)</label>
            <input id="salary-amount"
              className="w-full px-3 py-2 border rounded-lg text-sm font-mono"
              placeholder="5000000"
              value={salaryAmount}
              onChange={(e) => setSalaryAmount(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-4">
        <button
          onClick={handleGenerateProof}
          disabled={!isFormValid || step === "generating"}
          className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {step === "generating" ? (
            <Loader className="w-5 h-5 animate-spin" />
          ) : (
            <ArrowDown className="w-5 h-5" />
          )}
          Generate Proof
        </button>

        <button
          onClick={handleWithdraw}
          disabled={step !== "ready" || !publicKey}
          className="flex items-center gap-2 px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {step === "submitting" ? (
            <Loader className="w-5 h-5 animate-spin" />
          ) : (
            <CheckCircle className="w-5 h-5" />
          )}
          Withdraw
        </button>
      </div>

      {/* Status */}
      {error && (
        <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2">
          <AlertCircle className="w-5 h-5 text-red-500 mt-0.5 shrink-0" />
          <span className="text-sm text-red-700">{error}</span>
        </div>
      )}

      {txHash && (
        <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-lg">
          <p className="text-sm text-green-700">
            Withdrawal successful! Transaction: {txHash}
          </p>
        </div>
      )}
    </div>
  );
}
