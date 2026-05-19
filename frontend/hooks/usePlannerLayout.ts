import { useCallback, useEffect, useMemo, useState } from "react";

import {
  fetchDemoLayout,
  moveDemoPallet,
  moveDemoToFirstFree,
  removeDemoSlot,
  saveDemoLayout,
  type PlannerLayoutState,
} from "@/lib/api/plannerClient";
import { getConflictSlotIds } from "@/lib/load/capacity";
import type { PalletData } from "@/lib/types/load";

interface UsePlannerLayoutResult {
  loading: boolean;
  error: string | null;
  vehicle: PlannerLayoutState["vehicle"] | null;
  slots: Record<string, PalletData | null>;
  conflicts: PlannerLayoutState["conflicts"];
  conflictSlotIds: Set<string>;
  sessionId: string | null;
  reload: () => Promise<void>;
  persistSlots: (slots: Record<string, PalletData | null>) => Promise<boolean>;
  movePallet: (fromSlot: string, toSlot: string) => Promise<{ ok: boolean; message?: string }>;
  removePallet: (slotId: string) => Promise<void>;
  moveToFirstFree: (slotId: string) => Promise<{ ok: boolean; message?: string }>;
}

export function usePlannerLayout(): UsePlannerLayoutResult {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [layout, setLayout] = useState<PlannerLayoutState | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await fetchDemoLayout();
      setLayout(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nie udało się wczytać layoutu.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const applyLayout = useCallback((next: PlannerLayoutState) => {
    setLayout(next);
  }, []);

  const persistSlots = useCallback(async (slots: Record<string, PalletData | null>) => {
    const next = await saveDemoLayout(slots);
    applyLayout(next);
    return true;
  }, [applyLayout]);

  const movePallet = useCallback(async (fromSlot: string, toSlot: string) => {
    const result = await moveDemoPallet(fromSlot, toSlot);
    applyLayout(result.layout);
    return { ok: result.ok, message: result.message };
  }, [applyLayout]);

  const removePallet = useCallback(async (slotId: string) => {
    const next = await removeDemoSlot(slotId);
    applyLayout(next);
  }, [applyLayout]);

  const moveToFirstFree = useCallback(async (slotId: string) => {
    const result = await moveDemoToFirstFree(slotId);
    applyLayout(result.layout);
    return { ok: result.ok, message: result.message };
  }, [applyLayout]);

  const conflictSlotIds = useMemo(
    () => getConflictSlotIds(layout?.conflicts ?? []),
    [layout?.conflicts],
  );

  return {
    loading,
    error,
    vehicle: layout?.vehicle ?? null,
    slots: layout?.slots ?? {},
    conflicts: layout?.conflicts ?? [],
    conflictSlotIds,
    sessionId: layout?.sessionId ?? null,
    reload,
    persistSlots,
    movePallet,
    removePallet,
    moveToFirstFree,
  };
}
