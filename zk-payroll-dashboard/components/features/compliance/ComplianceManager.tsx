"use client";

import { useState, useCallback, useEffect } from "react";
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
  Unlock,
} from "lucide-react";
import { toast } from "sonner";
import * as StellarSdk from "@stellar/stellar-sdk";
import { Server } from "@stellar/stellar-sdk/rpc";
import { useViewKeyStore } from "@/stores/viewKeys";
import { useWalletStore, NETWORK_PASSPHRASES } from "@/stores/walletStore";
import { useStellar } from "@/components/providers/StellarProvider";
import { submitAndConfirmSorobanTransaction } from "@/lib/stellar/transactions";
import { env } from "@/lib/env";
import { useProtocolStatus } from "@/lib/protocol/useProtocolStatus";
import { PAYMAGE_AUDITOR_DISCLOSURE_KEY_ID } from "@/lib/protocol/paymage";
import { formatXlm, formatStroopsAsXlm } from "@/lib/protocol/tokenFormat";
import {
  decryptSalaryBlob,
  deriveViewKey,
  deserializeEncryptedPayload,
} from "@/lib/zk/encryption";
import type { ViewKey } from "@/types";

function isStellarAddress(address: string): boolean {
  return /^G[A-Z2-7]{55}$/.test(address);
}

function shortAddress(value: string | null | undefined): string {
  if (!value) return "Not configured";
  if (value.length <= 14) return value;
  return `${value.slice(0, 6)}...${value.slice(-6)}`;
}

interface AuditorStatus {
  address: string;
  isAuditor: boolean;
  encryptedViewKeyHex: string | null;
  contract: string;
  network: "TESTNET" | "PUBLIC";
  updatedAt: string;
}

interface GrantedAuditorKey {
  address: string;
  status: "active" | "revoked";
  eventType: "auditor_granted" | "auditor_revoked";
  isAuditor: boolean;
  encryptedViewKeyHex: string | null;
  keyId: string | null;
  latestTxHash: string;
  latestLedger: number;
  latestEventAt: string;
}

interface AuditorTransactionRow {
  proof?: string;
  eventType?: "auditor_granted" | "auditor_revoked" | string;
  txHash?: string;
  ledger?: number;
  createdAt?: string;
  timestamp?: string;
}

interface DisclosureCommitment {
  commitmentId: string;
  ipfsCid: string;
  gatewayUrl: string | null;
}

interface DisclosurePacket {
  address: string;
  contract: string;
  currentPeriod: number;
  period: number;
  encryptedViewKeyHex: string | null;
  payroll: {
    commitmentRoot: string;
    commitmentRootHex: string;
    totalAmount: string;
    employeeCount: number;
  } | null;
  commitments: DisclosureCommitment[];
  updatedAt: string;
}

interface DecryptedDisclosureRow {
  commitmentId: string;
  ipfsCid: string;
  employeeId: string;
  salaryAmount: string;
  salt: string;
}

function hexToUtf8(hex: string): string {
  const bytes = new Uint8Array(hex.match(/.{1,2}/g)?.map((b) => parseInt(b, 16)) ?? []);
  return new TextDecoder().decode(bytes);
}

function disclosureKeyIdFromEnvelope(hex: string | null): string | null {
  if (!hex) return null;
  const value = hexToUtf8(hex);
  if (value.startsWith("enc:")) return value.slice(4);
  return null;
}

