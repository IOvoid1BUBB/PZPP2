"use client";

import { useEffect, useState } from "react";

import {
  DEMO_PROFIT_BREAKDOWN,
  fetchSessionProfit,
  ProfitFetchError,
  type ProfitBreakdownData,
} from "@/lib/api/profitClient";

export interface UseProfitBreakdownResult {
  data: ProfitBreakdownData;
  loading: boolean;
  error: string | null;
  isDemoFallback: boolean;
  reload: () => void;
}

/**
 * Loads profit breakdown from POST /sessions/{id}/profit when sessionId is set.
 * Falls back to demo data when session has no route stops (HTTP 422).
 */
export function useProfitBreakdown(sessionId: string | null): UseProfitBreakdownResult {
  const [data, setData] = useState<ProfitBreakdownData>(DEMO_PROFIT_BREAKDOWN);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDemoFallback, setIsDemoFallback] = useState(true);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (!sessionId) {
      setData(DEMO_PROFIT_BREAKDOWN);
      setIsDemoFallback(true);
      setError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    const activeSessionId = sessionId;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const breakdown = await fetchSessionProfit(activeSessionId);
        if (cancelled) {
          return;
        }
        setData(breakdown);
        setIsDemoFallback(false);
      } catch (err) {
        if (cancelled) {
          return;
        }

        if (err instanceof ProfitFetchError && err.status === 422) {
          setData(DEMO_PROFIT_BREAKDOWN);
          setIsDemoFallback(true);
          setError(null);
          return;
        }

        setData(DEMO_PROFIT_BREAKDOWN);
        setIsDemoFallback(true);
        setError(
          err instanceof Error
            ? err.message
            : "Nie udało się wczytać kalkulacji zysku.",
        );
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [sessionId, reloadToken]);

  return {
    data,
    loading,
    error,
    isDemoFallback,
    reload: () => setReloadToken((token) => token + 1),
  };
}
