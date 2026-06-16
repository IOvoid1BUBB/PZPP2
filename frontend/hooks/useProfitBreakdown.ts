"use client";

import { useEffect, useState } from "react";

import {
  fetchSessionProfit,
  ProfitFetchError,
  type ProfitBreakdownData,
} from "@/lib/api/profitClient";

export interface UseProfitBreakdownResult {
  data: ProfitBreakdownData | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

/**
 * Pobiera kalkulację zysku z POST /sessions/{id}/profit.
 * Gdy brak sesji lub sesja nie ma tras (422) — zwraca null bez danych demo.
 * Komponent nadrzędny odpowiada za wyświetlenie stanu pustego.
 */
export function useProfitBreakdown(sessionId: string | null): UseProfitBreakdownResult {
  const [data, setData] = useState<ProfitBreakdownData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (!sessionId) {
      setData(null);
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
      } catch (err) {
        if (cancelled) {
          return;
        }

        if (err instanceof ProfitFetchError && err.status === 422) {
          // Sesja nie ma jeszcze tras — to normalny stan, nie błąd.
          setData(null);
          setError(null);
          return;
        }

        setData(null);
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
    reload: () => setReloadToken((token) => token + 1),
  };
}