function ComplianceManager() {
  const { viewKeys, addViewKey, revokeViewKey } = useViewKeyStore();
  const { publicKey, isConnected, network } = useWalletStore();
  const { signTx } = useStellar();
  const { data: protocol, error: protocolError, isLoading: isProtocolLoading, refresh } = useProtocolStatus();
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
  const [auditorStatus, setAuditorStatus] = useState<AuditorStatus | null>(null);
  const [auditorStatusError, setAuditorStatusError] = useState<string | null>(null);
  const [isAuditorStatusLoading, setIsAuditorStatusLoading] = useState(false);
  const [grantedAuditors, setGrantedAuditors] = useState<GrantedAuditorKey[]>([]);
  const [grantedAuditorsError, setGrantedAuditorsError] = useState<string | null>(null);
  const [isGrantedAuditorsLoading, setIsGrantedAuditorsLoading] = useState(false);
  const [disclosurePacket, setDisclosurePacket] = useState<DisclosurePacket | null>(null);
  const [disclosureRows, setDisclosureRows] = useState<DecryptedDisclosureRow[]>([]);
  const [disclosureError, setDisclosureError] = useState<string | null>(null);
  const [isDisclosureLoading, setIsDisclosureLoading] = useState(false);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [isDelegatedGranting, setIsDelegatedGranting] = useState(false);

  const loadGrantedAuditors = useCallback(async () => {
    setIsGrantedAuditorsLoading(true);
    setGrantedAuditorsError(null);
    try {
      const response = await fetch("/api/transactions?limit=100", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok || !body.success) {
        throw new Error(body?.error?.message ?? `Transactions returned ${response.status}`);
      }

      const latestByAddress = new Map<string, AuditorTransactionRow>();
      for (const row of (body.data ?? []) as AuditorTransactionRow[]) {
        if (row.eventType !== "auditor_granted" && row.eventType !== "auditor_revoked") {
          continue;
        }
        if (!row.proof || !isStellarAddress(row.proof) || !row.txHash || !row.ledger) {
          continue;
        }
        const existing = latestByAddress.get(row.proof);
        const eventAt = row.createdAt ?? row.timestamp ?? "";
        const existingAt = existing?.createdAt ?? existing?.timestamp ?? "";
        if (!existing || eventAt > existingAt) {
          latestByAddress.set(row.proof, row);
        }
      }

      const auditors = await Promise.all(
        Array.from(latestByAddress.entries()).map(async ([address, row]) => {
          const statusResponse = await fetch(
            `/api/compliance/auditor/status?address=${encodeURIComponent(address)}`,
            { cache: "no-store" },
          );
          const status = statusResponse.ok
            ? ((await statusResponse.json()) as AuditorStatus)
            : null;
          return {
            address,
            status: status?.isAuditor ? "active" : "revoked",
            eventType: row.eventType as "auditor_granted" | "auditor_revoked",
            isAuditor: Boolean(status?.isAuditor),
            encryptedViewKeyHex: status?.encryptedViewKeyHex ?? null,
            keyId: disclosureKeyIdFromEnvelope(status?.encryptedViewKeyHex ?? null),
            latestTxHash: row.txHash!,
            latestLedger: row.ledger!,
            latestEventAt: row.createdAt ?? row.timestamp ?? new Date(0).toISOString(),
          } satisfies GrantedAuditorKey;
        }),
      );

      setGrantedAuditors(auditors.sort((a, b) => b.latestEventAt.localeCompare(a.latestEventAt)));
    } catch (err) {
      setGrantedAuditors([]);
      setGrantedAuditorsError(
        err instanceof Error ? err.message : "Failed to load auditor grants",
      );
    } finally {
      setIsGrantedAuditorsLoading(false);
    }
  }, []);

  const loadAuditorStatus = useCallback(async () => {
    if (!publicKey) {
      setAuditorStatus(null);
      setAuditorStatusError(null);
      setIsAuditorStatusLoading(false);
      return;
    }

    setIsAuditorStatusLoading(true);
    setAuditorStatusError(null);
    try {
      const response = await fetch(
        `/api/compliance/auditor/status?address=${encodeURIComponent(publicKey)}`,
        { cache: "no-store" },
      );
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error ?? `Auditor status returned ${response.status}`);
      }
      setAuditorStatus((await response.json()) as AuditorStatus);
    } catch (err) {
      setAuditorStatus(null);
      setAuditorStatusError(
        err instanceof Error ? err.message : "Failed to load auditor status",
      );
    } finally {
      setIsAuditorStatusLoading(false);
    }
  }, [publicKey]);

  useEffect(() => {
    loadAuditorStatus();
  }, [loadAuditorStatus]);

  useEffect(() => {
    loadGrantedAuditors();
  }, [loadGrantedAuditors]);

  useEffect(() => {
    setDisclosurePacket(null);
    setDisclosureRows([]);
    setDisclosureError(null);
  }, [publicKey]);

  const loadDisclosurePacket = useCallback(async () => {
    if (!publicKey) {
      setDisclosureError("Connect an auditor wallet first.");
      return;
    }

    setIsDisclosureLoading(true);
    setDisclosureError(null);
    setDisclosureRows([]);
    try {
      const response = await fetch(
        `/api/compliance/disclosure?address=${encodeURIComponent(publicKey)}`,
        { cache: "no-store" },
      );
      const body = await response.json();
      if (!response.ok || !body.success) {
        throw new Error(body?.error?.message ?? `Disclosure returned ${response.status}`);
      }
      setDisclosurePacket(body.data as DisclosurePacket);
    } catch (err) {
      setDisclosurePacket(null);
      setDisclosureError(
        err instanceof Error ? err.message : "Failed to load disclosure packet",
      );
    } finally {
      setIsDisclosureLoading(false);
    }
  }, [publicKey]);

  const decryptDisclosurePacket = useCallback(async () => {
    if (!auditorStatus?.isAuditor) {
      setDisclosureRows([]);
      setDisclosureError(
        "Connected wallet is not an active payroll auditor on Stellar testnet.",
      );
      return;
    }

    if (!disclosurePacket) {
      setDisclosureError("Load a disclosure packet first.");
      return;
    }

    const keyId = disclosureKeyIdFromEnvelope(disclosurePacket.encryptedViewKeyHex);
    if (!keyId) {
      setDisclosureError("Auditor view-key envelope is missing or malformed.");
      return;
    }

    setIsDecrypting(true);
    setDisclosureError(null);
    try {
      const viewKey = await deriveViewKey(keyId);
      const rows: DecryptedDisclosureRow[] = [];
      for (const commitment of disclosurePacket.commitments) {
        const response = await fetch(
          `/api/ipfs/fetch?cid=${encodeURIComponent(commitment.ipfsCid)}`,
          { cache: "no-store" },
        );
        if (!response.ok) {
          throw new Error(`Failed to fetch encrypted payload ${commitment.ipfsCid}`);
        }
        const payload = deserializeEncryptedPayload(
          new Uint8Array(await response.arrayBuffer()),
        );
        const decrypted = await decryptSalaryBlob(payload, viewKey);
        rows.push({
          commitmentId: commitment.commitmentId,
          ipfsCid: commitment.ipfsCid,
          ...decrypted,
        });
      }
      setDisclosureRows(rows);
      toast.success("Disclosure packet decrypted", {
        description: `${rows.length} encrypted payroll records opened for auditor review.`,
      });
    } catch (err) {
      setDisclosureRows([]);
      const message =
        err instanceof Error && err.name === "OperationError"
          ? "Failed to decrypt payroll disclosure. The connected auditor key does not match the encrypted IPFS payload for this payroll period."
          : err instanceof Error
            ? err.message
            : "Failed to decrypt disclosure packet";
      setDisclosureError(
        message,
      );
    } finally {
      setIsDecrypting(false);
    }
  }, [auditorStatus?.isAuditor, disclosurePacket]);

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
      const result = await submitAndConfirmSorobanTransaction(server, signedTx);
      return result.hash;
    },
    [publicKey, isConnected, network],
  );

  const handleGenerate = async () => {
    if (!isPayrollAdmin) {
      toast.error("Payroll admin wallet required", {
        description: `Switch Freighter to ${shortAddress(protocol?.payroll.admin)} to grant auditor access.`,
      });
      return;
    }
    if (!form.auditorAddress || !isStellarAddress(form.auditorAddress)) {
      toast.error("Valid Stellar auditor address required");
      return;
    }
    setIsContractCall(true);
    try {
      const auditorAddr = StellarSdk.Address.fromString(form.auditorAddress).toScVal();
      const keyId = PAYMAGE_AUDITOR_DISCLOSURE_KEY_ID;
      const encryptedKey = StellarSdk.nativeToScVal(
        `enc:${keyId}`,
        { type: "bytes" },
      );
      await callContract("set_view_key_for_auditor", [auditorAddr, encryptedKey]);

      const newKey: ViewKey = {
        id: `vk_${Date.now()}`,
        keyId,
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
      await Promise.all([refresh(), loadAuditorStatus(), loadGrantedAuditors()]);
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

  const ensureDelegatedSession = useCallback(async () => {
    if (!publicKey || !isConnected) {
      throw new Error("Connect Freighter first.");
    }

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
  }, [isConnected, publicKey, signTx]);

  const handleGrantConnectedAuditor = useCallback(async () => {
    if (!publicKey || !isConnected) {
      toast.error("Connect Freighter first");
      return;
    }

    setIsDelegatedGranting(true);
    try {
      await ensureDelegatedSession();
      const response = await fetch("/api/admin/auditor", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ auditor: publicKey }),
      });
      const body = await response.json();
      if (!response.ok || !body.success) {
        throw new Error(body.error ?? `Delegated auditor grant returned ${response.status}`);
      }

      const newKey: ViewKey = {
        id: `vk_${Date.now()}`,
        keyId: body.keyId ?? PAYMAGE_AUDITOR_DISCLOSURE_KEY_ID,
        auditorName: "Connected auditor",
        auditorOrg: "PayMage testnet",
        auditorAddress: publicKey,
        scope: "full-audit",
        grantedBy: protocol?.payroll.admin ?? "Delegated admin",
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
        isActive: true,
      };
      addViewKey(newKey);
      await Promise.all([refresh(), loadAuditorStatus(), loadGrantedAuditors()]);
      toast.success("Connected wallet granted as auditor", {
        description: `Tx: ${shortAddress(body.txHash)}`,
      });
    } catch (err) {
      toast.error("Delegated auditor grant failed", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setIsDelegatedGranting(false);
    }
  }, [
    addViewKey,
    ensureDelegatedSession,
    isConnected,
    loadAuditorStatus,
    loadGrantedAuditors,
    protocol?.payroll.admin,
    publicKey,
    refresh,
  ]);

  const handleRevoke = async (id: string) => {
    if (!isPayrollAdmin) {
      toast.error("Payroll admin wallet required", {
        description: `Switch Freighter to ${shortAddress(protocol?.payroll.admin)} to revoke auditor access.`,
      });
      return;
    }
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
      await Promise.all([refresh(), loadAuditorStatus(), loadGrantedAuditors()]);
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

  const copyConnectedAuditorKey = async () => {
    if (!auditorStatus?.encryptedViewKeyHex) return;
    await navigator.clipboard.writeText(auditorStatus.encryptedViewKeyHex);
    toast.success("Copied encrypted view key", {
      description: "Auditor disclosure key copied to clipboard.",
    });
  };

  const activeKeys = viewKeys.filter((k) => k.isActive);
  const inactiveKeys = viewKeys.filter((k) => !k.isActive);
  const rootStatus = protocol?.payroll.employeeRootHex ? "Live root" : "Not set";
  const isPayrollAdmin = Boolean(
    publicKey &&
      protocol?.payroll.admin &&
      publicKey === protocol.payroll.admin,
  );
  const auditorActionReady = Boolean(protocol?.contracts.payroll && isPayrollAdmin);

  return (
    <section aria-labelledby="compliance-heading" className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2
            id="compliance-heading"
            className="text-lg font-semibold text-gray-900"
          >
            Compliance
          </h2>
          <p className="text-sm text-gray-600 mt-1">
            Testnet compliance console for auditor disclosure, payroll root
            checks, and encrypted payroll review.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            if (!isPayrollAdmin) {
              toast.error("Payroll admin wallet required", {
                description: `Switch Freighter to ${shortAddress(protocol?.payroll.admin)} to grant auditor access.`,
              });
              return;
            }
            setShowForm(!showForm);
          }}
          disabled={!isPayrollAdmin}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium bg-teal-700 text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Grant Auditor View Key
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
        <article className="rounded-md border border-slate-200 bg-white p-4">
          <p className="text-xs font-medium uppercase text-slate-500">Ledger</p>
          <p className="mt-2 text-lg font-semibold text-slate-950">
            {isProtocolLoading ? "Loading" : protocol?.ledger.sequence ?? "Unavailable"}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Protocol {protocol?.ledger.protocolVersion ?? "-"} on Stellar Testnet
          </p>
        </article>
        <article className="rounded-md border border-slate-200 bg-white p-4">
          <p className="text-xs font-medium uppercase text-slate-500">Payroll root</p>
          <p className={`mt-2 text-lg font-semibold ${
            protocol?.payroll.employeeRootHex ? "text-teal-700" : "text-red-700"
          }`}>
            {isProtocolLoading ? "Loading" : rootStatus}
          </p>
          <p className="mt-1 font-mono text-xs text-slate-500">
            {shortAddress(protocol?.payroll.employeeRootHex)}
          </p>
        </article>
        <article className="rounded-md border border-slate-200 bg-white p-4">
          <p className="text-xs font-medium uppercase text-slate-500">Payroll period</p>
          <p className="mt-2 text-lg font-semibold text-slate-950">
            {isProtocolLoading ? "Loading" : `#${protocol?.payroll.currentPeriod ?? "?"}`}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Next amount {formatStroopsAsXlm(protocol?.payroll.nextPayrollAmount)}
          </p>
        </article>
        <article className="rounded-md border border-slate-200 bg-white p-4">
          <p className="text-xs font-medium uppercase text-slate-500">Treasury</p>
          <p className="mt-2 text-lg font-semibold text-slate-950">
            {isProtocolLoading ? "Loading" : formatXlm(protocol?.payroll.treasuryBalance)}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Cap {formatXlm(protocol?.payroll.budgetCap)}
          </p>
        </article>
      </div>

      <div className="rounded-md border border-slate-200 bg-white p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-950">Live protocol contracts</h3>
            <p className="mt-1 text-sm text-slate-600">
              Payroll and verifier addresses are read from the production Vercel environment and
              checked against Stellar Testnet.
            </p>
            <p className="mt-2 text-xs font-medium uppercase tracking-normal text-teal-700">
              Verifier mode: {protocol?.proof.verifierMode ?? "Loading"}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              refresh();
              loadGrantedAuditors();
            }}
            className="inline-flex items-center justify-center rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Refresh
          </button>
        </div>
        {protocolError ? (
          <p className="mt-3 text-sm text-red-700">{protocolError}</p>
        ) : (
          <div className="mt-4 grid grid-cols-1 gap-3 text-sm md:grid-cols-3">
            <div>
              <p className="text-xs uppercase text-slate-500">Payroll</p>
              <p className="mt-1 font-mono text-slate-900">{shortAddress(protocol?.contracts.payroll)}</p>
            </div>
            <div>
              <p className="text-xs uppercase text-slate-500">Payroll verifier</p>
              <p className="mt-1 font-mono text-slate-900">{shortAddress(protocol?.contracts.payrollVerifier)}</p>
            </div>
            <div>
              <p className="text-xs uppercase text-slate-500">Withdraw verifier</p>
              <p className="mt-1 font-mono text-slate-900">{shortAddress(protocol?.contracts.withdrawVerifier)}</p>
            </div>
          </div>
        )}
      </div>

      <div className="rounded-md border border-slate-200 bg-white p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-950">Granted auditor keys</h3>
            <p className="mt-1 text-sm text-slate-600">
              Rows are derived from Stellar testnet grant and revoke events, then each address
              is rechecked against the payroll contract before being marked active.
            </p>
          </div>
          <button
            type="button"
            onClick={loadGrantedAuditors}
            className="inline-flex items-center justify-center rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            {isGrantedAuditorsLoading ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : null}
            Refresh keys
          </button>
        </div>

        {grantedAuditorsError ? (
          <p className="mt-3 text-sm text-red-700">{grantedAuditorsError}</p>
        ) : null}

        {isGrantedAuditorsLoading && grantedAuditors.length === 0 ? (
          <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
            Loading auditor grants from Stellar testnet.
          </div>
        ) : grantedAuditors.length > 0 ? (
          <div className="mt-4 overflow-hidden rounded-md border border-slate-200">
            <div className="grid grid-cols-[1.4fr_0.7fr_1.1fr_0.8fr_0.9fr] gap-3 border-b bg-slate-50 px-3 py-2 text-xs font-medium uppercase text-slate-500">
              <span>Auditor wallet</span>
              <span>Status</span>
              <span>Disclosure key</span>
              <span>Latest tx</span>
              <span>Last event</span>
            </div>
            {grantedAuditors.map((auditor) => (
              <div
                key={auditor.address}
                className="grid grid-cols-[1.4fr_0.7fr_1.1fr_0.8fr_0.9fr] gap-3 border-b px-3 py-2 text-xs last:border-b-0"
              >
                <div className="min-w-0">
                  <p className="truncate font-mono text-slate-900">{auditor.address}</p>
                  {auditor.address === publicKey ? (
                    <p className="mt-0.5 text-teal-700">Connected wallet</p>
                  ) : null}
                </div>
                <span
                  className={`h-fit w-fit rounded-md px-2 py-1 font-medium ${
                    auditor.isAuditor
                      ? "bg-teal-50 text-teal-800"
                      : "bg-slate-100 text-slate-700"
                  }`}
                >
                  {auditor.isAuditor ? "Active" : "Revoked"}
                </span>
                <span className="truncate font-mono text-slate-700">
                  {auditor.keyId ?? shortAddress(auditor.encryptedViewKeyHex)}
                </span>
                <a
                  href={`https://stellar.expert/explorer/testnet/tx/${auditor.latestTxHash}`}
                  target="_blank"
                  rel="noreferrer"
                  className="truncate font-mono text-teal-700 hover:text-teal-900"
                >
                  {shortAddress(auditor.latestTxHash)}
                </a>
                <span className="text-slate-700">
                  {new Date(auditor.latestEventAt).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
            No auditor grant events were found for this payroll contract in the indexed
            Stellar testnet ledger range.
          </div>
        )}
      </div>

      <div className="rounded-md border border-slate-200 bg-white p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-950">Connected auditor role</h3>
            <p className="mt-1 text-sm text-slate-600">
              This reads the payroll contract disclosure state for the connected Freighter wallet.
            </p>
          </div>
          <div
            className={`inline-flex w-fit items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium ${
              auditorStatus?.isAuditor
                ? "bg-teal-50 text-teal-800"
                : isPayrollAdmin
                  ? "bg-slate-100 text-slate-800"
                  : "bg-amber-50 text-amber-800"
            }`}
          >
            {isAuditorStatusLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Checking
              </>
            ) : auditorStatus?.isAuditor ? (
              "Auditor active"
            ) : isPayrollAdmin ? (
              "Payroll admin"
            ) : isConnected ? (
              "No auditor grant"
            ) : (
              "Wallet not connected"
            )}
          </div>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-3 text-sm md:grid-cols-3">
          <div>
            <p className="text-xs uppercase text-slate-500">Connected wallet</p>
            <p className="mt-1 font-mono text-slate-900">{shortAddress(publicKey)}</p>
          </div>
          <div>
            <p className="text-xs uppercase text-slate-500">Required admin</p>
            <p className="mt-1 font-mono text-slate-900">{shortAddress(protocol?.payroll.admin)}</p>
          </div>
          <div>
            <p className="text-xs uppercase text-slate-500">Auditor contract state</p>
            <p className="mt-1 text-slate-900">
              {isAuditorStatusLoading
                ? "Checking"
                : auditorStatus?.isAuditor
                  ? "Granted on testnet"
                  : "Not granted on testnet"}
            </p>
          </div>
        </div>
        {auditorStatusError ? (
          <p className="mt-3 text-sm text-red-700">{auditorStatusError}</p>
        ) : null}
        {isConnected && !auditorStatus?.isAuditor ? (
          <div className="mt-4 rounded-md border border-teal-100 bg-teal-50 p-3">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-sm font-medium text-teal-950">
                  Testnet shortcut: grant this connected wallet as auditor
                </p>
                <p className="mt-1 text-sm text-teal-800">
                  The wallet signs a Freighter challenge; Vercel submits the on-chain
                  auditor grant with the deployed admin signer.
                </p>
              </div>
              <button
                type="button"
                onClick={handleGrantConnectedAuditor}
                disabled={isDelegatedGranting}
                className="inline-flex w-fit items-center gap-1.5 rounded-md bg-teal-700 px-3 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600"
              >
                {isDelegatedGranting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Key className="h-4 w-4" />
                )}
                Grant connected wallet
              </button>
            </div>
          </div>
        ) : null}
        {auditorStatus?.isAuditor && auditorStatus.encryptedViewKeyHex ? (
          <div className="mt-4 flex flex-col gap-3 rounded-md border border-teal-100 bg-teal-50 p-3 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase text-teal-800">Encrypted disclosure key</p>
              <p className="mt-1 truncate font-mono text-sm text-teal-950">
                {auditorStatus.encryptedViewKeyHex}
              </p>
            </div>
            <button
              type="button"
              onClick={copyConnectedAuditorKey}
              className="inline-flex w-fit items-center gap-1.5 rounded-md border border-teal-200 bg-white px-3 py-2 text-sm font-medium text-teal-800 hover:bg-teal-100"
            >
              <Copy className="h-4 w-4" />
              Copy key
            </button>
          </div>
        ) : null}
        {isPayrollAdmin && !auditorStatus?.isAuditor ? (
          <p className="mt-3 text-sm text-slate-600">
            This wallet can manage auditor grants. To test the auditor persona, switch
            Freighter to a wallet that has been granted a view key.
          </p>
        ) : null}
      </div>

      <div className="rounded-md border border-slate-200 bg-white p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-950">
              Auditor disclosure packet
            </h3>
            <p className="mt-1 text-sm text-slate-600">
              Active auditors can read the latest payroll period from the contract,
              fetch encrypted salary blobs from IPFS, and decrypt them in this browser.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={loadDisclosurePacket}
              disabled={!auditorStatus?.isAuditor || isDisclosureLoading}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isDisclosureLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Shield className="h-4 w-4" />}
              Load packet
            </button>
            <button
              type="button"
              onClick={decryptDisclosurePacket}
              disabled={
                !auditorStatus?.isAuditor ||
                !disclosurePacket ||
                disclosurePacket.commitments.length === 0 ||
                isDecrypting
              }
              className="inline-flex items-center gap-1.5 rounded-md bg-teal-700 px-3 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600"
            >
              {isDecrypting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Unlock className="h-4 w-4" />}
              Decrypt payroll
            </button>
          </div>
        </div>

        {disclosureError ? (
          <p className="mt-3 text-sm text-red-700">{disclosureError}</p>
        ) : null}

        {!auditorStatus?.isAuditor && !disclosurePacket ? (
          <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            Connect a granted auditor wallet to unlock this panel. Admin wallets can grant
            auditors, but they do not automatically decrypt payroll disclosure packets.
          </div>
        ) : disclosurePacket?.payroll ? (
          <div className="mt-4 space-y-4">
            <div className="grid grid-cols-1 gap-3 text-sm md:grid-cols-4">
              <div>
                <p className="text-xs uppercase text-slate-500">Period</p>
                <p className="mt-1 font-semibold text-slate-950">#{disclosurePacket.period}</p>
              </div>
              <div>
                <p className="text-xs uppercase text-slate-500">Employees</p>
                <p className="mt-1 font-semibold text-slate-950">
                  {disclosurePacket.payroll.employeeCount}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase text-slate-500">Aggregate amount</p>
                <p className="mt-1 font-semibold text-slate-950">
                  {formatStroopsAsXlm(disclosurePacket.payroll.totalAmount)}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase text-slate-500">Encrypted blobs</p>
                <p className="mt-1 font-semibold text-slate-950">
                  {disclosurePacket.commitments.length}
                </p>
              </div>
            </div>
            <div className="rounded-md border border-slate-200">
              <div className="grid grid-cols-2 gap-3 border-b bg-slate-50 px-3 py-2 text-xs font-medium uppercase text-slate-500">
                <span>Commitment</span>
                <span>IPFS CID</span>
              </div>
              {disclosurePacket.commitments.map((commitment) => (
                <div
                  key={commitment.commitmentId}
                  className="grid grid-cols-2 gap-3 border-b px-3 py-2 text-xs last:border-b-0"
                >
                  <span className="truncate font-mono text-slate-700">
                    {commitment.commitmentId}
                  </span>
                  <span className="truncate font-mono text-slate-700">
                    {commitment.ipfsCid}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : disclosurePacket ? (
          <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
            No payroll period has been submitted on this contract yet. Submit a private payroll
            run first, then reload this packet.
          </div>
        ) : null}

        {disclosureRows.length > 0 ? (
          <div className="mt-4 rounded-md border border-teal-100 bg-teal-50">
            <div className="grid grid-cols-4 gap-3 border-b border-teal-100 px-3 py-2 text-xs font-medium uppercase text-teal-800">
              <span>Commitment</span>
              <span>Employee field id</span>
              <span>Salary amount</span>
              <span>Salt</span>
            </div>
            {disclosureRows.map((row) => (
              <div
                key={row.commitmentId}
                className="grid grid-cols-4 gap-3 border-b border-teal-100 px-3 py-2 text-xs last:border-b-0"
              >
                <span className="truncate font-mono text-teal-950">{row.commitmentId}</span>
                <span className="truncate font-mono text-teal-950">{row.employeeId}</span>
                <span className="font-semibold text-teal-950">
                  {formatStroopsAsXlm(row.salaryAmount)}
                </span>
                <span className="truncate font-mono text-teal-950">{row.salt}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <Shield className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
          <div>
            <h3 className="text-sm font-medium text-amber-800">
              Privacy Notice
            </h3>
            <p className="text-sm text-amber-700 mt-1">
              PayMage stores public payroll commitments on Stellar while salary
              details remain encrypted. Auditor view keys call the payroll
              contract disclosure methods and unlock only the scope granted by
              the employer.
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
              disabled={isContractCall || !isPayrollAdmin || !form.auditorName || !form.auditorOrg || !form.auditorAddress}
              className="px-4 py-2 rounded-md text-sm font-medium bg-teal-700 text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600 transition-colors inline-flex items-center gap-1.5"
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

      {activeKeys.length === 0 && inactiveKeys.length === 0 && (
        <div className="rounded-md border border-slate-200 bg-white p-6">
          <h3 className="text-sm font-semibold text-slate-950">No auditor keys granted</h3>
          <p className="mt-2 text-sm text-slate-600">
            No auditor key has been granted in this browser session. Grant an auditor key
            with a real Stellar testnet address to call the payroll contract disclosure
            method.
          </p>
        </div>
      )}

      {!auditorActionReady && (
        <div className="rounded-md border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
          Connect the payroll admin wallet to grant or revoke auditor access. Judges can still
          verify auditor status, live protocol contracts, and payroll readiness above without signing.
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
