"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createPayrollEventsRpc,
  fetchPayrollEvents,
  type PayrollEventsRpc,
} from "@/lib/stellar/events";
import type { PayrollTransaction } from "@/types";

const DEFAULT_RPC_URL = "https://soroban-testnet.stellar.org";
const DEFAULT_POLL_INTERVAL = 5000;

interface UsePayrollEventsOptions {
  rpc?: PayrollEventsRpc;
  rpcUrl?: string;
  startLedger?: number;
  pollInterval?: number;
  enabled?: boolean;
}

export function usePayrollEvents({
  rpc: providedRpc,
  rpcUrl = process.env.NEXT_PUBLIC_SOROBAN_RPC_URL ?? DEFAULT_RPC_URL,
  startLedger = Number(process.env.NEXT_PUBLIC_PAYROLL_START_LEDGER ?? "1"),
  pollInterval = DEFAULT_POLL_INTERVAL,
  enabled = true,
}: UsePayrollEventsOptions = {}) {
  const [events, setEvents] = useState<PayrollTransaction[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const inFlight = useRef(false);
  const hasLoaded = useRef(false);
  const rpc = useMemo(
    () => providedRpc ?? createPayrollEventsRpc(rpcUrl),
    [providedRpc, rpcUrl],
  );

  const refresh = useCallback(() => setRefreshKey((value) => value + 1), []);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    const load = async () => {
      if (inFlight.current) return;
      inFlight.current = true;

      if (!hasLoaded.current) setLoading(true);
      try {
        const nextEvents = await fetchPayrollEvents(rpc, { startLedger });
        if (cancelled) return;

        setEvents((current) => {
          const byId = new Map(current.map((event) => [event.id, event]));
          nextEvents.forEach((event) => byId.set(event.id, event));
          return Array.from(byId.values()).sort(
            (left, right) => right.createdAt.localeCompare(left.createdAt),
          );
        });
        setError(null);
      } catch (cause) {
        if (!cancelled) {
          setError(
            cause instanceof Error
              ? cause.message
              : "The payroll event stream is temporarily unavailable.",
          );
        }
      } finally {
        inFlight.current = false;
        if (!cancelled) {
          hasLoaded.current = true;
          setLoading(false);
        }
      }
    };

    void load();
    const interval = window.setInterval(() => void load(), pollInterval);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [enabled, pollInterval, refreshKey, rpc, startLedger]);

  return { events, loading, error, refresh };
}
