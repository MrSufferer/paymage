"use client";

import { useState, useCallback, useEffect } from "react";
import { TreePine, Loader2, CheckCircle, AlertCircle, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import * as StellarSdk from "@stellar/stellar-sdk";
import { Server } from "@stellar/stellar-sdk/rpc";
import { useWalletStore, NETWORK_PASSPHRASES } from "@/stores/walletStore";
import { useEmployeeStore } from "@/stores/employees";
import { useStellar } from "@/components/providers/StellarProvider";
import { buildMerkleTree } from "@/lib/zk/merkleTree";
import { buildPayrollSlots } from "@/lib/zk/payrollInputs";
import { PAYMAGE_PROTOCOL, PAYMAGE_TESTNET_EMPLOYEES } from "@/lib/protocol/paymage";
import { submitAndConfirmSorobanTransaction } from "@/lib/stellar/transactions";
import { env } from "@/lib/env";

function SetEmployeeRoot() {
  const { publicKey, isConnected, network } = useWalletStore();
  const { signTx } = useStellar();
  const storedEmployees = useEmployeeStore((state) => state.employees);
  const rotateCommitmentNonce = useEmployeeStore((state) => state.rotateCommitmentNonce);
  const [contractRoot, setContractRoot] = useState<string | null>(null);
  const [treeRoot, setTreeRoot] = useState<string | null>(null);
  const [isBuilding, setIsBuilding] = useState(false);
  const [isPosting, setIsPosting] = useState(false);
  const [isLoadingRoot, setIsLoadingRoot] = useState(false);
  const [lastPostedRoot, setLastPostedRoot] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const employees = storedEmployees.length > 0 ? storedEmployees : PAYMAGE_TESTNET_EMPLOYEES;
  const activeEmployees = employees.filter((e) => e.isActive);
  const isPayrollAdmin = Boolean(publicKey && publicKey === PAYMAGE_PROTOCOL.admin);

  const fetchContractRoot = useCallback(async () => {
    if (!env.NEXT_PUBLIC_PAYROLL_CONTRACT) return;
    setIsLoadingRoot(true);
    setError(null);
    try {
      const server = new Server(
        network === "TESTNET"
          ? "https://soroban-testnet.stellar.org"
          : "https://soroban-rpc.stellar.org",
      );
      const contract = new StellarSdk.Contract(env.NEXT_PUBLIC_PAYROLL_CONTRACT);
      const tx = new StellarSdk.TransactionBuilder(
        await server.getAccount(publicKey ?? "GBXQBIZWREYHXIEVLXHOMYNWOIMG7DA3NNBSMZ4V5HWPP5MWZOWGRWAY"),
        { fee: "100", networkPassphrase: NETWORK_PASSPHRASES[network] },
      )
        .addOperation(contract.call("get_employee_root"))
        .setTimeout(30)
        .build();

      const sim = await server.simulateTransaction(tx);
      if (StellarSdk.rpc.Api.isSimulationError(sim)) {
        setContractRoot(null);
        return;
      }
      if (sim.result?.retval) {
        setContractRoot(StellarSdk.scValToNative(sim.result.retval));
      }
    } catch (err) {
      setContractRoot(null);
    } finally {
      setIsLoadingRoot(false);
    }
  }, [publicKey, network]);

  useEffect(() => {
    if (env.NEXT_PUBLIC_PAYROLL_CONTRACT) {
      fetchContractRoot();
    }
  }, [fetchContractRoot]);

  const handleBuildTree = useCallback(async () => {
    if (activeEmployees.length === 0) {
      toast.error("No active employees to build tree from");
      return;
    }
    setIsBuilding(true);
    setError(null);
    try {
      const nextCommitmentNonce = rotateCommitmentNonce();
      const slots = await buildPayrollSlots(activeEmployees, undefined, nextCommitmentNonce);
      const tree = await buildMerkleTree(slots, 10, 10);
      setTreeRoot(tree.root);
      toast.success("Merkle tree built", {
        description: `Root: ${tree.root.slice(0, 16)}... (${tree.actualEmployeeCount} employees)`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Tree build failed";
      setError(msg);
      toast.error("Failed to build Merkle tree", { description: msg });
    } finally {
      setIsBuilding(false);
    }
  }, [activeEmployees, rotateCommitmentNonce]);

  const handlePostRoot = useCallback(async () => {
    if (!treeRoot || !publicKey || !isConnected) {
      toast.error("Connect wallet and build tree first");
      return;
    }
    if (!isPayrollAdmin) {
      setIsPosting(true);
      setError(null);
      try {
        const challengeResponse = await fetch(
          `/api/auth/challenge?publicKey=${encodeURIComponent(publicKey)}`,
          { cache: "no-store" },
        );
        const challenge = await challengeResponse.json();
        if (!challengeResponse.ok) {
          throw new Error(challenge.error ?? `Challenge returned ${challengeResponse.status}`);
        }

        const signedXdr = await signTx(challenge.txXdr);
        if (!signedXdr) {
          throw new Error("Wallet challenge signing was cancelled.");
        }

        const sessionResponse = await fetch("/api/auth/session", {
          method: "POST",
          headers: { "content-type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            publicKey,
            token: challenge.token,
            signedXdr,
          }),
        });
        const sessionBody = await sessionResponse.json();
        if (!sessionResponse.ok) {
          throw new Error(sessionBody.error ?? `Session returned ${sessionResponse.status}`);
        }

        const response = await fetch("/api/admin/workforce-root", {
          method: "POST",
          headers: { "content-type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ root: treeRoot }),
        });
        const body = await response.json();
        if (!response.ok || !body.success) {
          throw new Error(body.error ?? `Delegated root update returned ${response.status}`);
        }

        setLastPostedRoot(treeRoot);
        setContractRoot(treeRoot);
        toast.success("Workforce root posted by delegated admin", {
          description: `Transaction hash: ${body.txHash}`,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to post delegated root";
        setError(msg);
        toast.error("Delegated root update failed", { description: msg });
      } finally {
        setIsPosting(false);
      }
      return;
    }
    setIsPosting(true);
    setError(null);
    try {
      const server = new Server(
        network === "TESTNET"
          ? "https://soroban-testnet.stellar.org"
          : "https://soroban-rpc.stellar.org",
      );
      const source = await server.getAccount(publicKey);
      const contract = new StellarSdk.Contract(env.NEXT_PUBLIC_PAYROLL_CONTRACT);
      const rootHex = treeRoot.replace(/^0x/i, "").padStart(64, "0");
      const rootBigInt = BigInt("0x" + rootHex) % BigInt("21888242871839275222246405745257275088548364400416034343698204186575808495617");
      const rootVal = StellarSdk.nativeToScVal(rootBigInt, { type: "u256" });

      const tx = new StellarSdk.TransactionBuilder(source, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase: NETWORK_PASSPHRASES[network],
      })
        .addOperation(contract.call("set_employee_root", rootVal))
        .setTimeout(30)
        .build();

      const sim = await server.simulateTransaction(tx);
      if (StellarSdk.rpc.Api.isSimulationError(sim)) {
        throw new Error(`Simulation failed: ${sim.error}`);
      }

      const prepared = StellarSdk.rpc.assembleTransaction(tx, sim).build();
      const { signTransaction } = await import("@stellar/freighter-api");
      const { signedTxXdr, error: signError } = await signTransaction(prepared.toXDR(), {
        networkPassphrase: NETWORK_PASSPHRASES[network],
        address: publicKey,
      });
      if (signError) throw new Error(signError.message || "Signing cancelled");
      if (!signedTxXdr) throw new Error("Signing cancelled");

      const signedTx = StellarSdk.TransactionBuilder.fromXDR(signedTxXdr, NETWORK_PASSPHRASES[network]);
      const result = await submitAndConfirmSorobanTransaction(server, signedTx);
      setLastPostedRoot(treeRoot);
      setContractRoot(treeRoot);
      toast.success("Employee root posted", {
        description: `Transaction hash: ${result.hash}`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to post root";
      setError(msg);
      toast.error("Failed to post root", { description: msg });
    } finally {
      setIsPosting(false);
    }
  }, [treeRoot, publicKey, isConnected, isPayrollAdmin, network, signTx]);

  const needsUpdate = treeRoot && treeRoot !== contractRoot;
  const isPosted = lastPostedRoot && lastPostedRoot === contractRoot;

  return (
    <div className="bg-white rounded-lg border p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <TreePine className="w-5 h-5 text-green-600" />
          <h3 className="text-sm font-semibold text-gray-900">Employee Merkle Tree</h3>
        </div>
        <button
          type="button"
          onClick={fetchContractRoot}
          disabled={isLoadingRoot}
          className="p-1.5 text-gray-400 hover:text-gray-600 transition-colors"
          aria-label="Refresh contract root"
        >
          <RefreshCw className={`w-4 h-4 ${isLoadingRoot ? "animate-spin" : ""}`} />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4 text-sm">
        <div className="space-y-1">
          <span className="text-gray-500">Contract root</span>
          <div className="font-mono text-xs text-gray-900 truncate">
            {isLoadingRoot ? (
              <span className="text-gray-400">Loading...</span>
            ) : contractRoot ? (
              contractRoot
            ) : (
              <span className="text-gray-400">Not set</span>
            )}
          </div>
        </div>
        <div className="space-y-1">
          <span className="text-gray-500">Active employees</span>
          <div className="font-mono text-sm text-gray-900">{activeEmployees.length}</div>
        </div>
      </div>

      {!isPayrollAdmin ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          This connected wallet can post a workforce root through PayMage delegated
          testnet admin after signing a Freighter challenge. The contract transaction
          is still submitted by {PAYMAGE_PROTOCOL.admin.slice(0, 6)}...
          {PAYMAGE_PROTOCOL.admin.slice(-6)}.
        </div>
      ) : null}

      {error && (
        <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
          <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
          <p className="text-xs text-red-700">{error}</p>
        </div>
      )}

      <div className="flex gap-3">
        <button
          type="button"
          onClick={handleBuildTree}
          disabled={isBuilding || activeEmployees.length === 0}
          className="px-4 py-2 rounded-md bg-gray-100 text-gray-700 text-sm font-medium hover:bg-gray-200 disabled:opacity-50 transition-colors inline-flex items-center gap-1.5"
        >
          {isBuilding ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <TreePine className="w-4 h-4" />
          )}
          Build Tree
        </button>
        <button
          type="button"
          onClick={handlePostRoot}
          disabled={isPosting || !needsUpdate || !isConnected}
          className="px-4 py-2 rounded-md bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors inline-flex items-center gap-1.5"
        >
          {isPosting ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <CheckCircle className="w-4 h-4" />
          )}
          {isPosted ? "Posted" : isPayrollAdmin ? "Post Root" : "Post via Delegated Admin"}
        </button>
      </div>

      {treeRoot && (
        <div className="text-xs text-gray-500 font-mono truncate">
          Tree root: {treeRoot}
        </div>
      )}
    </div>
  );
}

export default SetEmployeeRoot;
