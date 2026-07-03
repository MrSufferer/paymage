"use client";

import { useState, useCallback } from "react";
import {
  Key,
  Plus,
  Shield,
  AlertTriangle,
  Clock,
  CheckCircle,
  XCircle,
  Copy,
  Eye,
  EyeOff,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import * as StellarSdk from "@stellar/stellar-sdk";
import { Server } from "@stellar/stellar-sdk/rpc";
import { useViewKeyStore } from "@/stores/viewKeys";
import { useWalletStore, NETWORK_PASSPHRASES } from "@/stores/walletStore";
import { MOCK_VIEW_KEYS } from "@/lib/api/mockData";
import { env } from "@/lib/env";
import type { ViewKey } from "@/types";

function isStellarAddress(address: string): boolean {
  return /^G[A-Z2-7]{55}$/.test(address);
}

function generateKeyId(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "vk_";
  for (let i = 0; i < 12; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

function ComplianceManager() {
  const { viewKeys, addViewKey, revokeViewKey, setViewKeys } =
    useViewKeyStore();
  const { publicKey, isConnected, network } = useWalletStore();
  const [initialized, setInitialized] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [isContractCall, setIsContractCall] = useState(false);
  const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set());
  const [form, setForm] = useState({
    auditorName: "",
    auditorOrg: "",
    auditorAddress: "",
    scope: "read-only" as "read-only" | "full-audit",
  });
  const [copiedId, setCopiedId] = useState<string | null>(null);

  if (!initialized && viewKeys.length === 0) {
    setViewKeys(MOCK_VIEW_KEYS);
    setInitialized(true);
  }

  const callContract = useCallback(
    async (method: string, args: StellarSdk.xdr.ScVal[]) => {
      if (!publicKey || !isConnected) {
        throw new Error("Wallet not connected");
      }
      const server = new Server(
        network === "TESTNET"
          ? "https://soroban-testnet.stellar.org"
          : "https://soroban-rpc.stellar.org",
      );
      const source = await server.getAccount(publicKey);
      const contract = new StellarSdk.Contract(env.NEXT_PUBLIC_PAYROLL_CONTRACT);
      const tx = new StellarSdk.TransactionBuilder(source, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase: NETWORK_PASSPHRASES[network],
      })
        .addOperation(contract.call(method, ...args))
        .setTimeout(30)
        .build();

      const sim = await server.simulateTransaction(tx);
      if (StellarSdk.rpc.Api.isSimulationError(sim)) {
        throw new Error(`Simulation failed: ${sim.error}`);
      }

      const prepared = StellarSdk.rpc.assembleTransaction(tx, sim).build();
      const { signTransaction } = await import("@stellar/freighter-api");
      const { signedTxXdr, error: signError } = await signTransaction(
        prepared.toXDR(),
        {
          networkPassphrase: NETWORK_PASSPHRASES[network],
          address: publicKey,
        },
      );
      if (signError) throw new Error(signError.message || "Signing cancelled");
      if (!signedTxXdr) throw new Error("Signing cancelled");

      const signedTx = StellarSdk.TransactionBuilder.fromXDR(
        signedTxXdr,
        NETWORK_PASSPHRASES[network],
      );
      const result = await server.sendTransaction(signedTx);
      if (result.status === "ERROR") {
        throw new Error(`Transaction failed: ${result.errorResult}`);
      }
      return result.hash;
    },
    [publicKey, isConnected, network],
  );

  const handleGenerate = async () => {
    if (!form.auditorAddress || !isStellarAddress(form.auditorAddress)) {
      toast.error("Valid Stellar auditor address required");
      return;
    }
    setIsContractCall(true);
    try {
      const auditorAddr = StellarSdk.Address.fromString(form.auditorAddress).toScVal();
      const encryptedKey = StellarSdk.nativeToScVal(
        `enc:${generateKeyId()}`,
        { type: "bytes" },
      );
      await callContract("set_view_key_for_auditor", [auditorAddr, encryptedKey]);

      const newKey: ViewKey = {
        id: `vk_${Date.now()}`,
        keyId: generateKeyId(),
        auditorName: form.auditorName,
        auditorOrg: form.auditorOrg,
        auditorAddress: form.auditorAddress,
        scope: form.scope,
        grantedBy: publicKey ?? "Unknown",
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
        isActive: true,
      };
      addViewKey(newKey);
      setForm({ auditorName: "", auditorOrg: "", auditorAddress: "", scope: "read-only" });
      setShowForm(false);
      toast.success("View key generated", {
        description: "Auditor access granted on-chain.",
      });
    } catch (err) {
      toast.error("Failed to grant auditor access", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setIsContractCall(false);
    }
  };

  const handleRevoke = async (id: string) => {
    const key = viewKeys.find((k) => k.id === id);
    if (!key?.auditorAddress) {
      revokeViewKey(id);
      toast.success("View key revoked locally");
      return;
    }
    setIsContractCall(true);
    try {
      const auditorAddr = StellarSdk.Address.fromString(key.auditorAddress).toScVal();
      await callContract("revoke_auditor", [auditorAddr]);

      revokeViewKey(id);
      toast.success("View key revoked", {
        description: "Auditor access revoked on-chain.",
      });
    } catch (err) {
      toast.error("Failed to revoke auditor", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setIsContractCall(false);
    }
  };

  const toggleReveal = (id: string) => {
    setRevealedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const copyKeyId = async (keyId: string, id: string) => {
    await navigator.clipboard.writeText(keyId);
    setCopiedId(id);
    toast.success("Copied to clipboard", {
      description: "Key ID copied to clipboard.",
    });
    setTimeout(() => setCopiedId(null), 2000);
  };

  const activeKeys = viewKeys.filter((k) => k.isActive);
  const inactiveKeys = viewKeys.filter((k) => !k.isActive);

  return (
    <section aria-labelledby="compliance-heading" className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2
            id="compliance-heading"
            className="text-lg font-semibold text-gray-900"
          >
            Auditor Access Management
          </h2>
          <p className="text-sm text-gray-600 mt-1">
            Manage view-key access for external auditors. Selective disclosure
            ensures auditors see only what they are authorized to review.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowForm(!showForm)}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Generate Key
        </button>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <Shield className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
          <div>
            <h3 className="text-sm font-medium text-amber-800">
              Privacy Notice
            </h3>
            <p className="text-sm text-amber-700 mt-1">
              View keys allow auditors to decrypt specific payroll data without
              exposing full employee records. Read-only keys permit viewing
              transaction summaries. Full-audit keys additionally reveal
              departmental breakdowns. Revoking a key immediately invalidates
              access, but data already viewed cannot be retrieved.
            </p>
          </div>
        </div>
      </div>

      {showForm && (
        <div
          role="form"
          aria-label="Generate new view key"
          className="bg-white rounded-lg border p-6 space-y-4"
        >
          <h3 className="text-sm font-semibold text-gray-900">
            New Auditor View Key
          </h3>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
              <div>
                <label
                  htmlFor="auditor-name"
                  className="block text-xs font-medium text-gray-600 mb-1"
                >
                  Auditor Name
                </label>
                <input
                  id="auditor-name"
                  type="text"
                  value={form.auditorName}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, auditorName: e.target.value }))
                  }
                  placeholder="e.g. Sarah Chen"
                  className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                />
              </div>
              <div>
                <label
                  htmlFor="auditor-org"
                  className="block text-xs font-medium text-gray-600 mb-1"
                >
                  Organization
                </label>
                <input
                  id="auditor-org"
                  type="text"
                  value={form.auditorOrg}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, auditorOrg: e.target.value }))
                  }
                  placeholder="e.g. Deloitte"
                  className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                />
              </div>
              <div>
                <label
                  htmlFor="auditor-address"
                  className="block text-xs font-medium text-gray-600 mb-1"
                >
                  Stellar Address
                </label>
                <input
                  id="auditor-address"
                  type="text"
                  value={form.auditorAddress}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, auditorAddress: e.target.value }))
                  }
                  placeholder="G..."
                  className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm font-mono focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                />
              </div>
              <div>
                <label
                  htmlFor="auditor-scope"
                  className="block text-xs font-medium text-gray-600 mb-1"
                >
                  Access Scope
                </label>
                <select
                  id="auditor-scope"
                  value={form.scope}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      scope: e.target.value as "read-only" | "full-audit",
                    }))
                  }
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                >
                  <option value="read-only">Read-only</option>
                  <option value="full-audit">Full Audit</option>
                </select>
              </div>
            </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleGenerate}
              disabled={isContractCall || !form.auditorName || !form.auditorOrg || !form.auditorAddress}
              className="px-4 py-2 rounded-md text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors inline-flex items-center gap-1.5"
            >
              {isContractCall ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Generate
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="px-4 py-2 rounded-md text-sm font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {activeKeys.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-green-600" />
            Active Keys ({activeKeys.length})
          </h3>
          <div className="bg-white rounded-lg border divide-y">
            {activeKeys.map((key) => (
              <ViewKeyRow
                key={key.id}
                viewKey={key}
                isRevealed={revealedKeys.has(key.id)}
                isCopied={copiedId === key.id}
                onToggleReveal={() => toggleReveal(key.id)}
                onCopy={() => copyKeyId(key.keyId, key.id)}
                onRevoke={() => handleRevoke(key.id)}
              />
            ))}
          </div>
        </div>
      )}

      {inactiveKeys.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
            <XCircle className="w-4 h-4 text-gray-400" />
            Revoked Keys ({inactiveKeys.length})
          </h3>
          <div className="bg-white rounded-lg border divide-y opacity-75">
            {inactiveKeys.map((key) => (
              <ViewKeyRow
                key={key.id}
                viewKey={key}
                isRevealed={revealedKeys.has(key.id)}
                isCopied={copiedId === key.id}
                onToggleReveal={() => toggleReveal(key.id)}
                onCopy={() => copyKeyId(key.keyId, key.id)}
                onRevoke={() => {}}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function ViewKeyRow({
  viewKey,
  isRevealed,
  isCopied,
  onToggleReveal,
  onCopy,
  onRevoke,
}: {
  viewKey: ViewKey;
  isRevealed: boolean;
  isCopied: boolean;
  onToggleReveal: () => void;
  onCopy: () => void;
  onRevoke: () => void;
}) {
  const isExpired =
    !viewKey.isActive && !viewKey.revokedAt;
  const displayKey = isRevealed
    ? viewKey.keyId
    : viewKey.keyId.slice(0, 6) + "****";

  return (
    <div className="px-6 py-4 flex items-center justify-between gap-4">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <Key className="w-4 h-4 text-gray-400 shrink-0" />
          <span className="font-mono text-sm text-gray-900">{displayKey}</span>
          <button
            type="button"
            onClick={onToggleReveal}
            className="p-0.5 text-gray-400 hover:text-gray-600 transition-colors"
            aria-label={isRevealed ? "Hide key" : "Reveal key"}
          >
            {isRevealed ? (
              <EyeOff className="w-3.5 h-3.5" />
            ) : (
              <Eye className="w-3.5 h-3.5" />
            )}
          </button>
          <button
            type="button"
            onClick={onCopy}
            className="p-0.5 text-gray-400 hover:text-gray-600 transition-colors"
            aria-label="Copy key ID"
          >
            <Copy className="w-3.5 h-3.5" />
            {isCopied && (
              <span className="text-xs text-green-600 ml-1">Copied</span>
            )}
          </button>
        </div>
        <p className="text-sm text-gray-600 mt-1">
          {viewKey.auditorName} &middot; {viewKey.auditorOrg}
        </p>
        <div className="flex items-center gap-3 mt-1">
          <span
            className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full ${
              viewKey.isActive
                ? viewKey.scope === "full-audit"
                  ? "bg-purple-100 text-purple-800"
                  : "bg-blue-100 text-blue-800"
                : "bg-gray-100 text-gray-600"
            }`}
          >
            {viewKey.scope === "full-audit" ? "Full Audit" : "Read-only"}
          </span>
          <span className="text-xs text-gray-500 flex items-center gap-1">
            <Clock className="w-3 h-3" />
            Expires {new Date(viewKey.expiresAt).toLocaleDateString()}
          </span>
          {viewKey.revokedAt && (
            <span className="text-xs text-red-500">
              Revoked {new Date(viewKey.revokedAt).toLocaleDateString()}
            </span>
          )}
        </div>
      </div>
      {viewKey.isActive && (
        <button
          type="button"
          onClick={onRevoke}
          className="shrink-0 px-3 py-1.5 rounded-md text-xs font-medium bg-red-50 text-red-700 hover:bg-red-100 border border-red-200 transition-colors flex items-center gap-1"
        >
          <AlertTriangle className="w-3 h-3" />
          Revoke
        </button>
      )}
    </div>
  );
}

export default ComplianceManager;
