import { useCallback, useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/shallow";

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
import { useConflicts, useLoadStore } from "@/lib/stores/loadStore";

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
  const initialState = useLoadStore.getState();
  const [loading, setLoading] = useState(
    initialState.vehicle === null &&
      initialState.sessionId === null &&
      Object.keys(initialState.slots).length === 0,
  );
  const [error, setError] = useState<string | null>(null);
  const { vehicle, slots, sessionId } = useLoadStore(
    useShallow((state) => ({
      vehicle: state.vehicle,
      slots: state.slots,
      sessionId: state.sessionId,
    })),
  );
  const conflicts = useConflicts();

  const hasLayout =
    vehicle !== null || sessionId !== null || Object.keys(slots).length > 0;

  const applyLayout = useCallback((next: PlannerLayoutState) => {
    useLoadStore.getState().setLayout({
      sessionId: next.sessionId,
      vehicle: next.vehicle,
      slots: next.slots,
    });
  }, []);

  const hasStoreLayout = useCallback(() => {
    const state = useLoadStore.getState();
    return (
      state.vehicle !== null ||
      state.sessionId !== null ||
      Object.keys(state.slots).length > 0
    );
  }, []);

  const reload = useCallback(async () => {
    const hadLayoutBeforeFetch = hasStoreLayout();
    setLoading(true);
    setError(null);
    try {
      const next = await fetchDemoLayout();
      if (!hadLayoutBeforeFetch && hasStoreLayout()) {
        return;
      }

      applyLayout(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nie udało się wczytać layoutu.");
    } finally {
      setLoading(false);
    }
  }, [applyLayout, hasStoreLayout]);

  useEffect(() => {
    if (hasLayout) {
      setLoading(false);
      return;
    }

    void reload();
  }, [hasLayout, reload]);

  const persistSlots = useCallback(async (slots: Record<string, PalletData | null>) => {
    setError(null);
    try {
      const next = await saveDemoLayout(slots);
      applyLayout(next);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nie udało się zapisać layoutu.");
      return false;
    }
  }, [applyLayout]);

  const movePallet = useCallback(async (fromSlot: string, toSlot: string) => {
    setError(null);
    try {
      const result = await moveDemoPallet(fromSlot, toSlot);
      applyLayout(result.layout);
      return { ok: result.ok, message: result.message };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Nie udało się przenieść ładunku.";
      setError(message);
      return { ok: false, message };
    }
  }, [applyLayout]);

  const removePallet = useCallback(async (slotId: string) => {
    setError(null);
    try {
      const next = await removeDemoSlot(slotId);
      applyLayout(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nie udało się usunąć ładunku.");
    }
  }, [applyLayout]);

  const moveToFirstFree = useCallback(async (slotId: string) => {
    setError(null);
    try {
      const result = await moveDemoToFirstFree(slotId);
      applyLayout(result.layout);
      return { ok: result.ok, message: result.message };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Nie udało się przenieść do wolnego slotu.";
      setError(message);
      return { ok: false, message };
    }
  }, [applyLayout]);

  const conflictSlotIds = useMemo(
    () => getConflictSlotIds(conflicts),
    [conflicts],
  );

  return {
    loading,
    error,
    vehicle,
    slots,
    conflicts,
    conflictSlotIds,
    sessionId,
    reload,
    persistSlots,
    movePallet,
    removePallet,
    moveToFirstFree,
  };
}
